import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/server/data/account", () => ({ findOrCreateTestUser: vi.fn() }));
vi.mock("@/server/auth/adapter", () => ({ createAdapter: () => ({ createSession: vi.fn() }) }));

const { assertTestModeAllowed, createTestProvider } = await import("@/server/auth/test-provider");
const { buildAuthConfig, buildProviders, MICROSOFT_COMMON_ISSUER, sessionCookieName } = await import(
  "@/server/auth/config"
);

type ProviderLike = { id: string; options?: { id?: string } };
const providerIds = (env: Record<string, string>) =>
  buildProviders(env).map((p) => {
    const provider = (typeof p === "function" ? p() : p) as unknown as ProviderLike;
    return provider.options?.id ?? provider.id;
  });

const base = {
  AUTH_URL: "https://quiz.example",
  AUTH_GOOGLE_ID: "g",
  AUTH_GOOGLE_SECRET: "gs",
  AUTH_MICROSOFT_ENTRA_ID_ID: "m",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "ms",
};

describe("auth configuration", () => {
  it("offers exactly Google and Microsoft Entra ID", () => {
    expect(providerIds(base)).toEqual(["google", "microsoft-entra-id"]);
  });

  it("uses the common Microsoft endpoint (personal + work/school)", () => {
    const ms = buildProviders(base).map((p) => (typeof p === "function" ? p() : p))[1] as unknown as {
      options: { issuer: string };
    };
    expect(ms.options.issuer).toBe(MICROSOFT_COMMON_ISSUER);
  });

  it("uses database sessions, 30 days, rolling, secure lax httpOnly cookies", () => {
    const cfg = buildAuthConfig(base);
    expect(cfg.session).toEqual({ strategy: "database", maxAge: 2_592_000, updateAge: 86_400 });
    expect(cfg.useSecureCookies).toBe(true);
    expect(cfg.cookies?.sessionToken).toEqual({
      name: "__Secure-authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
    });
    expect(cfg.jwt).toBeUndefined();
  });

  it("names the cookie without __Secure- on plain http (local dev only)", () => {
    expect(sessionCookieName(false)).toBe("authjs.session-token");
  });
});

describe("test sign-in provider", () => {
  it("refuses to load unless AUTH_TEST_MODE=true", () => {
    expect(() => assertTestModeAllowed({ AUTH_URL: "http://localhost:3000" })).toThrow(/AUTH_TEST_MODE=true/);
    expect(() => assertTestModeAllowed({ AUTH_TEST_MODE: "1", AUTH_URL: "http://localhost:3000" })).toThrow();
    expect(() => createTestProvider({ AUTH_TEST_MODE: "false" })).toThrow();
  });

  it("refuses to load when AUTH_URL is not local", () => {
    expect(() => assertTestModeAllowed({ AUTH_TEST_MODE: "true", AUTH_URL: "https://quiz.example" })).toThrow(
      /not a local address/,
    );
  });

  it("loads for the local e2e stack and is not offered otherwise", () => {
    const env = { ...base, AUTH_URL: "http://localhost:3000", AUTH_TEST_MODE: "true" };
    expect(providerIds(env)).toContain("test-credentials");
    expect(buildAuthConfig(env).jwt?.encode).toBeTypeOf("function");
    expect(() => buildProviders({ ...base, AUTH_TEST_MODE: "true" })).toThrow();
  });
});
