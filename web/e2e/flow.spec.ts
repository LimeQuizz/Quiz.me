import { expect, test } from "@playwright/test";
import { FIXTURE_PPTX, signIn, testEmail } from "./helpers";

test.describe.serial("upload, review, study, and isolation", () => {
  let deckUrl = "";

  test("signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto("/decks");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toBeVisible();
  });

  test("sign in, upload a PPTX, review and accept cards", async ({ page }, info) => {
    await signIn(page, testEmail("alice", info));
    await page.getByRole("link", { name: "Upload a file" }).click();
    await page.getByTestId("file-input").setInputFiles(FIXTURE_PPTX);

    const list = page.getByTestId("review-list");
    await expect(list).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("review-card")).toHaveCount(5);
    const values = await list.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
    expect(values).toContain("What is ATP?");
    expect(values).toContain("The main energy currency of the cell");
    expect(values).toContain("Ribosome");

    // Edit one card and drop another before saving.
    const atp = list.locator("textarea").nth(values.indexOf("The main energy currency of the cell"));
    await atp.fill("Adenosine triphosphate, the cell's energy currency");
    await page.getByTestId("review-card").last().getByRole("checkbox", { name: "Keep" }).uncheck();
    await expect(page.getByTestId("review-summary")).toContainText("4 selected");

    await page.getByLabel("Deck name").fill("E2E Biology");
    await page.getByRole("button", { name: /Save deck with 4 cards/ }).click();

    await expect(page.getByTestId("deck-title")).toHaveText("E2E Biology");
    await expect(page.getByTestId("due-count")).toHaveText("4");
    deckUrl = page.url();
    expect(deckUrl).toMatch(/\/decks\/[0-9a-f-]{36}$/);
  });

  test("study with flashcards", async ({ page }, info) => {
    await signIn(page, testEmail("alice", info));
    await page.goto(deckUrl);
    await page.getByRole("link", { name: "Study", exact: true }).click();
    const card = page.getByTestId("flashcard");
    await expect(card).toBeVisible();
    await expect(page.getByText("4 left")).toBeVisible();
    await card.click();
    await expect(page.getByTestId("card-back")).toBeVisible();
    await page.getByRole("button", { name: /^Good/ }).click();
    await expect(page.getByText("1 reviewed")).toBeVisible();
    await page.getByTestId("flashcard").click();
    await page.getByRole("button", { name: /^Easy/ }).click();
    await expect(page.getByText("2 reviewed")).toBeVisible();

    await page.goto(deckUrl);
    await expect(page.getByTestId("due-count")).not.toHaveText("4");
  });

  test("a second user cannot open the first user's deck by URL", async ({ browser }, info) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, testEmail("bob", info));
    await expect(page.getByTestId("deck-link")).toHaveCount(0);

    const deckId = deckUrl.split("/").pop()!;
    for (const path of [`/decks/${deckId}`, `/decks/${deckId}/edit`, `/decks/${deckId}/study/flashcards`, `/upload?deckId=${deckId}`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(page.getByText("E2E Biology")).toHaveCount(0);
    }
    const csv = await page.request.get(`/api/decks/${deckId}/export`);
    expect(csv.status()).toBe(404);
    await context.close();
  });
});
