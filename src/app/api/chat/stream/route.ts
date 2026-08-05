import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { cleanGeneratedOutputs, cleanModel, createOpencodeArgs, getOpencodeTimeoutMs, sanitizeOpencodeOutput } from "@/lib/opencode";
import { appendMessages, ensureSessionDirs, getMessages, safeSessionId, setSessionTitleFromMessage } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 600;

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

function extractErrorMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;

  const errorRecord = error as Record<string, unknown>;
  const data = errorRecord.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  if (typeof errorRecord.message === "string" && errorRecord.message.trim()) return errorRecord.message.trim();
  if (typeof errorRecord.name === "string" && errorRecord.name.trim()) return errorRecord.name.trim();
  return undefined;
}

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
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const opencodeBin = process.env.OPENCODE_BIN || "opencode";
      const timeoutMs = getOpencodeTimeoutMs();
      const args = createOpencodeArgs(sessionRoot, message, body.files || [], body.model, { format: "json", conversationContext });
      const child = spawn(opencodeBin, args, {
        cwd: sessionRoot,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let rawError = "";
      let sentOutput = "";
      let jsonBuffer = "";
      let eventError = "";
      let streamClosed = false;
      let timedOut = false;
      let spawnFailed = false;
      const startedAt = Date.now();

      const enqueue = (event: string, data: unknown) => {
        if (streamClosed) return;
        controller.enqueue(encoder.encode(sse(event, data)));
      };
      const closeStream = () => {
        if (streamClosed) return;
        streamClosed = true;
        controller.close();
      };

      enqueue("session", { sessionId });
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
          enqueue("chunk", { chunk });
          return;
        }

        if (sentOutput.includes(cleaned)) return;

        const chunk = sentOutput ? `\n${cleaned}` : cleaned;
        sentOutput += chunk;
        enqueue("chunk", { chunk });
      };

      const processJsonLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const event = JSON.parse(trimmed) as unknown;
          if (event && typeof event === "object" && !Array.isArray(event) && (event as Record<string, unknown>).type === "error") {
            const detail = extractErrorMessage(event);
            if (detail && !eventError.includes(detail)) eventError = eventError ? `${eventError}\n${detail}` : detail;
            return;
          }
          const text = extractTextFromEvent(event).join("");
          emitText(text);
        } catch {
          emitText(trimmed);
        }
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        clearInterval(statusInterval);
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5000);
        forceKill.unref();
        enqueue("error", { detail: `opencode timed out after ${timeoutMs}ms.` });
        closeStream();
      }, timeoutMs);

      const statusInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        enqueue("status", {
          message: `opencode 正在處理中，目前已執行 ${elapsedSeconds} 秒。若正在分析或修改 Office 檔，可能需要幾分鐘。`
        });
      }, 5000);

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        jsonBuffer += text;

        const lines = jsonBuffer.split("\n");
        jsonBuffer = lines.pop() || "";
        lines.forEach(processJsonLine);
      });

      child.stderr.on("data", (chunk) => {
        rawError += chunk.toString();
      });

      child.on("error", (error) => {
        spawnFailed = true;
        clearTimeout(timeout);
        clearInterval(statusInterval);
        enqueue("error", { detail: sanitizeOpencodeOutput(error.message) });
        closeStream();
      });

      child.on("close", async (exitCode, signal) => {
        clearTimeout(timeout);
        clearInterval(statusInterval);
        await cleanGeneratedOutputs(sessionRoot);
        if (timedOut || spawnFailed) return;
        if (jsonBuffer.trim()) processJsonLine(jsonBuffer);
        const fallbackOutput = sanitizeOpencodeOutput(rawError.trim());
        const finalOutput = sentOutput || fallbackOutput;
        const failed = exitCode !== 0 || signal !== null;
        const errorDetail = sanitizeOpencodeOutput(eventError || rawError.trim()) || `opencode exited with code ${exitCode ?? signal ?? "unknown"}.`;
        console.log("Finished streaming opencode", {
          sessionId,
          exitCode,
          signal,
          elapsedMs: Date.now() - startedAt,
          outputLength: finalOutput.length,
          error: failed ? errorDetail : undefined
        });

        if (failed && !finalOutput) {
          enqueue("error", { detail: errorDetail, exitCode });
          closeStream();
          return;
        }

        const reply = failed ? `${finalOutput}\n\n[錯誤] ${errorDetail}` : finalOutput;
        if (reply) await appendMessages(sessionId, [{ role: "assistant", content: reply }]);

        enqueue("done", {
          sessionId,
          exitCode,
          output: reply
        });
        closeStream();
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
