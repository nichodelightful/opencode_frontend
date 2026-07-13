import { NextResponse } from "next/server";
import { ensureSessionDirs, safeSessionId } from "@/lib/workspace";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

function runOpencode(sessionRoot: string, message: string, files: string[] = []) {
  return new Promise<{ output: string; exitCode: number | null }>((resolve, reject) => {
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const model = process.env.OPENCODE_MODEL?.trim();
    const args = ["run", "--dir", sessionRoot, "--auto"];

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

    args.push(message);

    const child = spawn(opencodeBin, args, {
      cwd: sessionRoot,
      env: process.env,
      shell: false
    });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      const combined = [output.trim(), errorOutput.trim()].filter(Boolean).join("\n");
      resolve({ output: combined, exitCode });
    });
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; sessionId?: string; files?: string[] };
  const sessionId = safeSessionId(body.sessionId);
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const { sessionRoot } = await ensureSessionDirs(sessionId);
  const result = await runOpencode(sessionRoot, message, body.files || []);

  if (result.exitCode !== 0) {
    return NextResponse.json(
      {
        error: "opencode failed.",
        detail: result.output || `opencode exited with code ${result.exitCode}`
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId,
    reply: result.output || "opencode completed without text output."
  });
}
