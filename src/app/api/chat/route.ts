import { NextResponse } from "next/server";
import { ensureSessionDirs, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; sessionId?: string; files?: string[] };
  const sessionId = safeSessionId(body.sessionId);
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const { sessionRoot } = await ensureSessionDirs(sessionId);

  // TODO: Replace this mock response with an opencode subprocess scoped to sessionRoot.
  return NextResponse.json({
    sessionId,
    reply: [
      "我已收到你的需求。",
      body.files?.length ? `這次有 ${body.files.length} 個檔案可以處理。` : "這次沒有附加檔案。",
      `工作目錄：${sessionRoot}`,
      "下一步會把這裡接到 opencode executor。"
    ].join("\n")
  });
}
