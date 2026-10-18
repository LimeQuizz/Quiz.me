import { beforeAll, describe, expect, it } from "vitest";
import {
  addCards,
  assertDeckOwned,
  createDeck,
  deleteCard,
  deleteDeck,
  exportDeckCsv,
  getDeck,
  getDeckStats,
  getDueCards,
  listCards,
  listDecks,
  NotFoundError,
  recordReview,
  updateCard,
  updateDeck,
} from "@/server/data";
import { basicCard, createUser, mcqCard } from "./helpers";

describe("ownership layer: cross-user access is denied", () => {
  let alice: string;
  let bob: string;
  let aliceDeck: string;
  let aliceCard: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    const deck = await createDeck(alice, {
      name: "Alice's private deck",
      description: null,
      sourceFilename: "notes.pdf",
      cards: [basicCard("Capital of France?", "Paris"), mcqCard("Red planet?", ["Venus", "Mars"], "Mars")],
    });
    aliceDeck = deck.id;
    aliceCard = (await listCards(alice, aliceDeck))[0]!.id;
  });

  it("owner can read their deck and cards", async () => {
    expect((await getDeck(alice, aliceDeck)).name).toBe("Alice's private deck");
    const cards = await listCards(alice, aliceDeck);
    expect(cards.map((c) => c.front)).toEqual(["Capital of France?", "Red planet?"]);
    expect(cards[1]!.options).toEqual(["Venus", "Mars"]);
    expect((await listDecks(alice)).map((d) => d.id)).toContain(aliceDeck);
  });

  it("another user cannot read the deck", async () => {
    await expect(getDeck(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assertDeckOwned(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listCards(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDueCards(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDeckStats(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listDecks(bob)).map((d) => d.id)).not.toContain(aliceDeck);
  });

  it("another user cannot edit the deck or its cards", async () => {
    await expect(
      updateDeck(bob, { deckId: aliceDeck, name: "pwned", description: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateCard(bob, { cardId: aliceCard, front: "pwned", back: "pwned" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDeck(alice, aliceDeck)).name).toBe("Alice's private deck");
    expect((await listCards(alice, aliceDeck))[0]!.front).toBe("Capital of France?");
  });

  it("another user cannot delete the deck or its cards", async () => {
    await expect(deleteDeck(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCard(bob, aliceCard)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listCards(alice, aliceDeck)).toHaveLength(2);
  });

  it("another user cannot export the deck", async () => {
    await expect(exportDeckCsv(bob, aliceDeck)).rejects.toBeInstanceOf(NotFoundError);
    const { csv } = await exportDeckCsv(alice, aliceDeck);
    expect(csv).toContain("Capital of France?,Paris,basic");
  });

  it("another user cannot add (upload) cards into the deck", async () => {
    await expect(addCards(bob, aliceDeck, [basicCard("injected", "card")])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await listCards(alice, aliceDeck)).toHaveLength(2);
  });

  it("another user cannot review the deck's cards", async () => {
    await expect(recordReview(bob, aliceCard, 3)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDeckStats(alice, aliceDeck)).review).toBe(0);
  });

  it("unknown IDs look exactly like other users' IDs", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(getDeck(bob, missing)).rejects.toThrow("Deck not found");
    await expect(getDeck(bob, aliceDeck)).rejects.toThrow("Deck not found");
  });

  it("owner can append, edit, and delete", async () => {
    await addCards(alice, aliceDeck, [basicCard("New?", "Yes")]);
    let cards = await listCards(alice, aliceDeck);
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
    await updateCard(alice, { cardId: cards[1]!.id, front: "Red planet?", back: "Mars (4th)" });
    cards = await listCards(alice, aliceDeck);
    expect(cards[1]!.options).toEqual(["Venus", "Mars (4th)"]);
    await deleteCard(alice, cards[2]!.id);
    expect(await listCards(alice, aliceDeck)).toHaveLength(2);
    const other = await createDeck(alice, {
      name: "temp",
      description: null,
      sourceFilename: null,
      cards: [basicCard("a", "b")],
    });
    await deleteDeck(alice, other.id);
    await expect(getDeck(alice, other.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
