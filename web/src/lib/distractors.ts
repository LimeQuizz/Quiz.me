import { normalizeAnswer } from "./fuzzy";

export interface ChoiceCard {
  id: string;
  back: string;
  options: string[] | null;
}

/** Fisher-Yates shuffle with an injectable random source for tests. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Options for a multiple choice question: the card's own options when it has
 * them, otherwise the correct answer plus up to three other answers from the
 * same deck. Returns null when the deck is too small to make a question.
 */
export function buildChoices(
  card: ChoiceCard,
  deck: readonly ChoiceCard[],
  random: () => number = Math.random,
  count = 4,
): string[] | null {
  if (card.options && card.options.length >= 2) return shuffle(card.options, random);
  const correct = normalizeAnswer(card.back);
  const seen = new Set([correct]);
  const pool: string[] = [];
  for (const other of shuffle(deck, random)) {
    if (other.id === card.id) continue;
    const key = normalizeAnswer(other.back);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pool.push(other.back);
    if (pool.length >= count - 1) break;
  }
  if (pool.length < 1) return null;
  return shuffle([card.back, ...pool], random);
}
