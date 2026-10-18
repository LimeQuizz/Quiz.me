import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccount } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { deleteAccountAction, signInAction } from "@/server/actions/account";

export const metadata: Metadata = { title: "Account" };

const PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "microsoft-entra-id", label: "Microsoft" },
] as const;

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const userId = await requireUserId();
  const account = await getAccount(userId);
  if (!account) redirect("/signin");
  const { error } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Account</h1>
      <section className="card space-y-1">
        <p className="font-medium">{account.name ?? "Signed in"}</p>
        {account.email && <p className="text-sm text-zinc-600 dark:text-zinc-400">{account.email}</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Sign-in methods</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Accounts are never merged automatically, even if the email addresses match. Link a second provider here if you want to
          sign in to this same Quiz.me account with it.
        </p>
        <ul className="space-y-2">
          {PROVIDERS.map((p) => {
            const linked = account.providers.includes(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.label}</span>
                {linked ? (
                  <span className="text-sm font-medium text-brand-700 dark:text-brand-500">Linked</span>
                ) : (
                  <form action={signInAction}>
                    <input type="hidden" name="provider" value={p.id} />
                    <input type="hidden" name="redirectTo" value="/account" />
                    <button type="submit" className="btn-secondary">
                      Link {p.label}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card space-y-3 border-red-300 dark:border-red-900">
        <h2 className="font-semibold text-red-700 dark:text-red-400">Delete my account</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This permanently deletes your account, every deck and card, your study history, and your sign-in links. It cannot be
          undone. Export any decks you want to keep first.
        </p>
        <form action={deleteAccountAction} className="space-y-2">
          <label htmlFor="confirm" className="label">
            Type DELETE to confirm
          </label>
          <input id="confirm" name="confirm" className="input" autoComplete="off" required pattern="DELETE" />
          {error === "confirm" && (
            <p role="alert" className="text-sm text-red-700">
              Type DELETE exactly to confirm.
            </p>
          )}
          <button type="submit" className="btn-danger">
            Delete my account
          </button>
        </form>
      </section>
    </div>
  );
}
