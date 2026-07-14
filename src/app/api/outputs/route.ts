import { NextResponse } from "next/server";
import { listOutputs, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSessionId = url.searchParams.get("sessionId");

  if (!rawSessionId) {
    return NextResponse.json({ outputs: [] });
  }

  const sessionId = safeSessionId(rawSessionId);
  const outputs = await listOutputs(sessionId);

  return NextResponse.json({ sessionId, outputs });
}
