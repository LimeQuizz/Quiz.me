import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("ownership layer architecture", () => {
  it("only the data layer, auth adapter, and db module import the database", () => {
    const allowed = /^(server[\\/](data|db)[\\/]|server[\\/]auth[\\/](adapter|config)\.ts$)/;
    const offenders = files
      .filter((f) => /from\s+["'](@\/server\/db\/(client|schema)|drizzle-orm|postgres)["']/.test(f.text))
      .filter((f) => !allowed.test(f.rel))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every exported data-layer function that touches user data takes userId first", () => {
    const exempt = new Set(["findOrCreateTestUser"]);
    const offenders: string[] = [];
    for (const f of files.filter((x) => /^server[\\/]data[\\/]/.test(x.rel))) {
      for (const m of f.text.matchAll(/export async function (\w+)\(\s*(\w+)/g)) {
        if (!exempt.has(m[1]!) && m[2] !== "userId") offenders.push(`${f.rel}: ${m[1]}(${m[2]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("deck queries in the data layer always filter on user_id", () => {
    for (const f of files.filter((x) => /^server[\\/]data[\\/]/.test(x.rel))) {
      const fromDecks = f.text.match(/\.from\(decks\)[\s\S]{0,200}/g) ?? [];
      for (const q of fromDecks) {
        expect(q, `${f.rel}: ${q.slice(0, 80)}`).toMatch(/ownedDeck\(userId|eq\(decks\.userId, userId\)/);
      }
    }
  });

  it("never renders HTML from strings", () => {
    const offenders = files.filter((f) => f.text.includes("dangerouslySetInnerHTML")).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
