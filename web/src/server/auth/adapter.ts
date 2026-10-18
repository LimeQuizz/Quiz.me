import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import type { Database } from "@/server/db/client";
import { accounts, sessions, users, verificationTokens } from "@/server/db/schema";

/**
 * Auth.js Drizzle adapter with two deliberate changes:
 *
 * 1. getUserByEmail always returns null, so Auth.js never links a new provider
 *    account to an existing user because the emails match. Microsoft personal
 *    account emails are not necessarily verified, so email is not proof of
 *    identity. One provider account = one user, unless a signed-in user links
 *    a second provider from /account.
 * 2. linkAccount stores only the identifying columns. OAuth access, refresh,
 *    and ID tokens are discarded: the app never calls provider APIs later, so
 *    keeping them would only create something worth stealing.
 */
export function createAdapter(db: Database): Adapter {
  const base = DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  return {
    ...base,
    async getUserByEmail() {
      return null;
    },
    async createUser(user: AdapterUser) {
      return base.createUser!({ ...user, image: null });
    },
    async linkAccount(account: AdapterAccount) {
      await base.linkAccount!({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
    },
  };
}
