import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe. Does not touch the database so a DB blip does not restart pods. */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
