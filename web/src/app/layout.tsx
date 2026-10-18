import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { signOutAction } from "@/server/actions/account";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Quiz.me", template: "%s · Quiz.me" },
  description: "Open source flashcards from your own PDFs and slides.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16a34a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <nav className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2 sm:gap-3 sm:px-4" aria-label="Main">
            <Link href={signedIn ? "/decks" : "/"} className="mr-auto text-lg font-bold text-brand-700 dark:text-brand-500">
              Quiz.me
            </Link>
            {signedIn ? (
              <>
                <Link href="/decks" className="rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Decks
                </Link>
                <Link href="/upload" className="rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Upload
                </Link>
                <Link href="/account" className="rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Account
                </Link>
                <form action={signOutAction}>
                  <button type="submit" className="rounded-md px-2 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/signin" className="btn-primary">
                Sign in
              </Link>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4">{children}</main>
      </body>
    </html>
  );
}
