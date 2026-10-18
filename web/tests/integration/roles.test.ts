import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";

async function pgError(query: SQL): Promise<string> {
  try {
    await getDb().execute(query);
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(err);
  }
  return "no error";
}

describe("runtime database role", () => {
  it("cannot create, alter, or drop tables", async () => {
    expect(await pgError(sql`create table pwned (x int)`)).toMatch(/permission denied/);
    expect(await pgError(sql`drop table decks`)).toMatch(/must be owner/);
    expect(await pgError(sql`alter table cards add column x int`)).toMatch(/must be owner/);
  });

  it("can read and write application tables", async () => {
    const rows = await getDb().execute(sql`select count(*)::int as n from decks`);
    expect(rows).toHaveLength(1);
  });
});
