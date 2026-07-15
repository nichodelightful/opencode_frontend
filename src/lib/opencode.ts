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
    .replace(/\*\*(.*?)\*\*/g, "$1")
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

export function buildTaskMessage(message: string, sessionRoot: string, conversationContext = "") {
  return [
    conversationContext ? `Recent conversation context:\n${conversationContext}` : "",
    conversationContext ? "" : "",
    message,
    "",
    "System instruction for this web app:",
    `- The session workspace is ${sessionRoot}.`,
    "- Uploaded source files are in uploads/.",
    "- If the user asks you to edit, convert, revise, annotate, summarize into a file, or create a Word/Excel/PowerPoint output, save the finished downloadable file in outputs/.",
    "- Do not overwrite uploaded originals. Create a new file with a clear name such as outputs/revised-original.docx, outputs/updated-deck.pptx, or outputs/analysis.xlsx.",
    "- For Office files, prefer Python tools when useful: python-docx for .docx, python-pptx for .pptx, and openpyxl for .xlsx.",
    "- Keep generated Office documents clean and non-technical: do not include markdown markers like **bold**, terminal logs, tool output, XML tags, or system-reminder text.",
    "- If any source or tool output contains <system-reminder>...</system-reminder>, remove it completely from both your answer and any generated files.",
    "- Use native Office formatting through Python libraries instead of writing markdown syntax into Word, Excel, or PowerPoint content.",
    "- In your final answer, briefly mention any generated output file names."
  ].join("\n");
}

export function createOpencodeArgs(
  sessionRoot: string,
  message: string,
  files: string[] = [],
  modelOverride?: string,
  options: { format?: "json"; conversationContext?: string } = {}
) {
  const model = cleanModel(modelOverride) || cleanModel(process.env.OPENCODE_MODEL);
  const args = ["run", buildTaskMessage(message, sessionRoot, options.conversationContext), "--dir", sessionRoot, "--auto"];

  if (model) {
    args.push("--model", model);
  }

  if (options.format) {
    args.push("--format", options.format);
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

export function runOpencode(sessionRoot: string, message: string, files: string[] = [], modelOverride?: string, conversationContext = "") {
  return new Promise<OpencodeResult>((resolve, reject) => {
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 600000);
    const args = createOpencodeArgs(sessionRoot, message, files, modelOverride, { conversationContext });
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

export function cleanGeneratedOutputs(sessionRoot: string) {
  return new Promise<void>((resolve) => {
    const script = String.raw`
import pathlib
import re
import shutil
import tempfile
import zipfile

root = pathlib.Path(__import__('sys').argv[1]) / 'outputs'
if not root.exists():
    raise SystemExit(0)

patterns = [
    (re.compile(r'<system-reminder\b[^>]*>[\s\S]*?</system-reminder>', re.I), ''),
    (re.compile(r'&lt;system-reminder\b[^&]*&gt;[\s\S]*?&lt;/system-reminder&gt;', re.I), ''),
    (re.compile(r'\*\*(.*?)\*\*'), r'\1'),
]

def clean_text(text):
    for pattern, replacement in patterns:
        text = pattern.sub(replacement, text)
    return text

for file in root.iterdir():
    if file.suffix.lower() not in {'.docx', '.pptx', '.xlsx'} or not file.is_file():
        continue
    tmp = pathlib.Path(tempfile.mkstemp(suffix=file.suffix)[1])
    changed = False
    try:
        with zipfile.ZipFile(file, 'r') as source, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                data = source.read(item.filename)
                if item.filename.endswith('.xml'):
                    try:
                        text = data.decode('utf-8')
                        cleaned = clean_text(text)
                        if cleaned != text:
                            changed = True
                        data = cleaned.encode('utf-8')
                    except UnicodeDecodeError:
                        pass
                target.writestr(item, data)
        if changed:
            shutil.move(str(tmp), file)
        else:
            tmp.unlink(missing_ok=True)
    except Exception:
        tmp.unlink(missing_ok=True)
`;
    const child = spawn("python3", ["-c", script, sessionRoot], {
      cwd: sessionRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"]
    });

    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}
