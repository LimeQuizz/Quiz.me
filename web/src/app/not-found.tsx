import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-zinc-600 dark:text-zinc-400">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/decks" className="btn-secondary">
        Back to your decks
      </Link>
    </div>
  );
}
