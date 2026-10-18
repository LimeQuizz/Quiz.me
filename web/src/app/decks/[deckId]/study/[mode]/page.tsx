import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/params";
import { getDeck, getDueCards, listCards, orNotFound } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { Flashcards } from "@/components/study/Flashcards";
import { MultipleChoice } from "@/components/study/MultipleChoice";
import { TestMode } from "@/components/study/TestMode";
import { WriteMode } from "@/components/study/WriteMode";

const MODES = { flashcards: "Flashcards", choice: "Multiple choice", write: "Write", test: "Test" } as const;
type Mode = keyof typeof MODES;

export const metadata: Metadata = { title: "Study" };

export default async function StudyPage({ params }: { params: Promise<{ deckId: string; mode: string }> }) {
  const userId = await requireUserId();
  const p = await params;
  const deckId = parseId(p.deckId);
  if (!(p.mode in MODES)) notFound();
  const mode = p.mode as Mode;
  const deck = await orNotFound(getDeck(userId, deckId));

  let body: React.ReactNode;
  if (mode === "flashcards") {
    const due = await orNotFound(getDueCards(userId, deckId, { limit: 100 }));
    body = <Flashcards deckId={deck.id} initial={due.map((c) => ({ id: c.id, front: c.front, back: c.back, options: c.options, progress: c.progress }))} />;
  } else {
    const cards = (await orNotFound(listCards(userId, deckId))).map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      options: c.options,
    }));
    body =
      mode === "choice" ? <MultipleChoice deckId={deck.id} cards={cards} /> : mode === "write" ? <WriteMode deckId={deck.id} cards={cards} /> : <TestMode deckId={deck.id} cards={cards} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/decks/${deck.id}`} className="text-sm text-brand-700 hover:underline dark:text-brand-500">
          ← {deck.name}
        </Link>
        <span className="text-sm font-medium text-zinc-500">{MODES[mode]}</span>
      </div>
      {body}
    </div>
  );
}
