export interface CsvCard {
  front: string;
  back: string;
  cardType: string;
  options: string[] | null;
  sourceRef: string | null;
}

const HEADER = ["front", "back", "card_type", "options", "source_ref"];

/**
 * Quote one CSV field (RFC 4180) and neutralize spreadsheet formula
 * injection: a field starting with = + - @ tab or CR is prefixed with '.
 */
export function csvField(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v) || v !== v.trim()) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function cardsToCsv(cards: CsvCard[]): string {
  const rows = [HEADER.join(",")];
  for (const c of cards) {
    rows.push(
      [c.front, c.back, c.cardType, (c.options ?? []).join(" | "), c.sourceRef ?? ""]
        .map(csvField)
        .join(","),
    );
  }
  // BOM so spreadsheet apps detect UTF-8.
  return `﻿${rows.join("\r\n")}\r\n`;
}

/** A safe download name: ASCII letters, digits, dashes only. */
export function csvFilename(deckName: string): string {
  const base = deckName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "deck"}.csv`;
}
