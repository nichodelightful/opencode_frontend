import { spawn } from "child_process";
import path from "path";

export type OpencodeResult = {
  output: string;
  exitCode: number | null;
  command: string;
};

export function sanitizeOpencodeOutput(value: string) {
  return value
    .replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, "")
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

export function cleanModel(value: string | undefined) {
  const model = value?.trim();

  if (!model) return undefined;
  if (model.length > 200 || /[\r\n]/.test(model)) return undefined;

  return model;
}

export function buildTaskMessage(message: string, sessionRoot: string) {
  return [
    message,
    "",
    "System instruction for this web app:",
    `- The session workspace is ${sessionRoot}.`,
    "- Uploaded source files are in uploads/.",
    "- If the user asks you to edit, convert, revise, annotate, summarize into a file, or create a Word/Excel/PowerPoint output, save the finished downloadable file in outputs/.",
    "- Do not overwrite uploaded originals. Create a new file with a clear name such as outputs/revised-original.docx, outputs/updated-deck.pptx, or outputs/analysis.xlsx.",
    "- For Office files, prefer Python tools when useful: python-docx for .docx, python-pptx for .pptx, and openpyxl for .xlsx.",
    "- In your final answer, briefly mention any generated output file names."
  ].join("\n");
}

export function createOpencodeArgs(sessionRoot: string, message: string, files: string[] = [], modelOverride?: string) {
  const model = cleanModel(modelOverride) || cleanModel(process.env.OPENCODE_MODEL);
  const args = ["run", buildTaskMessage(message, sessionRoot), "--dir", sessionRoot, "--auto"];

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

  return args;
}

export function runOpencode(sessionRoot: string, message: string, files: string[] = [], modelOverride?: string) {
  return new Promise<OpencodeResult>((resolve, reject) => {
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 600000);
    const args = createOpencodeArgs(sessionRoot, message, files, modelOverride);
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
