import { z } from "zod";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function validationError(err: z.ZodError): ActionResult<never> {
  const first = err.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${first?.message ?? "Invalid input"}` };
}
