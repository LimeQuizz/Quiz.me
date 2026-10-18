import { describe, expect, it } from "vitest";
import { allowedDistance, checkAnswer, normalizeAnswer } from "@/lib/fuzzy";

describe("fuzzy answer matcher", () => {
  it("normalizes case, accents, punctuation, articles", () => {
    expect(normalizeAnswer("  The Mitochondria! ")).toBe("mitochondria");
    expect(normalizeAnswer("Café-au-lait")).toBe("cafe au lait");
    expect(normalizeAnswer("- one\n- two")).toBe("one two");
  });

  it("accepts exact matches regardless of case", () => {
    expect(checkAnswer("PARIS", "Paris")).toEqual({ correct: true, exact: true, distance: 0 });
  });

  it("allows small typos scaled by length", () => {
    expect(checkAnswer("Shakespear", "Shakespeare").correct).toBe(true);
    expect(checkAnswer("photosinthesis", "photosynthesis").correct).toBe(true);
    expect(checkAnswer("mitochondira", "mitochondria").correct).toBe(true);
  });

  it("rejects wrong answers and short-word typos", () => {
    expect(checkAnswer("London", "Paris").correct).toBe(false);
    expect(checkAnswer("Au", "Ag").correct).toBe(false);
    expect(checkAnswer("", "Paris").correct).toBe(false);
    expect(checkAnswer("cat", "car").correct).toBe(false);
  });

  it("threshold table", () => {
    expect([1, 3, 4, 6, 7, 12, 20, 40].map(allowedDistance)).toEqual([0, 0, 1, 1, 2, 2, 3, 6]);
  });
});
