"use server";

import { notFound } from "next/navigation";
import { isGrade } from "@/lib/fsrs";
import { reviewSchema } from "@/lib/validation";
import { NotFoundError, recordReview } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { validationError, type ActionResult } from "./result";

export async function rateCardAction(input: unknown): Promise<ActionResult<{ due: string }>> {
  const userId = await requireUserId();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success || !isGrade(parsed.data.rating)) {
    return parsed.success ? { ok: false, error: "Invalid rating" } : validationError(parsed.error);
  }
  try {
    const progress = await recordReview(userId, parsed.data.cardId, parsed.data.rating);
    return { ok: true, data: { due: progress.due.toISOString() } };
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
