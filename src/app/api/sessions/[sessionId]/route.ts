import { NextResponse } from "next/server";
import { deleteSession, ensureSessionMetadata, getMessages, listOutputs, listUploads, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  const sessionId = safeSessionId((await params).sessionId);
  const session = await ensureSessionMetadata(sessionId);
  const messages = await getMessages(sessionId);
  const uploads = await listUploads(sessionId);
  const outputs = await listOutputs(sessionId);

  return NextResponse.json({ session, messages, uploads, outputs });
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const sessionId = safeSessionId((await params).sessionId);
  await deleteSession(sessionId);

  return NextResponse.json({ ok: true });
}
