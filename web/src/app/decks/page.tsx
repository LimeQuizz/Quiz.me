import type { Metadata } from "next";
import Link from "next/link";
import { listDecks } from "@/server/data";
import { requireUserId } from "@/server/auth/session";

export const metadata: Metadata = { title: "Your decks" };

export default async function DecksPage() {
  const userId = await requireUserId();
  const decks = await listDecks(userId);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Your decks</h1>
        <Link href="/upload" className="btn-primary">
          Upload a file
        </Link>
      </div>
      {decks.length === 0 ? (
        <div className="card space-y-2 text-center">
          <p className="font-medium">No decks yet.</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Upload a PDF or PowerPoint and Quiz.me will suggest cards for you to review.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {decks.map((d) => (
            <li key={d.id}>
              <Link href={`/decks/${d.id}`} className="card block h-full hover:border-brand-600" data-testid="deck-link">
                <h2 className="font-semibold break-words">{d.name}</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {d.cardCount} {d.cardCount === 1 ? "card" : "cards"} · {d.dueCount} due
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
