import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAdapter } from "@/server/auth/adapter";
import { getDb } from "@/server/db/client";
import { accounts } from "@/server/db/schema";

describe("Auth.js adapter policy", () => {
  const adapter = createAdapter(getDb());

  it("never links accounts by email: same email from two providers = two users", async () => {
    const email = `shared-${Date.now()}@example.test`;
    const google = await adapter.createUser!({ id: "", email, emailVerified: null, name: "G" });
    await adapter.linkAccount!({ userId: google.id, type: "oidc", provider: "google", providerAccountId: `g-${email}` });

    // Auth.js asks the adapter for an existing user with this email before
    // creating one for a new provider account. The answer is always "none".
    expect(await adapter.getUserByEmail!(email)).toBeNull();
    const microsoft = await adapter.createUser!({ id: "", email, emailVerified: null, name: "M" });
    await adapter.linkAccount!({
      userId: microsoft.id,
      type: "oidc",
      provider: "microsoft-entra-id",
      providerAccountId: `m-${email}`,
    });

    expect(microsoft.id).not.toBe(google.id);
    expect((await adapter.getUserByAccount!({ provider: "google", providerAccountId: `g-${email}` }))?.id).toBe(google.id);
    expect(
      (await adapter.getUserByAccount!({ provider: "microsoft-entra-id", providerAccountId: `m-${email}` }))?.id,
    ).toBe(microsoft.id);
  });

  it("discards OAuth tokens and provider images", async () => {
    const user = await adapter.createUser!({
      id: "",
      email: null as unknown as string,
      emailVerified: null,
      name: "T",
      image: "https://tracker.example/avatar.png",
    });
    expect(user.image).toBeNull();
    await adapter.linkAccount!({
      userId: user.id,
      type: "oidc",
      provider: "google",
      providerAccountId: `tok-${user.id}`,
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      id_token: "id-secret",
      expires_at: 123,
    });
    const [row] = await getDb().select().from(accounts).where(eq(accounts.userId, user.id));
    expect(row).toMatchObject({ access_token: null, refresh_token: null, id_token: null, expires_at: null });
  });

  it("stores database sessions", async () => {
    const user = await adapter.createUser!({ id: "", email: "s@example.test", emailVerified: null });
    const expires = new Date(Date.now() + 60_000);
    await adapter.createSession!({ sessionToken: `sess-${user.id}`, userId: user.id, expires });
    const found = await adapter.getSessionAndUser!(`sess-${user.id}`);
    expect(found?.user.id).toBe(user.id);
  });
});
