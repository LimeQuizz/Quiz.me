import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { uploadEvents } from "@/server/db/schema";
import type { UploadStatus } from "@/lib/constants";
import { evaluateRateLimit, UPLOAD_LIMITS, type RateLimitDecision } from "@/lib/ratelimit";

export type Reservation = { allowed: true; eventId: string } | Extract<RateLimitDecision, { allowed: false }>;

/**
 * Check the per-user upload limits and, if allowed, record the upload in the
 * same transaction. A per-user advisory lock makes concurrent requests from
 * one user queue up, so two parallel uploads cannot both take the last slot.
 */
export async function reserveUpload(userId: string, bytes: number, now: Date = new Date()): Promise<Reservation> {
  const longestWindow = Math.max(...UPLOAD_LIMITS.map((l) => l.windowSeconds));
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`upload:${userId}`}, 0))`);
    const rows = await tx
      .select({ createdAt: uploadEvents.createdAt })
      .from(uploadEvents)
      .where(
        and(
          eq(uploadEvents.userId, userId),
          gt(uploadEvents.createdAt, new Date(now.getTime() - longestWindow * 1000)),
        ),
      );
    const decision = evaluateRateLimit(
      rows.map((r) => r.createdAt),
      now,
    );
    if (!decision.allowed) return decision;
    const [event] = await tx
      .insert(uploadEvents)
      .values({ userId, bytes, status: "accepted", createdAt: now })
      .returning({ id: uploadEvents.id });
    return { allowed: true, eventId: event!.id };
  });
}

export async function finishUpload(userId: string, eventId: string, status: UploadStatus, bytes: number): Promise<void> {
  await getDb()
    .update(uploadEvents)
    .set({ status, bytes })
    .where(and(eq(uploadEvents.id, eventId), eq(uploadEvents.userId, userId)));
}
