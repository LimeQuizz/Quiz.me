import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/server/auth/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  if (await getUserId()) redirect("/decks");
  const { deleted } = await searchParams;
  return (
    <div className="space-y-8 py-6">
      {deleted && (
        <p role="status" className="card border-brand-600 text-sm">
          Your account and all of your decks have been deleted.
        </p>
      )}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Turn your notes into flashcards.</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Upload a PDF or PowerPoint, review the questions Quiz.me finds, and study them on any device.
        </p>
        <Link href="/signin" className="btn-primary">
          Get started
        </Link>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Private decks", "Only you can see your decks. Your file is deleted as soon as cards are extracted."],
          ["Spaced repetition", "Flashcards are scheduled with FSRS so you review right before you forget."],
          ["Four study modes", "Flashcards, multiple choice, typed answers, and scored tests."],
        ].map(([title, body]) => (
          <div key={title} className="card">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
