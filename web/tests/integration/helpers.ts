import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { CardInput } from "@/lib/validation";

export async function createUser(label = "user"): Promise<string> {
  const [row] = await getDb()
    .insert(users)
    .values({ name: label, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: users.id });
  return row!.id;
}

export function basicCard(front: string, back: string): CardInput {
  return { front, back, cardType: "basic", options: null, confidence: 0.9, sourceRef: "page 1" };
}

export function mcqCard(front: string, options: string[], back: string): CardInput {
  return { front, back, cardType: "multiple_choice", options, confidence: 0.9, sourceRef: "page 2" };
}
