/**
 * In-process overload protection. Everything here is per replica and kept in
 * memory, so it works with no extra infrastructure and keeps protecting the
 * app if the database is the thing under stress. Volumetric network floods
 * are the platform's job (see docs/threat-model.md); this layer handles
 * request floods that reach the app.
 *
 * - AdaptiveRateLimiter: token bucket per client IP and traffic class. It
 *   tightens every client's refill rate while total traffic is above a soft
 *   limit, and doubles the block for a client each time it retries before
 *   its Retry-After has passed.
 * - CircuitBreaker: stops sending work to a dependency that keeps failing,
 *   then probes it with one request before reopening.
 * - ConcurrencyGate: caps in-flight expensive requests and rejects the
 *   excess at once instead of queueing them.
 */

type Clock = () => number;
const systemClock: Clock = () => Date.now();

/** Client IP from X-Forwarded-For, trusting only the last `trustedHops` proxies. */
export function clientIp(headers: Headers, trustedHops: number): string {
  const xff = headers.get("x-forwarded-for");
  if (xff && trustedHops > 0) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    // Each trusted proxy appends the address it saw, so the entry added by
    // the outermost trusted proxy is `trustedHops` from the right. Anything
    // further left is client-supplied and can be forged.
    const ip = hops[hops.length - trustedHops];
    if (ip && ip.length <= 64) return ip;
  }
  const real = headers.get("x-real-ip");
  if (real && trustedHops > 0 && real.length <= 64) return real.trim();
  return "direct";
}

export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

export interface BucketPolicy {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second under normal load. */
  refillPerSecond: number;
}

export interface RateLimiterOptions {
  policies: Record<string, BucketPolicy>;
  /** Total requests per second (all clients) above which refill rates shrink. */
  globalSoftLimitPerSecond: number;
  /** Refill multiplier while above the soft limit (0..1). */
  pressureFactor?: number;
  /** Maximum tracked clients; the least recently seen are evicted. */
  maxClients?: number;
  /** Longest penalty for repeat offenders, in seconds. */
  maxPenaltySeconds?: number;
  clock?: Clock;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updated: number;
  /** Consecutive rejections; drives the escalating penalty. */
  strikes: number;
  blockedUntil: number;
}

export class AdaptiveRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly clock: Clock;
  private readonly pressureFactor: number;
  private readonly maxClients: number;
  private readonly maxPenaltyMs: number;
  // Global request rate, as an exponentially weighted moving average.
  private rate = 0;
  private rateUpdated: number;

  constructor(private readonly opts: RateLimiterOptions) {
    this.clock = opts.clock ?? systemClock;
    this.pressureFactor = opts.pressureFactor ?? 0.25;
    this.maxClients = opts.maxClients ?? 20_000;
    this.maxPenaltyMs = (opts.maxPenaltySeconds ?? 60) * 1000;
    this.rateUpdated = this.clock();
  }

  /** Requests per second across all clients (smoothed). */
  globalRate(): number {
    this.decayRate(this.clock());
    return this.rate;
  }

  underPressure(): boolean {
    return this.globalRate() > this.opts.globalSoftLimitPerSecond;
  }

  check(client: string, policyName: string): LimitDecision {
    const policy = this.opts.policies[policyName];
    if (!policy) throw new Error(`unknown rate limit policy ${policyName}`);
    const now = this.clock();
    this.recordRequest(now);

    const key = `${policyName}:${client}`;
    let bucket = this.buckets.get(key);
    if (bucket) {
      // Re-insert to keep the map in least-recently-used order.
      this.buckets.delete(key);
    } else {
      bucket = { tokens: policy.capacity, updated: now, strikes: 0, blockedUntil: 0 };
      this.evictIfFull();
    }
    this.buckets.set(key, bucket);

    const refill = policy.refillPerSecond * (this.rate > this.opts.globalSoftLimitPerSecond ? this.pressureFactor : 1);

    if (now < bucket.blockedUntil) {
      // Still blocked and retrying anyway: each retry doubles the block.
      // Clients that honour Retry-After never hit this branch.
      bucket.strikes += 1;
      const penaltyMs = Math.min(this.maxPenaltyMs, (1000 / refill) * 2 ** Math.min(bucket.strikes, 16));
      bucket.blockedUntil = Math.max(bucket.blockedUntil, now + penaltyMs);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) };
    }

    bucket.tokens = Math.min(policy.capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refill);
    bucket.updated = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.strikes = 0;
      return { allowed: true };
    }

    const waitMs = Math.min(this.maxPenaltyMs, ((1 - bucket.tokens) / refill) * 1000);
    bucket.blockedUntil = now + waitMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  size(): number {
    return this.buckets.size;
  }

  private recordRequest(now: number): void {
    this.decayRate(now);
    this.rate += 1;
  }

  // EWMA with a one-second time constant: after a burst stops, the measured
  // rate falls by about 63% per second.
  private decayRate(now: number): void {
    const elapsed = (now - this.rateUpdated) / 1000;
    if (elapsed > 0) {
      this.rate *= Math.exp(-elapsed);
      this.rateUpdated = now;
    }
  }

  private evictIfFull(): void {
    while (this.buckets.size >= this.maxClients) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = "closed";
  private probeInFlight = false;
  private readonly clock: Clock;

  constructor(
    private readonly opts: { failureThreshold: number; cooldownSeconds: number; clock?: Clock },
  ) {
    this.clock = opts.clock ?? systemClock;
  }

  current(): BreakerState {
    if (this.state === "open" && this.clock() - this.openedAt >= this.opts.cooldownSeconds * 1000) {
      this.state = "half-open";
    }
    return this.state;
  }

  /** Whether a call may go through now. In half-open state only one probe is allowed. */
  allow(): LimitDecision {
    const state = this.current();
    if (state === "closed") return { allowed: true };
    if (state === "half-open" && !this.probeInFlight) {
      this.probeInFlight = true;
      return { allowed: true };
    }
    const remaining = this.opts.cooldownSeconds * 1000 - (this.clock() - this.openedAt);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
  }

  success(): void {
    this.failures = 0;
    this.state = "closed";
    this.probeInFlight = false;
  }

  /** The call ended without telling us anything about the dependency's health. */
  neutral(): void {
    this.probeInFlight = false;
  }

  failure(): void {
    this.probeInFlight = false;
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = this.clock();
    }
  }
}

