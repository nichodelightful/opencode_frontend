import { NextResponse } from "next/server";
import { createSessionId, ensureSessionMetadata, listSessions } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST() {
  const sessionId = createSessionId();
  const session = await ensureSessionMetadata(sessionId);

  return NextResponse.json({ session });
}
