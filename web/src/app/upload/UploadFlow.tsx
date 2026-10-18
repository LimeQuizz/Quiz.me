"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { CandidateCard } from "@/lib/validation";
import { LIMITS } from "@/lib/validation";
import { addCardsAction, createDeckAction } from "@/server/actions/decks";

const MAX_BYTES = 25 * 1024 * 1024;

interface EditableCard extends CandidateCard {
  key: string;
  keep: boolean;
}

type Phase = "pick" | "uploading" | "review" | "saving";

function deckNameFrom(filename: string): string {
  return filename.replace(/\.(pdf|pptx)$/i, "").replace(/[_-]+/g, " ").trim().slice(0, LIMITS.deckName) || "New deck";
}

function retryText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "in about a minute" : minutes < 120 ? `in about ${minutes} minutes` : `in about ${Math.ceil(minutes / 60)} hours`;
}

export function UploadFlow({ target }: { target: { id: string; name: string } | null }) {
  const router = useRouter();
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<EditableCard[]>([]);
  const [filename, setFilename] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function upload(file: File) {
    setError(null);
    if (!/\.(pdf|pptx)$/i.test(file.name)) {
      setError("Choose a .pdf or .pptx file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("The file is larger than 25 MB.");
      return;
    }
    setPhase("uploading");
    setFilename(file.name);
    setName(deckNameFrom(file.name));
    try {
      const url = target ? `/api/uploads?deckId=${encodeURIComponent(target.id)}` : "/api/uploads";
      const res = await fetch(url, {
        method: "POST",
        body: file,
        headers: { "content-type": "application/octet-stream" },
      });
      const payload = (await res.json().catch(() => ({}))) as { cards?: CandidateCard[]; message?: string };
      if (res.status === 429) {
        setError(`You've reached the upload limit. Try again ${retryText(Number(res.headers.get("Retry-After") ?? 3600))}.`);
        setPhase("pick");
        return;
      }
      if (!res.ok || !payload.cards) {
        setError(payload.message ?? "The file could not be processed.");
        setPhase("pick");
        return;
      }
      if (payload.cards.length === 0) {
        setError("No questions were found in this file. You can still create cards by hand after saving a deck.");
        setPhase("pick");
        return;
      }
      setCards(
        payload.cards.map((c, i) => ({
          ...c,
          key: `${i}`,
          keep: c.back.trim().length > 0 && c.front.trim().length > 0,
        })),
      );
      setPhase("review");
    } catch {
      setError("Upload failed. Check your connection and try again.");
      setPhase("pick");
    }
  }

  function update(key: string, patch: Partial<EditableCard>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  async function save() {
    setError(null);
    const kept = cards.filter((c) => c.keep);
    if (kept.length === 0) {
      setError("Keep at least one card.");
      return;
    }
    const incomplete = kept.findIndex((c) => !c.front.trim() || !c.back.trim());
    if (incomplete >= 0) {
      setError(`Card ${cards.indexOf(kept[incomplete]!) + 1} needs both a question and an answer.`);
      return;
    }
    const payloadCards = kept.map((c) => ({
      front: c.front.trim(),
      back: c.back.trim(),
      cardType: c.cardType,
      options: c.cardType === "multiple_choice" ? c.options : null,
      confidence: c.confidence,
      sourceRef: c.sourceRef || null,
    }));
    setPhase("saving");
    const result = target
      ? await addCardsAction({ deckId: target.id, cards: payloadCards })
      : await createDeckAction({
          name: name.trim() || "New deck",
          description: description.trim() || null,
          sourceFilename: filename.slice(0, LIMITS.filename) || null,
          cards: payloadCards,
        });
    if (!result.ok) {
      setError(result.error);
      setPhase("review");
      return;
    }
    router.push(`/decks/${result.data.deckId}`);
  }

  if (phase === "pick" || phase === "uploading") {
    return (
      <div className="space-y-4">
        <div className="card space-y-3">
          <label htmlFor={inputId} className="label">
            PDF or PowerPoint (.pptx), up to 25 MB
          </label>
          <input
            id={inputId}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={phase === "uploading"}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:font-semibold file:text-white"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
            data-testid="file-input"
          />
          {phase === "uploading" && (
            <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
              Reading your file and looking for questions. Scanned pages can take up to a minute.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Your file is sent to the Quiz.me extractor, read in memory, and deleted immediately. Only the cards you save are
          stored.
        </p>
      </div>
    );
  }

  const keptCount = cards.filter((c) => c.keep).length;
  return (
    <div className="space-y-4">
      {!target && (
        <div className="card space-y-3">
          <div>
            <label htmlFor="deck-name" className="label">
              Deck name
            </label>
            <input
              id="deck-name"
              className="input"
              value={name}
              maxLength={LIMITS.deckName}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="deck-description" className="label">
              Description (optional)
            </label>
            <textarea
              id="deck-description"
              className="input"
              rows={2}
              value={description}
              maxLength={LIMITS.deckDescription}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-zinc-600 dark:text-zinc-400" data-testid="review-summary">
          {cards.length} suggested, {keptCount} selected. Review them before saving.
        </p>
        <button type="button" className="btn-secondary" onClick={() => setCards((p) => p.map((c) => ({ ...c, keep: true })))}>
          Keep all
        </button>
        <button type="button" className="btn-secondary" onClick={() => setCards((p) => p.map((c) => ({ ...c, keep: false })))}>
          Keep none
        </button>
      </div>

      <ol className="space-y-3" data-testid="review-list">
        {cards.map((c, i) => (
          <li key={c.key} className={`card space-y-2 ${c.keep ? "" : "opacity-60"}`} data-testid="review-card">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">#{i + 1}</span>
              <span>{c.sourceRef}</span>
              <span>· {c.cardType.replace("_", " ")}</span>
              <span>· {Math.round(c.confidence * 100)}% confidence</span>
              <label className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <input type="checkbox" className="size-5 accent-brand-600" checked={c.keep} onChange={(e) => update(c.key, { keep: e.target.checked })} />
                Keep
              </label>
              <button
                type="button"
                className="min-h-11 rounded-md px-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                onClick={() => setCards((prev) => prev.filter((x) => x.key !== c.key))}
                aria-label={`Delete card ${i + 1}`}
              >
                Delete
              </button>
            </div>
            <div>
              <label className="label" htmlFor={`front-${c.key}`}>
                Question
              </label>
              <textarea
                id={`front-${c.key}`}
                className="input"
                rows={2}
                maxLength={LIMITS.cardText}
                value={c.front}
                onChange={(e) => update(c.key, { front: e.target.value })}
              />
            </div>
            {c.cardType === "multiple_choice" && c.options ? (
              <fieldset>
                <legend className="label">Correct answer</legend>
                <div className="space-y-1">
                  {c.options.map((opt, j) => (
                    <label key={j} className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <input
                        type="radio"
                        name={`answer-${c.key}`}
                        className="size-5 accent-brand-600"
                        checked={c.back === opt}
                        onChange={() => update(c.key, { back: opt })}
                      />
                      <span className="break-words">{opt}</span>
                    </label>
                  ))}
                </div>
                {!c.back && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Pick the correct option.</p>}
              </fieldset>
            ) : (
              <div>
                <label className="label" htmlFor={`back-${c.key}`}>
                  Answer
                </label>
                <textarea
                  id={`back-${c.key}`}
                  className="input"
                  rows={2}
                  maxLength={LIMITS.cardText}
                  value={c.back}
                  onChange={(e) => update(c.key, { back: e.target.value })}
                />
                {!c.back.trim() && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">No answer was found. Add one or delete the card.</p>}
              </div>
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="btn-secondary w-full"
        onClick={() =>
          setCards((prev) => [
            ...prev,
            { key: `new-${Date.now()}`, front: "", back: "", cardType: "basic", options: null, confidence: 1, sourceRef: "", detector: "manual", keep: true },
          ])
        }
      >
        Add a card
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 -mx-3 border-t border-zinc-200 bg-zinc-50/95 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/95 sm:mx-0 sm:px-0">
        <button type="button" className="btn-primary w-full" disabled={phase === "saving" || keptCount === 0} onClick={() => void save()}>
          {phase === "saving" ? "Saving…" : target ? `Add ${keptCount} cards` : `Save deck with ${keptCount} cards`}
        </button>
      </div>
    </div>
  );
}
