import { describe, expect, it } from "vitest";
import { evaluateRateLimit } from "@/lib/ratelimit";

const NOW = new Date("2026-01-01T12:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe("rate limiter", () => {
  it("allows up to 9 previous uploads in the hour", () => {
    expect(evaluateRateLimit(Array.from({ length: 9 }, (_, i) => ago(i * 60)), NOW)).toEqual({ allowed: true });
  });

  it("blocks the 11th upload in an hour with retry-after until the oldest expires", () => {
    const events = Array.from({ length: 10 }, (_, i) => ago(3000 - i * 60));
    expect(evaluateRateLimit(events, NOW)).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });

  it("ignores events outside the window", () => {
    const events = Array.from({ length: 10 }, () => ago(3601));
    expect(evaluateRateLimit(events, NOW).allowed).toBe(true);
  });

  it("applies the daily limit", () => {
    const events = Array.from({ length: 100 }, (_, i) => ago(80_000 - i * 60));
    const d = evaluateRateLimit(events, NOW);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSeconds).toBe(86_400 - 80_000);
  });

  it("reports the longest wait when both windows are full", () => {
    const events = [
      ...Array.from({ length: 90 }, () => ago(80_000)),
      ...Array.from({ length: 10 }, () => ago(100)),
    ];
    const d = evaluateRateLimit(events, NOW);
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 6400 });
  });
});
