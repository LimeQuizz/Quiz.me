"use client";

import { useMemo, useState } from "react";
import { buildChoices, shuffle } from "@/lib/distractors";
import { checkAnswer, normalizeAnswer } from "@/lib/fuzzy";
import { ChoiceQuestionView } from "./MultipleChoice";
import { WriteQuestionView } from "./WriteMode";
import { Done } from "./Done";
import type { PracticeCard } from "./types";

export const TEST_LENGTH = 10;

type Question = { kind: "choice"; card: PracticeCard; choices: string[] } | { kind: "write"; card: PracticeCard };

function buildTest(cards: PracticeCard[]): Question[] {
  return shuffle(cards)
    .slice(0, TEST_LENGTH)
    .map((card, i) => {
      // Alternate question types; fall back to writing when no choices exist.
      const choices = i % 2 === 0 ? buildChoices(card, cards) : null;
      return choices ? { kind: "choice", card, choices } : { kind: "write", card };
    });
}

export function TestMode({ deckId, cards }: { deckId: string; cards: PracticeCard[] }) {
  const questions = useMemo(() => buildTest(cards), [cards]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<{ card: PracticeCard; given: string; correct: boolean }[]>([]);
  const [current, setCurrent] = useState<{ given: string; correct: boolean; exact: boolean } | null>(null);
  const q = questions[index];

  if (questions.length === 0) return <Done deckId={deckId} title="This deck has no cards" />;
  if (!q) {
    const score = results.filter((r) => r.correct).length;
    const missed = results.filter((r) => !r.correct);
    return (
      <Done deckId={deckId} title={`Score: ${score} / ${questions.length}`}>
        <p className="text-4xl font-bold" data-testid="test-score">
          {Math.round((score / questions.length) * 100)}%
        </p>
        {missed.length > 0 && (
          <div className="text-left">
            <h3 className="font-semibold">Review these</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {missed.map((m) => (
                <li key={m.card.id} className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                  <p className="font-medium break-words">{m.card.front}</p>
                  <p className="break-words text-zinc-600 dark:text-zinc-400">Answer: {m.card.back}</p>
                  {m.given && <p className="break-words text-red-700 dark:text-red-400">You said: {m.given}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Take another test
        </button>
      </Done>
    );
  }

  function record(given: string, correct: boolean, exact = correct) {
    if (!q) return;
    setCurrent({ given, correct, exact });
    setResults((r) => [...r, { card: q.card, given, correct }]);
  }

  return (
    <div className="space-y-4">
      <progress value={index} max={questions.length} aria-label="Test progress" />
      <p className="text-sm text-zinc-500">
        Question {index + 1} of {questions.length}
      </p>
      {q.kind === "choice" ? (
        <ChoiceQuestionView
          q={q}
          picked={current?.given ?? null}
          onPick={(choice) => record(choice, normalizeAnswer(choice) === normalizeAnswer(q.card.back))}
        />
      ) : (
        <WriteQuestionView
          key={q.card.id}
          card={q.card}
          answered={current}
          onSubmit={(given) => {
            const r = checkAnswer(given, q.card.back);
            record(given, r.correct, r.exact);
          }}
        />
      )}
      {current && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setCurrent(null);
            setIndex((i) => i + 1);
          }}
        >
          {index + 1 === questions.length ? "See score" : "Next"}
        </button>
      )}
    </div>
  );
}
