from __future__ import annotations

import asyncio

import pytest

from app.admission import AdmissionController, Busy


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_admits_up_to_concurrency_plus_queue() -> None:
    ac = AdmissionController(concurrency=2, queue_size=1, max_wait_seconds=1000)
    for _ in range(3):
        ac.admit()
    with pytest.raises(Busy) as exc:
        ac.admit()
    assert exc.value.retry_after >= 1
    ac.release()
    ac.admit()


def test_rejects_when_estimated_wait_exceeds_limit() -> None:
    # Queue room exists, but at 5 s per job a third request would wait
    # 5 s for a slot, more than the 4 s limit.
    ac = AdmissionController(
        concurrency=2, queue_size=10, max_wait_seconds=4, initial_estimate_seconds=5
    )
    ac.admit()
    ac.admit()
    assert ac.estimated_wait() == 5
    with pytest.raises(Busy):
        ac.admit()


def test_release_never_goes_negative() -> None:
    ac = AdmissionController(concurrency=1, queue_size=0, max_wait_seconds=1)
    ac.release()
    assert ac.admitted == 0


async def test_learns_average_duration_and_adapts_retry_after() -> None:
    clock = Clock()
    ac = AdmissionController(
        concurrency=1,
        queue_size=0,
        max_wait_seconds=1000,
        initial_estimate_seconds=1,
        smoothing=0.5,
        clock=clock,
    )
    for _ in range(6):
        ac.admit()
        async with ac.run():
            clock.t += 20
        ac.release()
    assert ac.average_seconds > 19
    ac.admit()
    with pytest.raises(Busy) as exc:
        ac.admit()
    # Slow jobs mean a longer Retry-After.
    assert exc.value.retry_after >= 19


async def test_waiting_request_times_out_with_busy() -> None:
    ac = AdmissionController(
        concurrency=1, queue_size=1, max_wait_seconds=0.05, initial_estimate_seconds=0.01
    )
    ac.admit()
    ac.admit()
    gate = asyncio.Event()

    async def holder() -> None:
        async with ac.run():
            await gate.wait()

    task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    with pytest.raises(Busy):
        async with ac.run():
            pass
    gate.set()
    await task
