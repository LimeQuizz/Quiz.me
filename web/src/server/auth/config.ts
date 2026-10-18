import "server-only";
import { randomUUID } from "node:crypto";
import type { NextAuthConfig } from "next-auth";
import { encode as defaultEncode } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getDb } from "@/server/db/client";
import { log } from "@/lib/logger";
import { createAdapter } from "./adapter";
import { createTestProvider, TEST_PROVIDER_ID } from "./test-provider";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
/** "common" accepts personal Microsoft accounts and work/school accounts. */
export const MICROSOFT_COMMON_ISSUER = "https://login.microsoftonline.com/common/v2.0";

type Env = Record<string, string | undefined>;

let warnedTestMode = false;

export function secureCookiesFor(env: Env = process.env): boolean {
  return (env.AUTH_URL ?? "").startsWith("https://");
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function buildProviders(env: Env = process.env): NextAuthConfig["providers"] {
  const providers: NextAuthConfig["providers"] = [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Do not store the provider's avatar URL: no third-party images, and
      // less personal data.
      profile: (p) => ({ id: p.sub, name: p.name, email: p.email, image: null }),
    }),
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || MICROSOFT_COMMON_ISSUER,
      // No User.Read scope: the app never calls Microsoft Graph.
      authorization: { params: { scope: "openid profile email" } },
      profile: (p) => ({
        id: p.sub,
        name: p.name,
        email: (p.email as string | undefined) ?? (p.preferred_username as string | undefined) ?? null,
        image: null,
      }),
    }),
  ];
  if (env.AUTH_TEST_MODE === "true") {
    providers.push(createTestProvider(env));
    if (!warnedTestMode) {
      warnedTestMode = true;
      log.warn("AUTH_TEST_MODE is enabled: password-less test sign-in is active");
    }
  }
  return providers;
}

export function buildAuthConfig(env: Env = process.env): NextAuthConfig {
  const adapter = createAdapter(getDb());
  const secure = secureCookiesFor(env);
  const testMode = env.AUTH_TEST_MODE === "true";
  const config: NextAuthConfig = {
    adapter,
    providers: buildProviders(env),
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    trustHost: true,
    useSecureCookies: secure,
    cookies: {
      sessionToken: {
        name: sessionCookieName(secure),
        options: { httpOnly: true, sameSite: "lax", path: "/", secure },
      },
    },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
      jwt({ token, account }) {
        // Only reached by the test Credentials provider (database sessions
        // otherwise never touch JWTs). Mark the token so encode() below turns
        // it into a database session instead of a JWT cookie.
        if (account?.provider === TEST_PROVIDER_ID) token.testSession = true;
        return token;
      },
    },
    logger: {
      error(error) {
        log.error("auth error", { error: error.name, type: (error as { type?: string }).type ?? null });
      },
      warn(code) {
        log.warn("auth warning", { code });
      },
      debug() {},
    },
  };
  if (testMode) {
    config.jwt = {
      async encode(params) {
        if (params.token?.testSession && params.token.sub) {
          const sessionToken = randomUUID();
          await adapter.createSession!({
            sessionToken,
            userId: params.token.sub,
            expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
          });
          return sessionToken;
        }
        return defaultEncode(params);
      },
    };
  }
  return config;
}
