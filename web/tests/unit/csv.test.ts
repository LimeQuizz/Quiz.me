import { describe, expect, it } from "vitest";
import { cardsToCsv, csvField, csvFilename } from "@/lib/csv";

describe("CSV export", () => {
  it("writes a header, BOM, CRLF rows", () => {
    const csv = cardsToCsv([
      { front: "Q1", back: "A1", cardType: "basic", options: null, sourceRef: "page 1" },
      { front: "Pick", back: "B", cardType: "multiple_choice", options: ["A", "B"], sourceRef: null },
    ]);
    expect(csv).toBe(
      "﻿front,back,card_type,options,source_ref\r\nQ1,A1,basic,,page 1\r\nPick,B,multiple_choice,A | B,\r\n",
    );
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(" padded ")).toBe('" padded "');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("makes safe file names", () => {
    expect(csvFilename("Biologie: Zellen / Teil 1")).toBe("Biologie-Zellen-Teil-1.csv");
    expect(csvFilename("../../etc/passwd")).toBe("etcpasswd.csv");
    expect(csvFilename("???")).toBe("deck.csv");
  });
});
