import { describe, expect, it } from "vitest";
import { bodyLimitFor, buildCsp, generateNonce, isAllowedOrigin, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("security headers", () => {
  it("builds a strict nonce CSP without unsafe-inline", () => {
    const csp = buildCsp({ nonce: "abc123" });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("only relaxes eval in development", () => {
    expect(buildCsp({ nonce: "n", dev: true })).toContain("'unsafe-eval'");
  });

  it("generates unique base64 nonces", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });

  it("sets the static headers", () => {
    expect(STATIC_SECURITY_HEADERS).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(STATIC_SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
  });

  it("checks origin on mutating requests only", () => {
    const allowed = ["https://quiz.example"];
    expect(isAllowedOrigin("GET", null, allowed)).toBe(true);
    expect(isAllowedOrigin("POST", "https://quiz.example", allowed)).toBe(true);
    expect(isAllowedOrigin("POST", "https://evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("DELETE", null, allowed)).toBe(false);
    expect(isAllowedOrigin("post", "null", allowed)).toBe(false);
  });

  it("has a body limit per route", () => {
    expect(bodyLimitFor("/api/uploads")).toBe(25 * 1024 * 1024);
    expect(bodyLimitFor("/decks")).toBe(3 * 1024 * 1024);
  });
});
