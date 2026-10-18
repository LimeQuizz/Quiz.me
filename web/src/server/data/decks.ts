import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { cardProgress, cards, decks } from "@/server/db/schema";
import { LIMITS, type CardInput, type CreateDeckInput, type UpdateDeckInput } from "@/lib/validation";
import { LimitExceededError, NotFoundError } from "./errors";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DeckSummary {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
  dueCount: number;
  updatedAt: Date;
}

export interface Deck {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The one predicate every deck query uses. */
function ownedDeck(userId: string, deckId: string) {
  return and(eq(decks.id, deckId), eq(decks.userId, userId));
}

/** Throws NotFoundError unless ``deckId`` exists and belongs to ``userId``. */
export async function assertDeckOwned(userId: string, deckId: string, db: Database | Tx = getDb()): Promise<void> {
  const [row] = await db.select({ id: decks.id }).from(decks).where(ownedDeck(userId, deckId)).limit(1);
  if (!row) throw new NotFoundError("Deck not found");
}

export async function listDecks(userId: string, now: Date = new Date()): Promise<DeckSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: decks.id,
      name: decks.name,
      description: decks.description,
      updatedAt: decks.updatedAt,
      cardCount: sql<number>`count(${cards.id})::int`,
      // A card is due if it has never been reviewed or its due date passed.
      dueCount: sql<number>`count(${cards.id}) filter (where ${cardProgress.cardId} is null or ${cardProgress.due} <= ${now.toISOString()}::timestamptz)::int`,
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .leftJoin(cardProgress, and(eq(cardProgress.cardId, cards.id), eq(cardProgress.userId, userId)))
    .where(eq(decks.userId, userId))
    .groupBy(decks.id)
    .orderBy(desc(decks.updatedAt));
  return rows;
}

export async function getDeck(userId: string, deckId: string): Promise<Deck> {
  const [row] = await getDb().select().from(decks).where(ownedDeck(userId, deckId)).limit(1);
  if (!row) throw new NotFoundError("Deck not found");
  return row;
}

function cardValues(deckId: string, input: CardInput[], startPosition: number) {
  return input.map((c, i) => ({
    deckId,
    front: c.front,
    back: c.back,
    cardType: c.cardType,
    options: c.cardType === "multiple_choice" ? c.options : null,
    confidence: c.confidence,
    sourceRef: c.sourceRef,
    position: startPosition + i,
  }));
}

/** Create a deck and its cards atomically. */
export async function createDeck(userId: string, input: CreateDeckInput): Promise<Deck> {
  return getDb().transaction(async (tx) => {
    const [deck] = await tx
      .insert(decks)
      .values({
        userId,
        name: input.name,
        description: input.description,
        sourceFilename: input.sourceFilename,
      })
      .returning();
    await tx.insert(cards).values(cardValues(deck!.id, input.cards, 0));
    return deck!;
  });
}

/** Append cards to a deck the user owns. */
export async function addCards(userId: string, deckId: string, input: CardInput[]): Promise<number> {
  return getDb().transaction(async (tx) => {
    // Lock the deck row so concurrent appends get distinct positions.
    const [deck] = await tx
      .select({ id: decks.id })
      .from(decks)
      .where(ownedDeck(userId, deckId))
      .for("update")
      .limit(1);
    if (!deck) throw new NotFoundError("Deck not found");
    const [stats] = await tx
      .select({ n: count(), max: sql<number>`coalesce(max(${cards.position}), -1)::int` })
      .from(cards)
      .where(eq(cards.deckId, deckId));
    if ((stats?.n ?? 0) + input.length > LIMITS.cardsPerDeck) {
      throw new LimitExceededError(`A deck can hold at most ${LIMITS.cardsPerDeck} cards.`);
    }
    await tx.insert(cards).values(cardValues(deckId, input, (stats?.max ?? -1) + 1));
    await tx.update(decks).set({ updatedAt: new Date() }).where(ownedDeck(userId, deckId));
    return input.length;
  });
}

export async function updateDeck(userId: string, input: UpdateDeckInput): Promise<Deck> {
  const [row] = await getDb()
    .update(decks)
    .set({ name: input.name, description: input.description, updatedAt: new Date() })
    .where(ownedDeck(userId, input.deckId))
    .returning();
  if (!row) throw new NotFoundError("Deck not found");
  return row;
}

export async function deleteDeck(userId: string, deckId: string): Promise<void> {
  const deleted = await getDb().delete(decks).where(ownedDeck(userId, deckId)).returning({ id: decks.id });
  if (deleted.length === 0) throw new NotFoundError("Deck not found");
}

