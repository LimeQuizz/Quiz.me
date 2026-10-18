import { describe, expect, it } from "vitest";
import { guardUpload, sniffKind, UploadError } from "@/lib/upload-guard";

function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
      c.close();
    },
  });
}

async function drain(s: ReadableStream<Uint8Array>): Promise<number> {
  let n = 0;
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return n;
    n += value.byteLength;
  }
}

describe("upload guard", () => {
  it("sniffs magic bytes", () => {
    expect(sniffKind(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe("pptx");
    expect(sniffKind(new TextEncoder().encode("hello"))).toBeNull();
  });

  it("replays the head bytes and passes the rest through", async () => {
    const g = await guardUpload(streamOf("%P", "DF-1", ".7 rest", " more"));
    expect(g.kind).toBe("pdf");
    expect(await drain(g.stream)).toBe("%PDF-1.7 rest more".length);
    expect(g.bytes()).toBe("%PDF-1.7 rest more".length);
  });

  it("rejects bad magic bytes regardless of what the client claims", async () => {
    await expect(guardUpload(streamOf("MZ\x90\x00 executable"))).rejects.toEqual(new UploadError("unsupported_file"));
  });

  it("rejects empty bodies", async () => {
    await expect(guardUpload(null)).rejects.toEqual(new UploadError("empty_body"));
    await expect(guardUpload(streamOf())).rejects.toEqual(new UploadError("empty_body"));
  });

  it("errors the stream once the size limit is crossed", async () => {
    const g = await guardUpload(streamOf("%PDF-1.7", "x".repeat(50), "x".repeat(50)), 64);
    await expect(drain(g.stream)).rejects.toEqual(new UploadError("too_large"));
  });
});
