import { UPLOAD_MAX_BYTES } from "./security-headers";

export type UploadKind = "pdf" | "pptx";
export type UploadProblem = "unsupported_file" | "too_large" | "empty_body";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4

/** Classify by magic bytes. Extension and Content-Type are ignored. */
export function sniffKind(head: Uint8Array): UploadKind | null {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts(PDF)) return "pdf";
  if (starts(ZIP)) return "pptx";
  return null;
}

export class UploadError extends Error {
  constructor(readonly problem: UploadProblem) {
    super(problem);
  }
}

export interface GuardedUpload {
  kind: UploadKind;
  /** Re-assembled body stream that errors with UploadError("too_large") past the limit. */
  stream: ReadableStream<Uint8Array>;
  /** Bytes forwarded so far. */
  bytes: () => number;
}

/**
 * Read just enough of the body to check the magic bytes, then return a stream
 * that replays those bytes followed by the rest, counting as it goes. The file
 * is never buffered whole or written to disk.
 */
export async function guardUpload(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number = UPLOAD_MAX_BYTES,
): Promise<GuardedUpload> {
  if (!body) throw new UploadError("empty_body");
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let headLength = 0;
  while (headLength < 8) {
    const { done, value } = await reader.read();
    if (done) break;
    head.push(value);
    headLength += value.byteLength;
  }
  if (headLength === 0) throw new UploadError("empty_body");
  const first = new Uint8Array(headLength);
  let offset = 0;
  for (const chunk of head) {
    first.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const kind = sniffKind(first);
  if (!kind) {
    await reader.cancel().catch(() => {});
    throw new UploadError("unsupported_file");
  }
  if (headLength > maxBytes) {
    await reader.cancel().catch(() => {});
    throw new UploadError("too_large");
  }
  let total = headLength;
  let sentHead = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHead) {
        sentHead = true;
        controller.enqueue(first);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        controller.error(new UploadError("too_large"));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
  return { kind, stream, bytes: () => total };
}
