import { NextResponse } from "next/server";
import { appendMessages, ensureSessionDirs, getMessages, safeSessionId, setSessionTitleFromMessage } from "@/lib/workspace";
import { cleanGeneratedOutputs, cleanModel, runOpencode, sanitizeOpencodeOutput } from "@/lib/opencode";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; sessionId?: string; files?: string[]; model?: string };
  const sessionId = safeSessionId(body.sessionId);
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const { sessionRoot } = await ensureSessionDirs(sessionId);
  await appendMessages(sessionId, [{ role: "user", content: message }]);
  await setSessionTitleFromMessage(sessionId, message);
  const previousMessages = (await getMessages(sessionId)).slice(-10, -1);
  const conversationContext = previousMessages.map((item) => `${item.role}: ${item.content}`).join("\n");
  let result: Awaited<ReturnType<typeof runOpencode>>;

  try {
    console.log("Starting opencode", {
      sessionId,
      sessionRoot,
      fileCount: body.files?.length || 0,
      model: cleanModel(body.model) || process.env.OPENCODE_MODEL || "default"
    });
    result = await runOpencode(sessionRoot, message, body.files || [], body.model, conversationContext);
    await cleanGeneratedOutputs(sessionRoot);
    console.log("Finished opencode", {
      sessionId,
      exitCode: result.exitCode,
      outputLength: result.output.length
    });
  } catch (error) {
    const detail = sanitizeOpencodeOutput(error instanceof Error ? error.message : "Unknown opencode spawn error.");
    console.error("Failed to start opencode", { detail, sessionRoot });

    return NextResponse.json(
      {
        error: "Failed to start opencode.",
        detail
      },
      { status: 500 }
    );
  }

  if (result.exitCode !== 0) {
    console.error("opencode failed", {
      exitCode: result.exitCode,
      command: result.command,
      output: result.output,
      sessionRoot
    });

    if (result.output) {
      await appendMessages(sessionId, [
        { role: "assistant", content: `${result.output}\n\n[注意] opencode 有回傳內容，但其中某個工具或子步驟失敗了。` }
      ]);
      return NextResponse.json({
        sessionId,
        reply: `${result.output}\n\n[注意] opencode 有回傳內容，但其中某個工具或子步驟失敗了。`
      });
    }

    return NextResponse.json(
      {
        error: "opencode failed.",
        detail: result.output || `opencode exited with code ${result.exitCode}`,
        exitCode: result.exitCode
      },
      { status: 500 }
    );
  }

  await appendMessages(sessionId, [{ role: "assistant", content: result.output || "opencode completed without text output." }]);

  return NextResponse.json({
    sessionId,
    reply: result.output || "opencode completed without text output."
  });
}
