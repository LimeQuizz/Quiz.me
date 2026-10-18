import { describe, expect, it } from "vitest";
import {
  AdaptiveRateLimiter,
  CircuitBreaker,
  clientIp,
  ConcurrencyGate,
  trustedProxyHops,
} from "@/lib/traffic-guard";

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const policies = { read: { capacity: 5, refillPerSecond: 1 } };

describe("clientIp", () => {
  it("takes the address added by the outermost trusted proxy, ignoring forged entries", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(clientIp(h, 1)).toBe("203.0.113.7");
    expect(clientIp(h, 2)).toBe("6.6.6.6");
  });

  it("ignores forwarding headers when no proxy is trusted", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" });
    expect(clientIp(h, 0)).toBe("direct");
  });

  it("falls back when the header is missing or too short", () => {
    expect(clientIp(new Headers(), 1)).toBe("direct");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }), 3)).toBe("direct");
  });

  it("reads TRUSTED_PROXY_HOPS with a safe default", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "abc" })).toBe(1);
  });
});

describe("AdaptiveRateLimiter", () => {
  it("allows a burst up to capacity, then refills over time", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({ policies, globalSoftLimitPerSecond: 1000, clock: c.now });
    for (let i = 0; i < 5; i++) expect(rl.check("a", "read").allowed).toBe(true);
    const denied = rl.check("a", "read");
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 1 });
    c.advance(1000);
    expect(rl.check("a", "read").allowed).toBe(true);
  });

  it("keeps clients independent", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({ policies, globalSoftLimitPerSecond: 1000, clock: c.now });
    for (let i = 0; i < 6; i++) rl.check("a", "read");
    expect(rl.check("b", "read").allowed).toBe(true);
  });

  it("doubles the block for clients that retry before Retry-After, up to a cap", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({
      policies: { tight: { capacity: 1, refillPerSecond: 1 } },
      globalSoftLimitPerSecond: 1e9,
      maxPenaltySeconds: 60,
      clock: c.now,
    });
    expect(rl.check("a", "tight").allowed).toBe(true);
    expect(rl.check("a", "tight")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      c.advance(100);
      const d = rl.check("a", "tight");
      expect(d.allowed).toBe(false);
      if (!d.allowed) waits.push(d.retryAfterSeconds);
    }
    expect(waits.slice(0, 4)).toEqual([2, 4, 8, 16]);
    expect(Math.max(...waits)).toBe(60);
  });

  it("does not punish clients that wait for Retry-After", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({
      policies: { tight: { capacity: 1, refillPerSecond: 1 } },
      globalSoftLimitPerSecond: 1e9,
      clock: c.now,
    });
    for (let i = 0; i < 5; i++) {
      expect(rl.check("a", "tight").allowed).toBe(true);
      const d = rl.check("a", "tight");
      expect(d).toEqual({ allowed: false, retryAfterSeconds: 1 });
      c.advance(1000);
    }
  });

  it("tightens refill rates while total traffic is above the soft limit", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({
      policies: { read: { capacity: 2, refillPerSecond: 4 } },
      globalSoftLimitPerSecond: 50,
      pressureFactor: 0.25,
      clock: c.now,
    });
    // Calm: after draining, 250 ms brings back one token (4/s).
    rl.check("x", "read");
    rl.check("x", "read");
    c.advance(250);
    expect(rl.check("x", "read").allowed).toBe(true);

    // Flood from many addresses pushes the global rate over the soft limit.
    for (let i = 0; i < 200; i++) rl.check(`bot-${i}`, "read");
    expect(rl.underPressure()).toBe(true);
    rl.check("y", "read");
    rl.check("y", "read");
    c.advance(250);
    // Same wait now yields only a quarter token (1/s): denied.
    expect(rl.check("y", "read").allowed).toBe(false);

    // The measured rate decays once the flood stops.
    c.advance(10_000);
    expect(rl.underPressure()).toBe(false);
  });

  it("bounds memory by evicting the least recently seen clients", () => {
    const c = fakeClock();
    const rl = new AdaptiveRateLimiter({ policies, globalSoftLimitPerSecond: 1e9, maxClients: 100, clock: c.now });
    for (let i = 0; i < 10_000; i++) rl.check(`ip-${i}`, "read");
    expect(rl.size()).toBeLessThanOrEqual(100);
  });
});

describe("CircuitBreaker", () => {
  it("opens after consecutive failures, then lets one probe through after the cooldown", () => {
    const c = fakeClock();
    const b = new CircuitBreaker({ failureThreshold: 3, cooldownSeconds: 30, clock: c.now });
    for (let i = 0; i < 3; i++) {
      expect(b.allow().allowed).toBe(true);
      b.failure();
    }
    expect(b.current()).toBe("open");
    expect(b.allow()).toEqual({ allowed: false, retryAfterSeconds: 30 });

    c.advance(30_000);
    expect(b.current()).toBe("half-open");
    expect(b.allow().allowed).toBe(true);
    expect(b.allow().allowed).toBe(false); // only one probe at a time
    b.success();
    expect(b.current()).toBe("closed");
    expect(b.allow().allowed).toBe(true);
  });

  it("re-opens when the probe fails", () => {
    const c = fakeClock();
    const b = new CircuitBreaker({ failureThreshold: 1, cooldownSeconds: 10, clock: c.now });
    b.failure();
    c.advance(10_000);
    expect(b.allow().allowed).toBe(true);
    b.failure();
    expect(b.current()).toBe("open");
  });

  it("frees the probe slot on a neutral outcome", () => {
    const c = fakeClock();
    const b = new CircuitBreaker({ failureThreshold: 1, cooldownSeconds: 10, clock: c.now });
    b.failure();
    c.advance(10_000);
    expect(b.allow().allowed).toBe(true);
    b.neutral();
    expect(b.allow().allowed).toBe(true);
  });

  it("a success resets the failure count", () => {
    const b = new CircuitBreaker({ failureThreshold: 2, cooldownSeconds: 10 });
    b.failure();
    b.success();
    b.failure();
    expect(b.current()).toBe("closed");
  });
});

describe("ConcurrencyGate", () => {
  it("rejects beyond the limit and releases exactly once", () => {
    const g = new ConcurrencyGate(2);
    const r1 = g.tryEnter();
    const r2 = g.tryEnter();
    expect(r1 && r2).toBeTruthy();
    expect(g.tryEnter()).toBeNull();
    r1!();
    r1!();
    expect(g.active()).toBe(1);
    expect(g.tryEnter()).not.toBeNull();
  });
});

describe("scaledPolicies", () => {
  it("scales capacity and refill together and never drops below one token", async () => {
    const { scaledPolicies, RATE_POLICIES } = await import("@/lib/traffic-guard");
    const doubled = scaledPolicies(2);
    expect(doubled.read!.capacity).toBe(RATE_POLICIES.read!.capacity * 2);
    expect(doubled.read!.refillPerSecond).toBe(RATE_POLICIES.read!.refillPerSecond * 2);
    expect(scaledPolicies(0.0001).upload!.capacity).toBe(1);
  });
});
