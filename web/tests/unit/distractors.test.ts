import { describe, expect, it } from "vitest";
import { buildChoices, shuffle } from "@/lib/distractors";

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const deck = [
  { id: "1", back: "Paris", options: null },
  { id: "2", back: "Berlin", options: null },
  { id: "3", back: "Rome", options: null },
  { id: "4", back: "Madrid", options: null },
  { id: "5", back: "paris", options: null },
];

describe("multiple choice distractors", () => {
  it("uses embedded options when present", () => {
    const card = { id: "9", back: "B", options: ["A", "B", "C"] };
    expect(buildChoices(card, deck, seeded())?.sort()).toEqual(["A", "B", "C"]);
  });

  it("draws distinct distractors from the same deck", () => {
    const choices = buildChoices(deck[0]!, deck, seeded())!;
    expect(choices).toHaveLength(4);
    expect(choices).toContain("Paris");
    expect(new Set(choices.map((c) => c.toLowerCase())).size).toBe(4);
  });

  it("returns null when the deck has no other answers", () => {
    expect(buildChoices(deck[0]!, [deck[0]!, deck[4]!], seeded())).toBeNull();
  });

  it("shuffle keeps all items", () => {
    expect(shuffle([1, 2, 3, 4], seeded()).sort()).toEqual([1, 2, 3, 4]);
  });
});
