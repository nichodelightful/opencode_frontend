import { NextResponse } from "next/server";
import { ensureSessionMetadata, getMessages, listOutputs, listUploads, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { sessionId: string } }) {
  const sessionId = safeSessionId(params.sessionId);
  const session = await ensureSessionMetadata(sessionId);
  const messages = await getMessages(sessionId);
  const uploads = await listUploads(sessionId);
  const outputs = await listOutputs(sessionId);

  return NextResponse.json({ session, messages, uploads, outputs });
}
