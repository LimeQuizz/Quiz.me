"""Admission control: bounded queueing with an adaptive Retry-After.

At most ``concurrency`` extractions run at once and at most ``queue_size``
more wait. A request is admitted before its body is read, so an overloaded
replica does not spend bandwidth and disk on uploads it cannot process.

The controller keeps an exponentially weighted moving average of how long
extractions take. It uses that to estimate how long a newcomer would wait,
turns the request away at once when the estimate exceeds ``max_wait``, and
tells rejected clients when a slot is likely to be free (``Retry-After``).
"""

from __future__ import annotations

import asyncio
import math
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager


class Busy(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("busy")
        self.retry_after = retry_after


class AdmissionController:
    def __init__(
        self,
        *,
        concurrency: int,
        queue_size: int,
        max_wait_seconds: float,
        initial_estimate_seconds: float = 5.0,
        smoothing: float = 0.2,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._slots = asyncio.Semaphore(concurrency)
        self._concurrency = concurrency
        self._capacity = concurrency + queue_size
        self._max_wait = max_wait_seconds
        self._avg = initial_estimate_seconds
        self._smoothing = smoothing
        self._clock = clock
        self._admitted = 0  # running + waiting + reading their body

    @property
    def admitted(self) -> int:
        return self._admitted

    @property
    def average_seconds(self) -> float:
        return self._avg

    def estimated_wait(self) -> float:
        """Seconds a newly admitted request would wait for a slot."""
        ahead = self._admitted - self._concurrency + 1
        if ahead <= 0:
            return 0.0
        return math.ceil(ahead / self._concurrency) * self._avg

    def retry_after(self) -> int:
        # When a slot is likely to open: the next completion, or the queue
        # draining if it is long. Clamped to keep clients from giving up.
        wait = max(self._avg, self.estimated_wait() - self._max_wait)
        return max(1, min(120, math.ceil(wait)))

    def admit(self) -> None:
        """Reserve a place or raise Busy. Pair with ``run`` or ``release``."""
        if self._admitted >= self._capacity or self.estimated_wait() > self._max_wait:
            raise Busy(self.retry_after())
        self._admitted += 1

    def release(self) -> None:
        self._admitted = max(0, self._admitted - 1)

    @asynccontextmanager
    async def run(self) -> AsyncIterator[None]:
        """Wait for a slot (an admitted request only) and time the work."""
        try:
            async with asyncio.timeout(self._max_wait):
                await self._slots.acquire()
        except TimeoutError:
            raise Busy(self.retry_after()) from None
        started = self._clock()
        try:
            yield
        finally:
            self._slots.release()
            elapsed = self._clock() - started
            self._avg = (1 - self._smoothing) * self._avg + self._smoothing * elapsed
