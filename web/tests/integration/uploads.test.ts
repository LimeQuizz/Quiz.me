import { describe, expect, it } from "vitest";
import { finishUpload, reserveUpload } from "@/server/data";
import { getDb } from "@/server/db/client";
import { uploadEvents } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createUser } from "./helpers";

describe("upload rate limit (DB-backed)", () => {
  it("allows 10 per hour, then returns retry-after", async () => {
    const user = await createUser("uploader");
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      const r = await reserveUpload(user, 100, new Date(now.getTime() + i * 1000));
      expect(r.allowed).toBe(true);
    }
    const denied = await reserveUpload(user, 100, new Date(now.getTime() + 20_000));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBe(3600 - 20);
    }
    // An hour later the window has moved on.
    const later = await reserveUpload(user, 100, new Date(now.getTime() + 3601_000));
    expect(later.allowed).toBe(true);
  });

  it("enforces the limit under concurrent requests", async () => {
    const user = await createUser("racer");
    const results = await Promise.all(Array.from({ length: 15 }, () => reserveUpload(user, 1)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("enforces 100 per day", async () => {
    const user = await createUser("daily");
    const start = new Date(Date.now() - 23 * 3600 * 1000);
    await getDb()
      .insert(uploadEvents)
      .values(
        Array.from({ length: 100 }, (_, i) => ({
          userId: user,
          bytes: 1,
          status: "accepted" as const,
          createdAt: new Date(start.getTime() + i * 60_000),
        })),
      );
    const r = await reserveUpload(user, 1);
    expect(r.allowed).toBe(false);
  });

  it("limits are per user and statuses can be updated", async () => {
    const a = await createUser("a");
    const b = await createUser("b");
    const res = await reserveUpload(a, 5);
    expect(res.allowed).toBe(true);
    if (res.allowed) {
      await finishUpload(b, res.eventId, "failed", 999); // wrong user: no-op
      let [row] = await getDb().select().from(uploadEvents).where(eq(uploadEvents.id, res.eventId));
      expect(row!.status).toBe("accepted");
      await finishUpload(a, res.eventId, "rejected", 42);
      [row] = await getDb().select().from(uploadEvents).where(eq(uploadEvents.id, res.eventId));
      expect(row).toMatchObject({ status: "rejected", bytes: 42 });
    }
    expect((await reserveUpload(b, 1)).allowed).toBe(true);
  });
});
