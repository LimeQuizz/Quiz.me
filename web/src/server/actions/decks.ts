"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  addCardsSchema,
  createDeckSchema,
  idOnlySchema,
  updateCardSchema,
  updateDeckSchema,
} from "@/lib/validation";
import { log } from "@/lib/logger";
import {
  addCards,
  createDeck,
  deleteCard,
  deleteDeck,
  LimitExceededError,
  NotFoundError,
  updateCard,
  updateDeck,
} from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { validationError, type ActionResult } from "./result";

function handle(err: unknown): ActionResult<never> {
  if (err instanceof NotFoundError) notFound();
  if (err instanceof LimitExceededError) return { ok: false, error: err.message };
  throw err;
}

/** Save the reviewed cards as a new deck. */
export async function createDeckAction(input: unknown): Promise<ActionResult<{ deckId: string }>> {
  const userId = await requireUserId();
  const parsed = createDeckSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const deck = await createDeck(userId, parsed.data);
  log.info("deck created", { userId, deckId: deck.id, cards: parsed.data.cards.length });
  revalidatePath("/decks");
  return { ok: true, data: { deckId: deck.id } };
}

/** Append reviewed cards to an existing deck the caller owns. */
export async function addCardsAction(input: unknown): Promise<ActionResult<{ deckId: string }>> {
  const userId = await requireUserId();
  const parsed = addCardsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await addCards(userId, parsed.data.deckId, parsed.data.cards);
  } catch (err) {
    return handle(err);
  }
  revalidatePath(`/decks/${parsed.data.deckId}`);
  return { ok: true, data: { deckId: parsed.data.deckId } };
}

export async function updateDeckAction(input: unknown): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = updateDeckSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await updateDeck(userId, parsed.data);
  } catch (err) {
    return handle(err);
  }
  revalidatePath(`/decks/${parsed.data.deckId}`);
  return { ok: true, data: undefined };
}

export async function deleteDeckAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = idOnlySchema.safeParse({ id: formData.get("deckId") });
  if (!parsed.success) notFound();
  try {
    await deleteDeck(userId, parsed.data.id);
  } catch (err) {
    handle(err);
  }
  log.info("deck deleted", { userId, deckId: parsed.data.id });
  revalidatePath("/decks");
  redirect("/decks");
}

export async function updateCardAction(input: unknown): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = updateCardSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await updateCard(userId, parsed.data);
  } catch (err) {
    return handle(err);
  }
  return { ok: true, data: undefined };
}

export async function deleteCardAction(input: unknown): Promise<ActionResult> {
  const userId = await requireUserId();
  const parsed = idOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await deleteCard(userId, parsed.data.id);
  } catch (err) {
    return handle(err);
  }
  return { ok: true, data: undefined };
}