export class ConcurrencyGate {
  private inFlight = 0;

  constructor(private readonly limit: number) {}

  /** Returns a release function, or null if the gate is full. */
  tryEnter(): (() => void) | null {
    if (this.inFlight >= this.limit) return null;
    this.inFlight += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.inFlight -= 1;
      }
    };
  }

  active(): number {
    return this.inFlight;
  }
}

/**
 * Traffic classes used by the middleware and the upload route. Limits are
 * per client IP and generous on purpose: a classroom or office behind one
 * NAT address shares them. Scale them with RATE_LIMIT_SCALE.
 */
export const RATE_POLICIES: Record<string, BucketPolicy> = {
  // Page views and reads: 300 burst, 10/s sustained.
  read: { capacity: 300, refillPerSecond: 10 },
  // Form posts, server actions, sign-in: 60 burst, 2/s sustained.
  write: { capacity: 60, refillPerSecond: 2 },
  // Upload attempts, checked before authentication; the per-user database
  // limit (10/hour, 100/day) still applies on top.
  upload: { capacity: 30, refillPerSecond: 0.1 },
};

export function scaledPolicies(scale: number): Record<string, BucketPolicy> {
  return Object.fromEntries(
    Object.entries(RATE_POLICIES).map(([k, p]) => [
      k,
      { capacity: Math.max(1, Math.round(p.capacity * scale)), refillPerSecond: p.refillPerSecond * scale },
    ]),
  );
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Module-level singletons: one per server process.
let limiter: AdaptiveRateLimiter | undefined;
export function getRateLimiter(): AdaptiveRateLimiter {
  limiter ??= new AdaptiveRateLimiter({
    policies: scaledPolicies(envNumber("RATE_LIMIT_SCALE", 1)),
    globalSoftLimitPerSecond: envNumber("RATE_LIMIT_GLOBAL_SOFT_RPS", 300),
  });
  return limiter;
}

let breaker: CircuitBreaker | undefined;
export function getExtractorBreaker(): CircuitBreaker {
  breaker ??= new CircuitBreaker({ failureThreshold: 5, cooldownSeconds: 30 });
  return breaker;
}

let uploadGate: ConcurrencyGate | undefined;
export function getUploadGate(): ConcurrencyGate {
  uploadGate ??= new ConcurrencyGate(envNumber("UPLOAD_MAX_IN_FLIGHT", 8));
  return uploadGate;
}

export function rateLimitDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === "true";
}
