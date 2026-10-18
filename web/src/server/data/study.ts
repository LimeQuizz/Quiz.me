import "server-only";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { cardProgress, cards, decks, reviewLog } from "@/server/db/schema";
import { review, type ProgressFields } from "@/lib/fsrs";
import type { Grade } from "ts-fsrs";
import { NotFoundError } from "./errors";
import type { CardRow } from "./cards";

export interface StudyCard extends CardRow {
  progress: ProgressFields | null;
}

export interface DeckStats {
  total: number;
  due: number;
  newCards: number;
  learning: number;
  review: number;
}

/** Cards due now (including new cards) for a deck the user owns. */
export async function getDueCards(
  userId: string,
  deckId: string,
  { now = new Date(), limit = 50 }: { now?: Date; limit?: number } = {},
): Promise<StudyCard[]> {
  const rows = await getDb()
    .select({
      id: cards.id,
      deckId: cards.deckId,
      front: cards.front,
      back: cards.back,
      cardType: cards.cardType,
      options: cards.options,
      confidence: cards.confidence,
      sourceRef: cards.sourceRef,
      position: cards.position,
      progress: cardProgress,
    })
    .from(cards)
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)))
    .leftJoin(cardProgress, and(eq(cardProgress.cardId, cards.id), eq(cardProgress.userId, userId)))
    .where(and(eq(cards.deckId, deckId), or(isNull(cardProgress.cardId), lte(cardProgress.due, now))))
    .orderBy(sql`${cardProgress.due} asc nulls last`, asc(cards.position))
    .limit(limit);
  if (rows.length === 0) await assertOwned(userId, deckId);
  return rows.map(({ progress, ...card }) => ({
    ...card,
    progress: progress
      ? {
          due: progress.due,
          stability: progress.stability,
          difficulty: progress.difficulty,
          reps: progress.reps,
          lapses: progress.lapses,
          state: progress.state,
          lastReview: progress.lastReview,
          scheduledDays: progress.scheduledDays,
          learningSteps: progress.learningSteps,
        }
      : null,
  }));
}

async function assertOwned(userId: string, deckId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("Deck not found");
}

export async function getDeckStats(userId: string, deckId: string, now: Date = new Date()): Promise<DeckStats> {
  await assertOwned(userId, deckId);
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${cardProgress.cardId} is null or ${cardProgress.due} <= ${now.toISOString()}::timestamptz)::int`,
      newCards: sql<number>`count(*) filter (where ${cardProgress.cardId} is null or ${cardProgress.state} = 0)::int`,
      learning: sql<number>`count(*) filter (where ${cardProgress.state} in (1, 3))::int`,
      review: sql<number>`count(*) filter (where ${cardProgress.state} = 2)::int`,
    })
    .from(cards)
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)))
    .leftJoin(cardProgress, and(eq(cardProgress.cardId, cards.id), eq(cardProgress.userId, userId)))
    .where(eq(cards.deckId, deckId));
  return row ?? { total: 0, due: 0, newCards: 0, learning: 0, review: 0 };
}

/** Record one flashcard rating and reschedule the card with FSRS. */
export async function recordReview(
  userId: string,
  cardId: string,
  rating: Grade,
  now: Date = new Date(),
): Promise<ProgressFields> {
  return getDb().transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(decks, eq(decks.id, cards.deckId))
      .where(and(eq(cards.id, cardId), eq(decks.userId, userId)))
      .limit(1);
    if (!owned) throw new NotFoundError("Card not found");
    const [current] = await tx
      .select()
      .from(cardProgress)
      .where(and(eq(cardProgress.cardId, cardId), eq(cardProgress.userId, userId)))
      .for("update");
    const outcome = review(current ?? null, rating, now);
    await tx
      .insert(cardProgress)
      .values({ cardId, userId, ...outcome.progress })
      .onConflictDoUpdate({ target: [cardProgress.cardId, cardProgress.userId], set: outcome.progress });
    await tx.insert(reviewLog).values({ cardId, userId, ...outcome.log });
    return outcome.progress;
  });
}
