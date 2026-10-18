import { NextResponse } from "next/server";
import { csvFilename } from "@/lib/csv";
import { uuidSchema } from "@/lib/validation";
import { exportDeckCsv, NotFoundError } from "@/server/data";
import { getUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ deckId: string }> }): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { deckId } = await ctx.params;
  const parsed = uuidSchema.safeParse(deckId);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const { name, csv } = await exportDeckCsv(userId, parsed.data);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
