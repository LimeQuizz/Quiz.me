import type { Metadata } from "next";
import Link from "next/link";
import { parseId } from "@/lib/params";
import { getDeck, getDeckStats, orNotFound } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { deleteDeckAction } from "@/server/actions/decks";
import { ConfirmButton } from "@/components/ConfirmButton";

export const metadata: Metadata = { title: "Deck" };

export default async function DeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const userId = await requireUserId();
  const deckId = parseId((await params).deckId);
  const [deck, stats] = await Promise.all([
    orNotFound(getDeck(userId, deckId)),
    orNotFound(getDeckStats(userId, deckId)),
  ]);
  const learned = stats.review;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold break-words" data-testid="deck-title">
          {deck.name}
        </h1>
        {deck.description && <p className="text-zinc-600 dark:text-zinc-400 whitespace-pre-line">{deck.description}</p>}
        {deck.sourceFilename && <p className="text-xs text-zinc-500">From {deck.sourceFilename}</p>}
      </div>

      <section className="card space-y-3" aria-label="Progress">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-bold" data-testid="due-count">
            {stats.due}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">due now of {stats.total} cards</p>
        </div>
        <progress value={learned} max={Math.max(stats.total, 1)} aria-label="Cards in long-term review" />
        <dl className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <dt className="text-zinc-500">New</dt>
            <dd className="font-semibold">{stats.newCards}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Learning</dt>
            <dd className="font-semibold">{stats.learning}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Review</dt>
            <dd className="font-semibold">{stats.review}</dd>
          </div>
        </dl>
        <Link href={`/decks/${deck.id}/study/flashcards`} className="btn-primary w-full">
          Study
        </Link>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Practice</h2>
        <div className="grid grid-cols-3 gap-2">
          <Link href={`/decks/${deck.id}/study/choice`} className="btn-secondary">
            Multiple choice
          </Link>
          <Link href={`/decks/${deck.id}/study/write`} className="btn-secondary">
            Write
          </Link>
          <Link href={`/decks/${deck.id}/study/test`} className="btn-secondary">
            Test
          </Link>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Link href={`/decks/${deck.id}/edit`} className="btn-secondary">
          Edit cards
        </Link>
        <Link href={`/upload?deckId=${deck.id}`} className="btn-secondary">
          Add from a file
        </Link>
        <a href={`/api/decks/${deck.id}/export`} className="btn-secondary" download>
          Export CSV
        </a>
        <form action={deleteDeckAction} className="ml-auto">
          <input type="hidden" name="deckId" value={deck.id} />
          <ConfirmButton className="btn-danger" message="Delete this deck and all of its cards? This cannot be undone.">
            Delete deck
          </ConfirmButton>
        </form>
      </section>
    </div>
  );
}
