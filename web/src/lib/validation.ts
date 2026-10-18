import { z } from "zod";
import { CARD_TYPES } from "./constants";

/** Hard limits shared by Zod schemas, the database, and the UI. */
export const LIMITS = {
  deckName: 200,
  deckDescription: 2000,
  filename: 255,
  cardText: 2000,
  sourceRef: 50,
  optionText: 500,
  minOptions: 2,
  maxOptions: 6,
  cardsPerRequest: 500,
  cardsPerDeck: 2000,
} as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const uuidSchema = z.uuid();

export const cardInputSchema = z
  .object({
    front: text(LIMITS.cardText),
    back: text(LIMITS.cardText),
    cardType: z.enum(CARD_TYPES).default("basic"),
    options: z
      .array(text(LIMITS.optionText))
      .min(LIMITS.minOptions)
      .max(LIMITS.maxOptions)
      .nullable()
      .default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    sourceRef: z.string().trim().max(LIMITS.sourceRef).nullable().default(null),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (card.cardType === "multiple_choice") {
      if (!card.options) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Options are required" });
      } else if (!card.options.includes(card.back)) {
        ctx.addIssue({
          code: "custom",
          path: ["back"],
          message: "The answer must be one of the options",
        });
      }
    } else if (card.options !== null) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Only multiple choice cards have options" });
    }
  });
export type CardInput = z.infer<typeof cardInputSchema>;

const deckFields = {
  name: text(LIMITS.deckName),
  description: z.string().trim().max(LIMITS.deckDescription).nullable().default(null),
};

export const createDeckSchema = z
  .object({
    ...deckFields,
    sourceFilename: z.string().trim().max(LIMITS.filename).nullable().default(null),
    cards: z.array(cardInputSchema).min(1).max(LIMITS.cardsPerRequest),
  })
  .strict();
export type CreateDeckInput = z.infer<typeof createDeckSchema>;

export const updateDeckSchema = z.object({ deckId: uuidSchema, ...deckFields }).strict();
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;

export const addCardsSchema = z
  .object({ deckId: uuidSchema, cards: z.array(cardInputSchema).min(1).max(LIMITS.cardsPerRequest) })
  .strict();

export const updateCardSchema = z
  .object({
    cardId: uuidSchema,
    front: text(LIMITS.cardText),
    back: text(LIMITS.cardText),
  })
  .strict();
export type UpdateCardInput = z.infer<typeof updateCardSchema>;

export const idOnlySchema = z.object({ id: uuidSchema }).strict();

export const reviewSchema = z
  .object({ cardId: uuidSchema, rating: z.int().min(1).max(4) })
  .strict();

export const testSignInSchema = z
  .object({ email: z.string().regex(/^e2e-[a-z0-9-]{1,40}@example\.test$/) })
  .strict();

/** What the extractor returns. Validated again in web as defense in depth. */
export const extractorResponseSchema = z.object({
  kind: z.enum(["pdf", "pptx"]),
  sections: z.int().min(0),
  ocr_sections: z.int().min(0),
  cards: z
    .array(
      z.object({
        front: z.string().max(LIMITS.cardText),
        back: z.string().max(LIMITS.cardText),
        card_type: z.enum(CARD_TYPES),
        options: z.array(z.string().max(LIMITS.cardText)).max(10).nullable(),
        confidence: z.number().min(0).max(1),
        source_ref: z.string().max(LIMITS.sourceRef),
        detector: z.string().max(64),
      }),
    )
    .max(5000),
});
export type ExtractorResponse = z.infer<typeof extractorResponseSchema>;

/** A candidate card as the review screen sees it. */
export interface CandidateCard {
  front: string;
  back: string;
  cardType: (typeof CARD_TYPES)[number];
  options: string[] | null;
  confidence: number;
  sourceRef: string;
  detector: string;
}

export function toCandidateCards(res: ExtractorResponse): CandidateCard[] {
  return res.cards.slice(0, LIMITS.cardsPerRequest).map((c) => ({
    front: c.front,
    back: c.back,
    cardType: c.card_type,
    options: c.options && c.options.length >= LIMITS.minOptions ? c.options.slice(0, LIMITS.maxOptions) : null,
    confidence: c.confidence,
    sourceRef: c.source_ref,
    detector: c.detector,
  }));
}
