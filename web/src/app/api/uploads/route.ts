import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/logger";
import { allowedOrigins } from "@/lib/origin";
import { isAllowedOrigin, STATIC_SECURITY_HEADERS, UPLOAD_MAX_BYTES } from "@/lib/security-headers";
import { guardUpload, UploadError } from "@/lib/upload-guard";
import { toCandidateCards, uuidSchema } from "@/lib/validation";
import { assertDeckOwned, finishUpload, NotFoundError, reserveUpload } from "@/server/data";
import { getUserId } from "@/server/auth/session";
import { extractCards, ExtractorError } from "@/server/extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This route is excluded from the middleware so the body is streamed rather
// than buffered; it applies the same header and origin checks itself.
function json(body: unknown, status: number, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...STATIC_SECURITY_HEADERS, "Cache-Control": "no-store", ...extra },
  });
}

const UPLOAD_ERRORS: Record<UploadError["problem"], { status: number; message: string }> = {
  unsupported_file: { status: 415, message: "Only PDF and PowerPoint (.pptx) files are supported." },
  too_large: { status: 413, message: "The file is larger than 25 MB." },
  empty_body: { status: 400, message: "The file is empty." },
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  if (!isAllowedOrigin("POST", req.headers.get("origin"), allowedOrigins(req))) {
    return json({ error: "bad_origin" }, 403);
  }
  const userId = await getUserId();
  if (!userId) return json({ error: "unauthorized" }, 401);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > UPLOAD_MAX_BYTES) {
    return json({ error: "too_large", message: UPLOAD_ERRORS.too_large.message }, 413);
  }

  // Optional target deck: must belong to the caller before anything else runs.
  const deckParam = req.nextUrl.searchParams.get("deckId");
  if (deckParam !== null) {
    const parsed = uuidSchema.safeParse(deckParam);
    if (!parsed.success) return json({ error: "not_found" }, 404);
    try {
      await assertDeckOwned(userId, parsed.data);
    } catch (err) {
      if (err instanceof NotFoundError) return json({ error: "not_found" }, 404);
      throw err;
    }
  }

  const reservation = await reserveUpload(userId, Number.isFinite(declared) ? declared : 0);
  if (!reservation.allowed) {
    log.info("upload rate limited", { requestId, userId });
    return json(
      { error: "rate_limited", message: "Upload limit reached (10 per hour, 100 per day). Try again later." },
      429,
      { "Retry-After": String(reservation.retryAfterSeconds) },
    );
  }

  const started = Date.now();
  let guarded: Awaited<ReturnType<typeof guardUpload>> | undefined;
  try {
    guarded = await guardUpload(req.body);
    const result = await extractCards(guarded.stream, req.signal);
    const cards = toCandidateCards(result);
    await finishUpload(userId, reservation.eventId, "accepted", guarded.bytes());
    log.info("upload extracted", {
      requestId,
      userId,
      kind: result.kind,
      bytes: guarded.bytes(),
      cards: cards.length,
      ocrSections: result.ocr_sections,
      durationMs: Date.now() - started,
    });
    return json({ kind: result.kind, sections: result.sections, ocrSections: result.ocr_sections, cards }, 200);
  } catch (err) {
    const bytes = guarded?.bytes() ?? 0;
    // A stream error raised while fetch was sending the body surfaces as the cause.
    const uploadErr = err instanceof UploadError ? err : (err as { cause?: unknown })?.cause;
    if (uploadErr instanceof UploadError) {
      await finishUpload(userId, reservation.eventId, "rejected", bytes);
      const { status, message } = UPLOAD_ERRORS[uploadErr.problem];
      log.info("upload rejected", { requestId, userId, reason: uploadErr.problem, bytes });
      return json({ error: uploadErr.problem, message }, status);
    }
    if (err instanceof ExtractorError) {
      const rejected = err.status === 413 || err.status === 415 || err.status === 422;
      await finishUpload(userId, reservation.eventId, rejected ? "rejected" : "failed", bytes);
      log.info("upload not extracted", { requestId, userId, reason: err.code, status: err.status, bytes });
      return json({ error: err.code, message: err.userMessage }, err.status);
    }
    await finishUpload(userId, reservation.eventId, "failed", bytes).catch(() => {});
    log.error("upload failed", { requestId, userId, error: err instanceof Error ? err.name : "unknown" });
    return json({ error: "extraction_failed", message: "The file could not be processed." }, 502);
  }
}
