import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { cleanModel, createOpencodeArgs, sanitizeOpencodeOutput } from "@/lib/opencode";
import { ensureSessionDirs, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; sessionId?: string; files?: string[]; model?: string };
  const sessionId = safeSessionId(body.sessionId);
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const { sessionRoot } = await ensureSessionDirs(sessionId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const opencodeBin = process.env.OPENCODE_BIN || "opencode";
      const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 600000);
      const args = createOpencodeArgs(sessionRoot, message, body.files || [], body.model);
      const child = spawn(opencodeBin, args, {
        cwd: sessionRoot,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let rawOutput = "";
      let rawError = "";
      let sentOutput = "";
      const startedAt = Date.now();

      controller.enqueue(encoder.encode(sse("session", { sessionId })));
      console.log("Starting streaming opencode", {
        sessionId,
        sessionRoot,
        fileCount: body.files?.length || 0,
        model: cleanModel(body.model) || process.env.OPENCODE_MODEL || "default"
      });

      const emitOutput = () => {
        const cleaned = sanitizeOpencodeOutput(rawOutput);
        if (cleaned.length <= sentOutput.length) return;

        const chunk = cleaned.slice(sentOutput.length);
        sentOutput = cleaned;
        controller.enqueue(encoder.encode(sse("chunk", { chunk })));
      };

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5000);
        controller.enqueue(encoder.encode(sse("error", { detail: `opencode timed out after ${timeoutMs}ms.` })));
        controller.close();
      }, timeoutMs);

      const statusInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        controller.enqueue(
          encoder.encode(
            sse("status", {
              message: `opencode 正在處理中，目前已執行 ${elapsedSeconds} 秒。若正在分析或修改 Office 檔，可能需要幾分鐘。`
            })
          )
        );
      }, 5000);

      child.stdout.on("data", (chunk) => {
        rawOutput += chunk.toString();
        emitOutput();
      });

      child.stderr.on("data", (chunk) => {
        rawError += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        clearInterval(statusInterval);
        controller.enqueue(encoder.encode(sse("error", { detail: sanitizeOpencodeOutput(error.message) })));
        controller.close();
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        clearInterval(statusInterval);
        const finalOutput = sanitizeOpencodeOutput(
          exitCode === 0 ? rawOutput.trim() : [rawOutput.trim(), rawError.trim()].filter(Boolean).join("\n")
        );
        console.log("Finished streaming opencode", { sessionId, exitCode, outputLength: finalOutput.length });

        controller.enqueue(
          encoder.encode(
            sse("done", {
              sessionId,
              exitCode,
              output: exitCode !== 0 && finalOutput ? `${finalOutput}\n\n[注意] opencode 有回傳內容，但其中某個工具或子步驟失敗了。` : finalOutput
            })
          )
        );
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
