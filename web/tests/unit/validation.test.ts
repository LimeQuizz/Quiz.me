import { describe, expect, it } from "vitest";
import {
  cardInputSchema,
  createDeckSchema,
  extractorResponseSchema,
  LIMITS,
  reviewSchema,
  testSignInSchema,
  toCandidateCards,
  updateCardSchema,
} from "@/lib/validation";

const card = { front: "Q", back: "A" };

describe("Zod schemas", () => {
  it("trims and defaults card fields", () => {
    expect(cardInputSchema.parse({ front: "  Q ", back: " A " })).toEqual({
      front: "Q",
      back: "A",
      cardType: "basic",
      options: null,
      confidence: null,
      sourceRef: null,
    });
  });

  it("enforces max lengths and non-empty sides", () => {
    expect(cardInputSchema.safeParse({ front: "x".repeat(LIMITS.cardText + 1), back: "a" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ front: "   ", back: "a" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ front: "q", back: "" }).success).toBe(false);
  });

  it("rejects unknown keys (no mass assignment)", () => {
    expect(cardInputSchema.safeParse({ ...card, deckId: "x" }).success).toBe(false);
    expect(createDeckSchema.safeParse({ name: "n", cards: [card], userId: "someone" }).success).toBe(false);
  });

  it("requires consistent multiple choice cards", () => {
    const ok = { front: "Q", back: "B", cardType: "multiple_choice", options: ["A", "B"] };
    expect(cardInputSchema.safeParse(ok).success).toBe(true);
    expect(cardInputSchema.safeParse({ ...ok, back: "C" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...ok, options: null }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...card, options: ["A", "B"] }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...ok, options: ["B"] }).success).toBe(false);
  });

  it("bounds deck size per request", () => {
    const cards = Array.from({ length: LIMITS.cardsPerRequest + 1 }, () => card);
    expect(createDeckSchema.safeParse({ name: "n", cards }).success).toBe(false);
    expect(createDeckSchema.safeParse({ name: "n", cards: [] }).success).toBe(false);
    expect(createDeckSchema.safeParse({ name: "x".repeat(201), cards: [card] }).success).toBe(false);
  });

  it("validates IDs and ratings", () => {
    expect(updateCardSchema.safeParse({ cardId: "not-a-uuid", ...card }).success).toBe(false);
    expect(reviewSchema.safeParse({ cardId: "6f1c4a52-4a2b-4c4e-9b7f-0c2f3c0a8a11", rating: 5 }).success).toBe(false);
    expect(reviewSchema.safeParse({ cardId: "6f1c4a52-4a2b-4c4e-9b7f-0c2f3c0a8a11", rating: 3 }).success).toBe(true);
  });

  it("only accepts e2e test emails in the test sign-in", () => {
    expect(testSignInSchema.safeParse({ email: "e2e-alice@example.test" }).success).toBe(true);
    expect(testSignInSchema.safeParse({ email: "admin@example.com" }).success).toBe(false);
  });

  it("validates and maps extractor output", () => {
    const res = extractorResponseSchema.parse({
      kind: "pdf",
      sections: 1,
      ocr_sections: 0,
      cards: [
        { front: "Q", back: "A", card_type: "basic", options: null, confidence: 0.9, source_ref: "page 1", detector: "x" },
        { front: "M", back: "B", card_type: "multiple_choice", options: ["B"], confidence: 0.5, source_ref: "page 2", detector: "y" },
      ],
    });
    const cards = toCandidateCards(res);
    expect(cards[0]).toMatchObject({ front: "Q", cardType: "basic", sourceRef: "page 1" });
    expect(cards[1]!.options).toBeNull();
    expect(extractorResponseSchema.safeParse({ kind: "exe", sections: 0, ocr_sections: 0, cards: [] }).success).toBe(false);
  });
});
