import type { Metadata } from "next";
import { parseId } from "@/lib/params";
import { getDeck, orNotFound } from "@/server/data";
import { requireUserId } from "@/server/auth/session";
import { UploadFlow } from "./UploadFlow";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ deckId?: string }> }) {
  const userId = await requireUserId();
  const { deckId } = await searchParams;
  const target = deckId ? await orNotFound(getDeck(userId, parseId(deckId))) : null;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{target ? `Add cards to ${target.name}` : "New deck from a file"}</h1>
      <UploadFlow target={target ? { id: target.id, name: target.name } : null} />
    </div>
  );
}
