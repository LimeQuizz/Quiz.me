import "server-only";
import { cardsToCsv } from "@/lib/csv";
import { listCards } from "./cards";
import { getDeck } from "./decks";

/** CSV for a deck the user owns. Throws NotFoundError otherwise. */
export async function exportDeckCsv(userId: string, deckId: string): Promise<{ name: string; csv: string }> {
  const deck = await getDeck(userId, deckId);
  const rows = await listCards(userId, deckId);
  return { name: deck.name, csv: cardsToCsv(rows) };
}
