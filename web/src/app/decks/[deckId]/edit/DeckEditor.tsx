"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LIMITS } from "@/lib/validation";
import type { CardType } from "@/lib/constants";
import { deleteCardAction, updateCardAction, updateDeckAction } from "@/server/actions/decks";

interface EditCard {
  id: string;
  front: string;
  back: string;
  cardType: CardType;
  options: string[] | null;
}

function CardRow({ card, index, onDeleted }: { card: EditCard; index: number; onDeleted: (id: string) => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [saved, setSaved] = useState({ front: card.front, back: card.back });
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = front !== saved.front || back !== saved.back;

  return (
    <li className="card space-y-2">
      <p className="text-xs font-semibold text-zinc-500">
        #{index + 1} · {card.cardType.replace("_", " ")}
      </p>
      <label className="label" htmlFor={`f-${card.id}`}>
        Question
      </label>
      <textarea id={`f-${card.id}`} className="input" rows={2} maxLength={LIMITS.cardText} value={front} onChange={(e) => setFront(e.target.value)} />
      <label className="label" htmlFor={`b-${card.id}`}>
        Answer
      </label>
      <textarea id={`b-${card.id}`} className="input" rows={2} maxLength={LIMITS.cardText} value={back} onChange={(e) => setBack(e.target.value)} />
      {card.options && <p className="text-xs text-zinc-500">Options: {card.options.join(" · ")}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await updateCardAction({ cardId: card.id, front, back });
              setStatus(r.ok ? "Saved" : r.error);
              if (r.ok) setSaved({ front, back });
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!window.confirm("Delete this card?")) return;
              const r = await deleteCardAction({ id: card.id });
              if (r.ok) onDeleted(card.id);
              else setStatus(r.error);
            })
          }
        >
          Delete
        </button>
        {status && (
          <span role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            {status}
          </span>
        )}
      </div>
    </li>
  );
}

export function DeckEditor({ deck, cards: initial }: { deck: { id: string; name: string; description: string | null }; cards: EditCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="deck-name">
            Deck name
          </label>
          <input id="deck-name" className="input" maxLength={LIMITS.deckName} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="deck-description">
            Description
          </label>
          <textarea id="deck-description" className="input" rows={2} maxLength={LIMITS.deckDescription} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateDeckAction({ deckId: deck.id, name, description: description || null });
              setStatus(r.ok ? "Saved" : r.error);
              if (r.ok) router.refresh();
            })
          }
        >
          Save details
        </button>
        {status && (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            {status}
          </p>
        )}
      </div>
      <ol className="space-y-3">
        {cards.map((c, i) => (
          <CardRow key={c.id} card={c} index={i} onDeleted={(id) => setCards((prev) => prev.filter((x) => x.id !== id))} />
        ))}
      </ol>
    </div>
  );
}
