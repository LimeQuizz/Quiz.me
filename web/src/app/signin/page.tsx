import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInAction, testSignInAction } from "@/server/actions/account";
import { getUserId } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    "That account is already connected to a different Quiz.me user. Sign in with it directly instead.",
  AccessDenied: "Sign-in was cancelled or denied.",
  CredentialsSignin: "Test sign-in failed.",
  Configuration: "Sign-in is not configured correctly on this server.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUserId()) redirect("/decks");
  const { error } = await searchParams;
  const testMode = process.env.AUTH_TEST_MODE === "true";
  return (
    <div className="mx-auto max-w-sm space-y-6 py-6">
      <h1 className="text-2xl font-bold">Sign in to Quiz.me</h1>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {ERRORS[error] ?? "Sign-in failed. Please try again."}
        </p>
      )}
      <div className="space-y-3">
        <form action={signInAction}>
          <input type="hidden" name="provider" value="google" />
          <button type="submit" className="btn-secondary w-full">
            Continue with Google
          </button>
        </form>
        <form action={signInAction}>
          <input type="hidden" name="provider" value="microsoft-entra-id" />
          <button type="submit" className="btn-secondary w-full">
            Continue with Microsoft
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-500">
        Personal Google and Microsoft accounts (Outlook.com, Hotmail, Live) and work or school accounts work. Quiz.me
        never sees your password.
      </p>
      {testMode && (
        <form action={testSignInAction} className="card space-y-2 border-amber-500" aria-label="Test sign-in">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Test mode is enabled</p>
          <label htmlFor="test-email" className="label">
            Test email
          </label>
          <input id="test-email" name="email" type="email" required className="input" placeholder="e2e-alice@example.test" />
          <button type="submit" className="btn-primary w-full">
            Test sign in
          </button>
        </form>
      )}
    </div>
  );
}
