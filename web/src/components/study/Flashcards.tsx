"use client";

import { useState, useTransition } from "react";
import { formatInterval, previewIntervals, Rating } from "@/lib/fsrs";
import { rateCardAction } from "@/server/actions/study";
import { Done } from "./Done";
import type { DueCard } from "./types";

const BUTTONS = [
  { rating: Rating.Again, label: "Again", className: "bg-red-600 hover:bg-red-700" },
  { rating: Rating.Hard, label: "Hard", className: "bg-amber-600 hover:bg-amber-700" },
  { rating: Rating.Good, label: "Good", className: "bg-brand-600 hover:bg-brand-700" },
  { rating: Rating.Easy, label: "Easy", className: "bg-sky-600 hover:bg-sky-700" },
] as const;

export function Flashcards({ deckId, initial }: { deckId: string; initial: DueCard[] }) {
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const card = queue[0];

  if (!card) {
    return (
      <Done deckId={deckId} title={reviewed ? "All caught up" : "Nothing due right now"}>
        <p className="text-zinc-600 dark:text-zinc-400">
          {reviewed ? `You reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}.` : "Come back later, or practice with another mode."}
        </p>
      </Done>
    );
  }

  const intervals = previewIntervals(card.progress);

  function rate(rating: (typeof BUTTONS)[number]["rating"]) {
    if (!card) return;
    start(async () => {
      const result = await rateCardAction({ cardId: card.id, rating });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setReviewed((n) => n + 1);
      setFlipped(false);
      setQueue((prev) => {
        const [, ...rest] = prev;
        // Cards rated Again come back at the end of this session.
        return rating === Rating.Again ? [...rest, { ...card, progress: null }] : rest;
      });
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500" aria-live="polite">
        {queue.length} left · {reviewed} reviewed
      </p>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={flipped ? "Show question" : "Show answer"}
        className="card flex min-h-64 w-full flex-col items-center justify-center gap-4 text-center text-lg hover:border-brand-600 sm:min-h-80"
        data-testid="flashcard"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{flipped ? "Answer" : "Question"}</span>
        <span className="whitespace-pre-line break-words text-xl font-medium" data-testid={flipped ? "card-back" : "card-front"}>
          {flipped ? card.back : card.front}
        </span>
        {!flipped && card.options && (
          <ul className="space-y-1 text-base text-zinc-600 dark:text-zinc-400">
            {card.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        )}
        {!flipped && <span className="text-sm text-zinc-500">Tap to flip</span>}
      </button>
      {flipped && (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
          {BUTTONS.map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={pending}
              onClick={() => rate(b.rating)}
              className={`btn flex-col gap-0 px-1 text-white ${b.className}`}
            >
              <span>{b.label}</span>
              <span className="text-xs font-normal opacity-90">{formatInterval(intervals[b.rating])}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
