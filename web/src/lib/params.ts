import { notFound } from "next/navigation";
import { uuidSchema } from "./validation";

/** Parse a UUID route parameter; anything else is a 404. */
export function parseId(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}
