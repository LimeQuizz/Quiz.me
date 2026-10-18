import { expect, test } from "@playwright/test";

test.describe("security headers", () => {
  for (const path of ["/", "/signin", "/api/health"]) {
    test(`are present on ${path}`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h["content-security-policy"]).toBeTruthy();
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"]).not.toContain("unsafe-inline");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["x-powered-by"]).toBeUndefined();
    });
  }

  test("pages use a fresh script nonce per request", async ({ request }) => {
    const nonce = async () => /'nonce-([^']+)'/.exec((await request.get("/signin")).headers()["content-security-policy"] ?? "")?.[1];
    const [a, b] = [await nonce(), await nonce()];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test("the page runs with the CSP enforced (no violations)", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("cross-origin state-changing requests are refused", async ({ request }) => {
    const res = await request.post("/decks", { headers: { origin: "https://evil.example" }, data: "x" });
    expect(res.status()).toBe(403);
    const upload = await request.post("/api/uploads", { headers: { origin: "https://evil.example" }, data: "%PDF-1.7" });
    expect(upload.status()).toBe(403);
  });
});
