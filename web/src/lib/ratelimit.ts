export const UPLOAD_LIMITS = [
  { windowSeconds: 60 * 60, max: 10 },
  { windowSeconds: 24 * 60 * 60, max: 100 },
] as const;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Decide whether one more upload is allowed given the timestamps of the
 * user's previous uploads. Pure so it can be unit tested; the database layer
 * supplies the timestamps under an advisory lock.
 */
export function evaluateRateLimit(
  previous: Date[],
  now: Date,
  limits: ReadonlyArray<{ windowSeconds: number; max: number }> = UPLOAD_LIMITS,
): RateLimitDecision {
  let retryAfter = 0;
  for (const { windowSeconds, max } of limits) {
    const windowStart = now.getTime() - windowSeconds * 1000;
    const inWindow = previous
      .map((d) => d.getTime())
      .filter((t) => t > windowStart)
      .sort((a, b) => a - b);
    if (inWindow.length >= max) {
      // The slot frees up when the oldest event that keeps us at the limit
      // falls out of the window.
      const freeingEvent = inWindow[inWindow.length - max]!;
      const seconds = Math.ceil((freeingEvent + windowSeconds * 1000 - now.getTime()) / 1000);
      retryAfter = Math.max(retryAfter, seconds, 1);
    }
  }
  return retryAfter > 0 ? { allowed: false, retryAfterSeconds: retryAfter } : { allowed: true };
}
