"use client";

import { useMemo, useState } from "react";
import { shuffle } from "@/lib/distractors";
import { checkAnswer } from "@/lib/fuzzy";
import { Done } from "./Done";
import type { PracticeCard } from "./types";

export function WriteQuestionView({
  card,
  answered,
  onSubmit,
}: {
  card: PracticeCard;
  answered: { given: string; correct: boolean; exact: boolean } | null;
  onSubmit: (given: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (answered === null) onSubmit(value);
      }}
    >
      <div className="card min-h-32 whitespace-pre-line break-words text-lg font-medium">{card.front}</div>
      <label htmlFor={`answer-${card.id}`} className="label">
        Your answer
      </label>
      <input
        id={`answer-${card.id}`}
        className="input"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={2000}
        value={value}
        readOnly={answered !== null}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      {answered === null ? (
        <button type="submit" className="btn-primary w-full">
          Check
        </button>
      ) : (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ${answered.correct ? "bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-500" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          <p className="font-semibold">{answered.correct ? (answered.exact ? "Correct" : "Correct, with a small typo") : "Not quite"}</p>
          <p className="mt-1 whitespace-pre-line break-words">Answer: {card.back}</p>
        </div>
      )}
    </form>
  );
}

export function WriteMode({ deckId, cards }: { deckId: string; cards: PracticeCard[] }) {
  const order = useMemo(() => shuffle(cards).slice(0, 20), [cards]);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<{ given: string; correct: boolean; exact: boolean } | null>(null);
  const [score, setScore] = useState(0);
  const card = order[index];

  if (order.length === 0) return <Done deckId={deckId} title="This deck has no cards" />;
  if (!card) {
    return (
      <Done deckId={deckId} title={`${score} / ${order.length} correct`}>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Practice again
        </button>
      </Done>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Card {index + 1} of {order.length} · {score} correct
      </p>
      <WriteQuestionView
        key={card.id}
        card={card}
        answered={answered}
        onSubmit={(given) => {
          const result = checkAnswer(given, card.back);
          setAnswered({ given, ...result });
          if (result.correct) setScore((s) => s + 1);
        }}
      />
      {answered && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setAnswered(null);
            setIndex((i) => i + 1);
          }}
        >
          Next
        </button>
      )}
    </div>
  );
}
