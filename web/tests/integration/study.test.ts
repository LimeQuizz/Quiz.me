import { beforeAll, describe, expect, it } from "vitest";
import { createDeck, getDeckStats, getDueCards, listDecks, recordReview } from "@/server/data";
import { getDb } from "@/server/db/client";
import { reviewLog } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { State } from "@/lib/fsrs";
import { basicCard, createUser } from "./helpers";

describe("study scheduling", () => {
  let user: string;
  let deckId: string;

  beforeAll(async () => {
    user = await createUser("student");
    const deck = await createDeck(user, {
      name: "Study",
      description: null,
      sourceFilename: null,
      cards: [basicCard("one", "1"), basicCard("two", "2"), basicCard("three", "3")],
    });
    deckId = deck.id;
  });

  it("new cards are all due", async () => {
    const due = await getDueCards(user, deckId);
    expect(due.map((c) => c.front)).toEqual(["one", "two", "three"]);
    expect(due.every((c) => c.progress === null)).toBe(true);
    const stats = await getDeckStats(user, deckId);
    expect(stats).toMatchObject({ total: 3, due: 3, newCards: 3 });
  });

  it("rating Easy schedules the card into the future and logs the review", async () => {
    const [first] = await getDueCards(user, deckId);
    const now = new Date();
    const progress = await recordReview(user, first!.id, 4, now);
    expect(progress.due.getTime()).toBeGreaterThan(now.getTime() + 24 * 3600 * 1000);
    expect(progress.state).toBe(State.Review);
    expect(progress.reps).toBe(1);

    const due = await getDueCards(user, deckId);
    expect(due.map((c) => c.front)).toEqual(["two", "three"]);
    const logs = await getDb().select().from(reviewLog).where(eq(reviewLog.cardId, first!.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rating).toBe(4);

    const [summary] = (await listDecks(user)).filter((d) => d.id === deckId);
    expect(summary).toMatchObject({ cardCount: 3, dueCount: 2 });
  });

  it("rating Again keeps the card in learning and due soon", async () => {
    const due = await getDueCards(user, deckId);
    const card = due[0]!;
    const now = new Date();
    const progress = await recordReview(user, card.id, 1, now);
    expect(progress.state).toBe(State.Learning);
    expect(progress.due.getTime() - now.getTime()).toBeLessThan(15 * 60 * 1000);
    const again = await recordReview(user, card.id, 3, progress.due);
    expect(again.reps).toBe(2);
  });
});
