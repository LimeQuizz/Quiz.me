import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { cards, decks } from "@/server/db/schema";
import type { CardType } from "@/lib/constants";
import type { UpdateCardInput } from "@/lib/validation";
import { NotFoundError } from "./errors";

export interface CardRow {
  id: string;
  deckId: string;
  front: string;
  back: string;
  cardType: CardType;
  options: string[] | null;
  confidence: number | null;
  sourceRef: string | null;
  position: number;
}

const cardColumns = {
  id: cards.id,
  deckId: cards.deckId,
  front: cards.front,
  back: cards.back,
  cardType: cards.cardType,
  options: cards.options,
  confidence: cards.confidence,
  sourceRef: cards.sourceRef,
  position: cards.position,
};

/** Cards of one deck, only if the deck belongs to ``userId``. */
export async function listCards(userId: string, deckId: string): Promise<CardRow[]> {
  const db = getDb();
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) throw new NotFoundError("Deck not found");
  return db
    .select(cardColumns)
    .from(cards)
    .innerJoin(decks, eq(decks.id, cards.deckId))
    .where(and(eq(cards.deckId, deckId), eq(decks.userId, userId)))
    .orderBy(asc(cards.position));
}

/** Return the IDs among ``cardIds`` that belong to ``userId`` (via their deck). */
export async function ownedCardIds(userId: string, cardIds: string[]): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(decks, eq(decks.id, cards.deckId))
    .where(and(inArray(cards.id, cardIds), eq(decks.userId, userId)));
  return new Set(rows.map((r) => r.id));
}

export async function updateCard(userId: string, input: UpdateCardInput): Promise<void> {
  const db = getDb();
  const owned = await ownedCardIds(userId, [input.cardId]);
  if (!owned.has(input.cardId)) throw new NotFoundError("Card not found");
  const [current] = await db
    .select({ cardType: cards.cardType, options: cards.options, back: cards.back })
    .from(cards)
    .where(eq(cards.id, input.cardId));
  // Keep a multiple choice card consistent: if the answer text changes, the
  // matching option changes with it.
  let options = current?.options ?? null;
  if (current?.cardType === "multiple_choice" && options) {
    options = options.map((o) => (o === current.back ? input.back : o));
  }
  await db
    .update(cards)
    .set({ front: input.front, back: input.back, options, updatedAt: new Date() })
    .where(
      and(
        eq(cards.id, input.cardId),
        inArray(cards.deckId, db.select({ id: decks.id }).from(decks).where(eq(decks.userId, userId))),
      ),
    );
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  const db = getDb();
  const deleted = await db
    .delete(cards)
    .where(
      and(
        eq(cards.id, cardId),
        inArray(cards.deckId, db.select({ id: decks.id }).from(decks).where(eq(decks.userId, userId))),
      ),
    )
    .returning({ id: cards.id });
  if (deleted.length === 0) throw new NotFoundError("Card not found");
}
