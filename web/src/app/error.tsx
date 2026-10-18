"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Please try again.</p>
      <button type="button" onClick={reset} className="btn-secondary">
        Try again
      </button>
    </div>
  );
}
