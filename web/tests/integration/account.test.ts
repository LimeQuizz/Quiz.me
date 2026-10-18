import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDeck, deleteAccount, getAccount, listCards, recordReview, reserveUpload } from "@/server/data";
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
import { basicCard, createUser } from "./helpers";

async function countRows(userId: string, deckIds: string[], cardIds: string[]) {
  const db = getDb();
  return {
    users: (await db.select().from(users).where(eq(users.id, userId))).length,
    accounts: (await db.select().from(accounts).where(eq(accounts.userId, userId))).length,
    sessions: (await db.select().from(sessions).where(eq(sessions.userId, userId))).length,
    decks: deckIds.length ? (await db.select().from(decks).where(inArray(decks.id, deckIds))).length : 0,
    cards: cardIds.length ? (await db.select().from(cards).where(inArray(cards.id, cardIds))).length : 0,
    progress: (await db.select().from(cardProgress).where(eq(cardProgress.userId, userId))).length,
    reviews: (await db.select().from(reviewLog).where(eq(reviewLog.userId, userId))).length,
    uploads: (await db.select().from(uploadEvents).where(eq(uploadEvents.userId, userId))).length,
  };
}

describe("account deletion", () => {
  it("removes the user and every row they own, and nothing else", async () => {
    const db = getDb();
    const doomed = await createUser("doomed");
    const survivor = await createUser("survivor");
    await db.insert(accounts).values({ userId: doomed, type: "oidc", provider: "google", providerAccountId: `g-${doomed}` });
    await db.insert(sessions).values({ sessionToken: `tok-${doomed}`, userId: doomed, expires: new Date(Date.now() + 1e9) });
    const deck = await createDeck(doomed, {
      name: "Mine",
      description: null,
      sourceFilename: null,
      cards: [basicCard("q", "a"), basicCard("q2", "a2")],
    });
    const cardIds = (await listCards(doomed, deck.id)).map((c) => c.id);
    await recordReview(doomed, cardIds[0]!, 3);
    await reserveUpload(doomed, 10);
    const keep = await createDeck(survivor, { name: "Keep", description: null, sourceFilename: null, cards: [basicCard("x", "y")] });

    expect(await getAccount(doomed)).toMatchObject({ providers: ["google"] });
    expect(await countRows(doomed, [deck.id], cardIds)).toEqual({
      users: 1, accounts: 1, sessions: 1, decks: 1, cards: 2, progress: 1, reviews: 1, uploads: 1,
    });

    await deleteAccount(doomed);

    expect(await countRows(doomed, [deck.id], cardIds)).toEqual({
      users: 0, accounts: 0, sessions: 0, decks: 0, cards: 0, progress: 0, reviews: 0, uploads: 0,
    });
    expect(await getAccount(doomed)).toBeNull();
    expect(await listCards(survivor, keep.id)).toHaveLength(1);
  });
});
