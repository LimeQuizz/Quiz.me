import "server-only";
import { extractorResponseSchema, type ExtractorResponse } from "@/lib/validation";

export class ExtractorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage: string,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

const TIMEOUT_MS = 75_000; // extractor's own hard limit is 60 s

function config(): { url: string; secret: string } {
  const url = process.env.EXTRACTOR_URL;
  const secret = process.env.EXTRACTOR_SHARED_SECRET;
  if (!url || !secret) throw new Error("EXTRACTOR_URL and EXTRACTOR_SHARED_SECRET must be set");
  return { url: url.replace(/\/$/, ""), secret };
}

const MESSAGES: Record<string, string> = {
  too_large: "The file is larger than 25 MB.",
  unsupported_file: "Only PDF and PowerPoint (.pptx) files are supported.",
  encrypted_file: "Password-protected or encrypted files can't be read. Remove the password and try again.",
  macro_enabled: "Macro-enabled presentations (.pptm) aren't supported. Save it as .pptx and try again.",
  too_many_pages: "The file has more than 300 pages or slides.",
  corrupt_file: "The file appears to be damaged.",
  busy: "Quiz.me is busy right now. Please try again in a moment.",
  timeout: "The file took too long to process. Try a smaller file.",
};

/** Stream a file to the extractor and return validated candidate cards. */
export async function extractCards(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<ExtractorResponse> {
  const { url, secret } = config();
  const res = await fetch(`${url}/v1/extract`, {
    method: "POST",
    body,
    headers: { "content-type": "application/octet-stream", "x-extractor-secret": secret },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    // Required by Node's fetch to send a streaming request body.
    duplex: "half",
    cache: "no-store",
    redirect: "error",
  } as RequestInit & { duplex: "half" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const code = typeof payload.error === "string" ? payload.error : "extraction_failed";
    const status = [413, 415, 422, 503, 504].includes(res.status) ? res.status : 502;
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ExtractorError(
      status,
      code,
      MESSAGES[code] ?? "The file could not be processed.",
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) : undefined,
    );
  }
  const parsed = extractorResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new ExtractorError(502, "bad_extractor_response", "The file could not be processed.");
  return parsed.data;
}
