import "server-only";
import Credentials from "next-auth/providers/credentials";
import { testSignInSchema } from "@/lib/validation";
import { findOrCreateTestUser } from "@/server/data/account";

export const TEST_PROVIDER_ID = "test-credentials";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "web"]);

/**
 * Throws unless the test provider may load: AUTH_TEST_MODE must be exactly
 * "true" and AUTH_URL must point at a local host (the docker-compose e2e
 * stack). This keeps a stray environment variable from enabling password-less
 * sign-in on a real deployment.
 */
export function assertTestModeAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.AUTH_TEST_MODE !== "true") {
    throw new Error("The test sign-in provider is only available when AUTH_TEST_MODE=true.");
  }
  let host = "";
  try {
    host = new URL(env.AUTH_URL ?? "").hostname;
  } catch {
    // fall through
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("AUTH_TEST_MODE=true is refused because AUTH_URL is not a local address.");
  }
}

/** Credentials provider for Playwright e2e tests. Never enabled in production. */
export function createTestProvider(env: Record<string, string | undefined> = process.env) {
  assertTestModeAllowed(env);
  return Credentials({
    id: TEST_PROVIDER_ID,
    name: "Test account",
    credentials: { email: { label: "Test email", type: "email" } },
    async authorize(raw) {
      const parsed = testSignInSchema.safeParse({ email: raw?.email });
      if (!parsed.success) return null;
      return findOrCreateTestUser(parsed.data.email);
    },
  });
}
