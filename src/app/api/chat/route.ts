import { NextResponse } from "next/server";
import { ensureSessionDirs, safeSessionId } from "@/lib/workspace";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

function sanitizeOpencodeOutput(value: string) {
  return value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) return true;
      if (trimmed.startsWith("<system-reminder>")) return false;
      if (trimmed.startsWith("</system-reminder>")) return false;
      if (/^>\s+\S+\s+·\s+/.test(trimmed)) return false;
      if (/^[$%◈]\s+/.test(trimmed)) return false;
      if (/^✗\s+/.test(trimmed)) return false;
      if (/^Error:\s+StatusCode:\s+non 2xx status code/.test(trimmed)) return false;

      return true;
    })
    .join("\n")
    .trim();
}

function cleanModel(value: string | undefined) {
  const model = value?.trim();

  if (!model) return undefined;
  if (model.length > 200 || /[\r\n]/.test(model)) return undefined;

  return model;
}

function runOpencode(sessionRoot: string, message: string, files: string[] = [], modelOverride?: string) {
  return new Promise<{ output: string; exitCode: number | null; command: string }>((resolve, reject) => {
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const model = cleanModel(modelOverride) || cleanModel(process.env.OPENCODE_MODEL);
    const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 180000);
    const args = ["run", message, "--dir", sessionRoot, "--auto"];

    if (model) {
      args.push("--model", model);
    }

    for (const file of files) {
      const absoluteFile = path.resolve(file);
      const relativeFile = path.relative(sessionRoot, absoluteFile);

      if (relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) {
        continue;
      }

      args.push("--file", absoluteFile);
    }

    const child = spawn(opencodeBin, args, {
      cwd: sessionRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      reject(new Error(`opencode timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const combined = sanitizeOpencodeOutput(
        exitCode === 0 ? output.trim() : [output.trim(), errorOutput.trim()].filter(Boolean).join("\n")
      );
      resolve({ output: combined, exitCode, command: [opencodeBin, ...args].join(" ") });
    });
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; sessionId?: string; files?: string[]; model?: string };
  const sessionId = safeSessionId(body.sessionId);
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const { sessionRoot } = await ensureSessionDirs(sessionId);
  let result: Awaited<ReturnType<typeof runOpencode>>;

  try {
    console.log("Starting opencode", {
      sessionId,
      sessionRoot,
      fileCount: body.files?.length || 0,
      model: cleanModel(body.model) || process.env.OPENCODE_MODEL || "default"
    });
    result = await runOpencode(sessionRoot, message, body.files || [], body.model);
    console.log("Finished opencode", {
      sessionId,
      exitCode: result.exitCode,
      outputLength: result.output.length
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown opencode spawn error.";
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

    return NextResponse.json(
      {
        error: "opencode failed.",
        detail: result.output || `opencode exited with code ${result.exitCode}`,
        exitCode: result.exitCode
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId,
    reply: result.output || "opencode completed without text output."
  });
}
