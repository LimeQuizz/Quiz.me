import { expect, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_PPTX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extractor/tests/fixtures/lecture.pptx");

const RUN = Date.now().toString(36);

/** A test email unique per run and per device project. */
export function testEmail(name: string, info: TestInfo): string {
  return `e2e-${name}-${info.project.name}-${RUN}@example.test`.slice(0, 64).replace(/-+@/, "@");
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Test email").fill(email);
  await page.getByRole("button", { name: "Test sign in" }).click();
  await expect(page).toHaveURL(/\/decks$/);
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
}
