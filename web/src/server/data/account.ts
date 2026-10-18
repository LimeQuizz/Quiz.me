import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  accounts,
  cardProgress,
  cards,
  decks,
  reviewLog,
  sessions,
  uploadEvents,
  users,
} from "@/server/db/schema";

export interface AccountInfo {
  name: string | null;
  email: string | null;
  providers: string[];
}

export async function getAccount(userId: string): Promise<AccountInfo | null> {
  const db = getDb();
  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const linked = await db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId));
  return { ...user, providers: linked.map((a) => a.provider).sort() };
}

/**
 * Delete the user and every row that belongs to them in one transaction.
 * Foreign keys cascade as well; the explicit deletes make the intent and the
 * order obvious and do not depend on cascade configuration.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const deckIds = tx.select({ id: decks.id }).from(decks).where(eq(decks.userId, userId));
    const cardIds = tx.select({ id: cards.id }).from(cards).where(inArray(cards.deckId, deckIds));
    await tx.delete(reviewLog).where(eq(reviewLog.userId, userId));
    await tx.delete(reviewLog).where(inArray(reviewLog.cardId, cardIds));
    await tx.delete(cardProgress).where(eq(cardProgress.userId, userId));
    await tx.delete(cardProgress).where(inArray(cardProgress.cardId, cardIds));
    await tx.delete(cards).where(inArray(cards.deckId, deckIds));
    await tx.delete(decks).where(eq(decks.userId, userId));
    await tx.delete(uploadEvents).where(eq(uploadEvents.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

/** Test-mode only: find or create the user for an e2e sign-in. */
export async function findOrCreateTestUser(email: string): Promise<{ id: string; name: string | null; email: string | null }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ email, name: email.split("@")[0] ?? "Test user" })
    .returning({ id: users.id, name: users.name, email: users.email });
  return created!;
}
