"use client";

import { useMemo, useState } from "react";
import { buildChoices, shuffle } from "@/lib/distractors";
import { normalizeAnswer } from "@/lib/fuzzy";
import { Done } from "./Done";
import type { PracticeCard } from "./types";

export interface ChoiceQuestion {
  card: PracticeCard;
  choices: string[];
}

export function makeChoiceQuestions(cards: PracticeCard[], limit = 20): ChoiceQuestion[] {
  const out: ChoiceQuestion[] = [];
  for (const card of shuffle(cards)) {
    const choices = buildChoices(card, cards);
    if (choices) out.push({ card, choices });
    if (out.length >= limit) break;
  }
  return out;
}

export function ChoiceQuestionView({
  q,
  picked,
  onPick,
}: {
  q: ChoiceQuestion;
  picked: string | null;
  onPick: (choice: string) => void;
}) {
  const correct = normalizeAnswer(q.card.back);
  return (
    <div className="space-y-3">
      <div className="card min-h-32 whitespace-pre-line break-words text-lg font-medium">{q.card.front}</div>
      <div className="grid gap-2">
        {q.choices.map((choice) => {
          const isCorrect = normalizeAnswer(choice) === correct;
          const state = picked === null ? "" : isCorrect ? "border-brand-600 bg-brand-50 dark:bg-brand-700/20" : picked === choice ? "border-red-600 bg-red-50 dark:bg-red-950" : "opacity-60";
          return (
            <button
              key={choice}
              type="button"
              disabled={picked !== null}
              onClick={() => onPick(choice)}
              className={`card min-h-11 text-left whitespace-pre-line break-words ${state}`}
            >
              {choice}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MultipleChoice({ deckId, cards }: { deckId: string; cards: PracticeCard[] }) {
  const questions = useMemo(() => makeChoiceQuestions(cards), [cards]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  if (questions.length === 0) {
    return (
      <Done deckId={deckId} title="Not enough cards">
        <p className="text-zinc-600 dark:text-zinc-400">Multiple choice needs at least two cards with different answers.</p>
      </Done>
    );
  }
  const q = questions[index];
  if (!q) {
    return (
      <Done deckId={deckId} title={`${score} / ${questions.length} correct`}>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Practice again
        </button>
      </Done>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Question {index + 1} of {questions.length} · {score} correct
      </p>
      <ChoiceQuestionView
        q={q}
        picked={picked}
        onPick={(choice) => {
          setPicked(choice);
          if (normalizeAnswer(choice) === normalizeAnswer(q.card.back)) setScore((s) => s + 1);
        }}
      />
      {picked !== null && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setPicked(null);
            setIndex((i) => i + 1);
          }}
        >
          Next
        </button>
      )}
    </div>
  );
}
