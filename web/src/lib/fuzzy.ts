import { distance } from "fastest-levenshtein";

/**
 * Normalize an answer for comparison: case-insensitive, accents folded,
 * punctuation removed, whitespace collapsed, leading articles dropped.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*-\s+/gm, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the) /, "");
}

/** Edits allowed for an answer of the given normalized length. */
export function allowedDistance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  if (length <= 12) return 2;
  return Math.floor(length * 0.15);
}

export interface MatchResult {
  correct: boolean;
  exact: boolean;
  distance: number;
}

export function checkAnswer(given: string, expected: string): MatchResult {
  const a = normalizeAnswer(given);
  const b = normalizeAnswer(expected);
  if (!a) return { correct: false, exact: false, distance: b.length };
  if (a === b) return { correct: true, exact: true, distance: 0 };
  const d = distance(a, b);
  return { correct: d <= allowedDistance(b.length), exact: false, distance: d };
}
