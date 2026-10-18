import Link from "next/link";

export function Done({ deckId, title, children }: { deckId: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="card space-y-3 text-center" role="status">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
      <Link href={`/decks/${deckId}`} className="btn-secondary">
        Back to deck
      </Link>
    </div>
  );
}
