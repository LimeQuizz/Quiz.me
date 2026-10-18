import type { Metadata } from "next";
import Link from "next/link";
import { parseId } from "@/lib/params";
import { getDeck, listCards, orNotFound } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { DeckEditor } from "./DeckEditor";

export const metadata: Metadata = { title: "Edit deck" };

export default async function EditDeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const userId = await requireUserId();
  const deckId = parseId((await params).deckId);
  const [deck, cards] = await Promise.all([orNotFound(getDeck(userId, deckId)), orNotFound(listCards(userId, deckId))]);
  return (
    <div className="space-y-4">
      <Link href={`/decks/${deck.id}`} className="text-sm text-brand-700 hover:underline dark:text-brand-500">
        ← Back to deck
      </Link>
      <DeckEditor
        deck={{ id: deck.id, name: deck.name, description: deck.description }}
        cards={cards.map((c) => ({ id: c.id, front: c.front, back: c.back, cardType: c.cardType, options: c.options }))}
      />
    </div>
  );
}
