import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { cleanGeneratedOutputs, cleanModel, createOpencodeArgs, sanitizeOpencodeOutput } from "@/lib/opencode";
import { ensureSessionDirs, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function extractTextFromEvent(value: unknown, parentKey = ""): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    return ["text", "delta", "content", "output"].includes(parentKey) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromEvent(item, parentKey));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : "";
    const type = typeof record.type === "string" ? record.type : "";

    if (["user", "system"].includes(role)) return [];
    if (type.toLowerCase().includes("tool")) return [];

    return Object.entries(record).flatMap(([key, item]) => extractTextFromEvent(item, key));
  }

  return [];
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
      const args = createOpencodeArgs(sessionRoot, message, body.files || [], body.model, { format: "json" });
      const child = spawn(opencodeBin, args, {
        cwd: sessionRoot,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let rawOutput = "";
      let rawError = "";
      let sentOutput = "";
      let jsonBuffer = "";
      const startedAt = Date.now();

      controller.enqueue(encoder.encode(sse("session", { sessionId })));
      console.log("Starting streaming opencode", {
        sessionId,
        sessionRoot,
        fileCount: body.files?.length || 0,
        model: cleanModel(body.model) || process.env.OPENCODE_MODEL || "default"
      });

      const emitText = (candidate: string) => {
        const cleaned = sanitizeOpencodeOutput(candidate);
        if (!cleaned) return;

        if (cleaned.startsWith(sentOutput)) {
          const chunk = cleaned.slice(sentOutput.length);
          if (!chunk) return;
          sentOutput = cleaned;
          controller.enqueue(encoder.encode(sse("chunk", { chunk })));
          return;
        }

        if (sentOutput.includes(cleaned)) return;

        const chunk = sentOutput ? `\n${cleaned}` : cleaned;
        sentOutput += chunk;
        controller.enqueue(encoder.encode(sse("chunk", { chunk })));
      };

      const processJsonLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const event = JSON.parse(trimmed) as unknown;
          const text = extractTextFromEvent(event).join("");
          emitText(text);
        } catch {
          emitText(trimmed);
        }
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
        const text = chunk.toString();
        rawOutput += text;
        jsonBuffer += text;

        const lines = jsonBuffer.split("\n");
        jsonBuffer = lines.pop() || "";
        lines.forEach(processJsonLine);
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

      child.on("close", async (exitCode) => {
        clearTimeout(timeout);
        clearInterval(statusInterval);
        await cleanGeneratedOutputs(sessionRoot);
        if (jsonBuffer.trim()) processJsonLine(jsonBuffer);
        const fallbackOutput = sanitizeOpencodeOutput(
          [rawOutput.trim(), rawError.trim()].filter(Boolean).join("\n")
        );
        const finalOutput = sentOutput || fallbackOutput;
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
