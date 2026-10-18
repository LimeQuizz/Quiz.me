import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDeck, listCards } from "@/server/data";
import { basicCard, createUser } from "./helpers";

let currentUser: string | null = null;
vi.mock("@/server/auth/session", () => ({ getUserId: async () => currentUser }));

// All test requests share one client address; keep the per-IP limiter out
// of the way except where a test exercises it.
process.env.RATE_LIMIT_SCALE = "100";
const { POST } = await import("@/app/api/uploads/route");

const ORIGIN = "http://localhost:3000";
const PDF = new TextEncoder().encode("%PDF-1.7\nfake but magic bytes are right");

function upload(body: BodyInit | null, { deckId, origin = ORIGIN }: { deckId?: string; origin?: string | null } = {}) {
  const url = new URL("/api/uploads", ORIGIN);
  if (deckId) url.searchParams.set("deckId", deckId);
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  if (origin) headers.origin = origin;
  return POST(new NextRequest(url, { method: "POST", body, headers, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]));
}

const extractorReply = {
  kind: "pdf",
  sections: 1,
  ocr_sections: 0,
  cards: [{ front: "Q?", back: "A", card_type: "basic", options: null, confidence: 0.9, source_ref: "page 1", detector: "labeled_pair" }],
};

describe("POST /api/uploads", () => {
  let alice: string;
  let bob: string;
  let aliceDeck: string;
  const fetchMock = vi.fn();

  beforeAll(async () => {
    process.env.AUTH_URL = ORIGIN;
    process.env.EXTRACTOR_URL = "http://extractor.test:8000";
    process.env.EXTRACTOR_SHARED_SECRET = "x".repeat(40);
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceDeck = (await createDeck(alice, { name: "A", description: null, sourceFilename: null, cards: [basicCard("q", "a")] })).id;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    currentUser = null;
  });

  it("requires a session", async () => {
    const res = await upload(PDF);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests", async () => {
    currentUser = alice;
    expect((await upload(PDF, { origin: "https://evil.example" })).status).toBe(403);
    expect((await upload(PDF, { origin: null })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to upload into another user's deck without contacting the extractor", async () => {
    currentUser = bob;
    const res = await upload(PDF, { deckId: aliceDeck });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listCards(alice, aliceDeck)).toHaveLength(1);
  });

  it("rejects bad magic bytes before the extractor", async () => {
    currentUser = alice;
    const res = await upload(new TextEncoder().encode("GIF89a not a pdf"));
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects declared bodies over 25 MB", async () => {
    currentUser = alice;
    const url = new URL("/api/uploads", ORIGIN);
    const res = await POST(
      new NextRequest(url, {
        method: "POST",
        body: PDF,
        headers: { origin: ORIGIN, "content-length": String(26 * 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("streams to the extractor with the shared secret and returns candidate cards", async () => {
    currentUser = alice;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      // Consume the streamed body like the real extractor would.
      await new Response(init.body).arrayBuffer();
      return Response.json(extractorReply);
    });
    const res = await upload(PDF, { deckId: aliceDeck });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.json();
    expect(body.cards).toEqual([
      { front: "Q?", back: "A", cardType: "basic", options: null, confidence: 0.9, sourceRef: "page 1", detector: "labeled_pair" },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://extractor.test:8000/v1/extract");
    expect((init.headers as Record<string, string>)["x-extractor-secret"]).toBe("x".repeat(40));
  });

  it("maps extractor errors", async () => {
    currentUser = alice;
    fetchMock.mockResolvedValue(Response.json({ error: "encrypted_file" }, { status: 422 }));
    const res = await upload(PDF);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("encrypted_file");
  });

  it("returns 429 with Retry-After once the hourly limit is used up", async () => {
    const carol = await createUser("carol");
    currentUser = carol;
    fetchMock.mockImplementation(async () => Response.json(extractorReply));
    for (let i = 0; i < 10; i++) expect((await upload(PDF)).status).toBe(200);
    const res = await upload(PDF);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(3500);
  });

  it("passes extractor overload through as 503 with Retry-After", async () => {
    currentUser = await createUser("erin");
    fetchMock.mockResolvedValue(Response.json({ error: "busy" }, { status: 503, headers: { "Retry-After": "7" } }));
    const res = await upload(PDF);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("7");
    expect((await res.json()).error).toBe("busy");
  });

  it("stops calling a failing extractor (circuit breaker) and says when to retry", async () => {
    currentUser = await createUser("dave");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    // erin's 503 above already counted once; four more failures open it.
    for (let i = 0; i < 4; i++) expect((await upload(PDF)).status).toBe(502);
    const calls = fetchMock.mock.calls.length;
    const res = await upload(PDF);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
