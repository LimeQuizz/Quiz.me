"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { log } from "@/lib/logger";
import { deleteAccount } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { secureCookiesFor, sessionCookieName } from "@/server/auth/config";
import { TEST_PROVIDER_ID } from "@/server/auth/test-provider";
import { testSignInSchema } from "@/lib/validation";

const providerSchema = z.enum(["google", "microsoft-entra-id"]);

/** Sign in, or (when already signed in) link a second provider to this user. */
export async function signInAction(formData: FormData): Promise<void> {
  const provider = providerSchema.safeParse(formData.get("provider"));
  if (!provider.success) redirect("/signin");
  const target = formData.get("redirectTo") === "/account" ? "/account" : "/decks";
  await signIn(provider.data, { redirectTo: target });
}

export async function testSignInAction(formData: FormData): Promise<void> {
  if (process.env.AUTH_TEST_MODE !== "true") redirect("/signin");
  const parsed = testSignInSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/signin?error=CredentialsSignin");
  await signIn(TEST_PROVIDER_ID, { email: parsed.data.email, redirectTo: "/decks" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

/** Permanently delete the signed-in user and all of their data. */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  if (formData.get("confirm") !== "DELETE") redirect("/account?error=confirm");
  await deleteAccount(userId);
  log.info("account deleted", { userId });
  // The session row is gone; clear the cookie as well.
  const jar = await cookies();
  jar.delete(sessionCookieName(secureCookiesFor()));
  redirect("/?deleted=1");
}
