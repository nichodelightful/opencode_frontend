import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const root = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspaces");
const maxPdfTextBytes = 1024 * 1024;
const pdfTextTimeoutMs = 60000;

type PdfExtractionStatus = "complete" | "truncated" | "no-text" | "failed";

export type StoredUpload = {
  name: string;
  path: string;
  size: number;
  type: string;
  warning?: string;
};

export type OutputFile = {
  name: string;
  path: string;
  size: number;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type SessionMetadata = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export function createSessionId() {
  return randomUUID();
}

export function safeSessionId(value: string | null | undefined) {
  if (!value || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    return createSessionId();
  }

  return value;
}

export async function ensureSessionDirs(sessionId: string) {
  const sessionRoot = path.join(root, sessionId);
  const uploadDir = path.join(sessionRoot, "uploads");
  const outputDir = path.join(sessionRoot, "outputs");

  await mkdir(uploadDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  return { sessionRoot, uploadDir, outputDir };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export async function ensureSessionMetadata(sessionId: string, title = "新聊天") {
  const { sessionRoot } = await ensureSessionDirs(sessionId);
  const metadataPath = path.join(sessionRoot, "metadata.json");
  const now = new Date().toISOString();
  const current = await readJson<SessionMetadata | null>(metadataPath, null);

  if (current) return current;

  const metadata = { id: sessionId, title, createdAt: now, updatedAt: now };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  return metadata;
}

export async function updateSessionMetadata(sessionId: string, changes: Partial<Pick<SessionMetadata, "title" | "updatedAt">>) {
  const { sessionRoot } = await ensureSessionDirs(sessionId);
  const metadataPath = path.join(sessionRoot, "metadata.json");
  const current = await ensureSessionMetadata(sessionId);
  const next = { ...current, ...changes, updatedAt: changes.updatedAt || new Date().toISOString() };

  await writeFile(metadataPath, JSON.stringify(next, null, 2));

  return next;
}

export async function listSessions() {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const metadataPath = path.join(root, entry.name, "metadata.json");
        return readJson<SessionMetadata | null>(metadataPath, null);
      })
  );

  return sessions.filter((session): session is SessionMetadata => Boolean(session)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMessages(sessionId: string) {
  const { sessionRoot } = await ensureSessionDirs(sessionId);
  return readJson<ChatMessage[]>(path.join(sessionRoot, "messages.json"), []);
}

export async function appendMessages(sessionId: string, messages: Array<Omit<ChatMessage, "id" | "createdAt"> & Partial<Pick<ChatMessage, "id" | "createdAt">>>) {
  const { sessionRoot } = await ensureSessionDirs(sessionId);
  const messagesPath = path.join(sessionRoot, "messages.json");
  const current = await getMessages(sessionId);
  const now = new Date().toISOString();
  const nextMessages = messages.map((message) => ({
    id: message.id || randomUUID(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || now
  }));
  const next = [...current, ...nextMessages];

  await writeFile(messagesPath, JSON.stringify(next, null, 2));
  await ensureSessionMetadata(sessionId, nextMessages.find((message) => message.role === "user")?.content.slice(0, 60) || "新聊天");
  await updateSessionMetadata(sessionId, { updatedAt: now });

  return next;
}

export async function setSessionTitleFromMessage(sessionId: string, message: string) {
  const metadata = await ensureSessionMetadata(sessionId);
  if (metadata.title !== "新聊天") return metadata;

  return updateSessionMetadata(sessionId, { title: message.slice(0, 40) || "新聊天" });
}

export async function deleteSession(sessionId: string) {
  const sessionRoot = path.join(root, sessionId);
  const relativePath = path.relative(root, sessionRoot);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid session path.");
  }

  await rm(sessionRoot, { recursive: true, force: true });
}

function isPdf(name: string, type = "") {
  return type === "application/pdf" || path.extname(name).toLowerCase() === ".pdf";
}

function pdfWarning(name: string, status: PdfExtractionStatus) {
  if (status === "truncated") {
    return `${name} 的文字內容超過 1 MB，只會將前段內容提供給模型。`;
  }

  if (status === "no-text") {
    return `${name} 沒有可擷取的文字層；如果是掃描文件，需要先執行 OCR。`;
  }

  if (status === "failed") {
    return `${name} 的 PDF 文字解析失敗；原始檔已保留。`;
  }

  return undefined;
}

function formatPdfText(name: string, status: PdfExtractionStatus, text = "") {
  const safeName = name.replace(/[\r\n]/g, " ");
  const statusNote =
    status === "truncated"
      ? "Only the first 1 MB of extracted text is included."
      : status === "no-text"
        ? "No extractable text layer was found. This PDF may require OCR."
        : status === "failed"
          ? "Text extraction failed. The original PDF remains in the uploads directory."
          : "Text extraction completed.";

  return [
    "PDF text extracted by AI ChatBox.",
    `Original file: ${safeName}`,
    `Extraction status: ${status}`,
    statusNote,
    "",
    "--- Extracted text ---",
    text
  ].join("\n");
}

function extractPdfText(pdfPath: string) {
  return new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
    const child = spawn("pdftotext", ["-enc", "UTF-8", "-layout", pdfPath, "-"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    let errorOutput = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const finish = (error?: Error, result?: { text: string; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2000);
      forceKill.unref();
    }, pdfTextTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = maxPdfTextBytes - capturedBytes;
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      if (chunk.length > remaining) truncated = true;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 8192) errorOutput += chunk.toString().slice(0, 8192 - errorOutput.length);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => {
      if (timedOut) {
        finish(new Error(`PDF text extraction timed out after ${pdfTextTimeoutMs}ms.`));
        return;
      }
      if (exitCode !== 0) {
        finish(new Error(errorOutput.trim() || `pdftotext exited with code ${exitCode}.`));
        return;
      }

      const text = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      finish(undefined, { text, truncated });
    });
  });
}

async function ensurePdfTextSidecar(pdfPath: string, name: string) {
  const sidecarPath = `${pdfPath}.txt`;

  try {
    const existing = await readFile(sidecarPath, "utf8");
    const status = existing.match(/^Extraction status: (complete|truncated|no-text|failed)$/m)?.[1] as PdfExtractionStatus | undefined;
    if (status) return { path: sidecarPath, status };
  } catch {
    // Extract below when this PDF predates sidecar support.
  }

  try {
    const { text, truncated } = await extractPdfText(pdfPath);
    const status: PdfExtractionStatus = !text ? "no-text" : truncated ? "truncated" : "complete";
    await writeFile(sidecarPath, formatPdfText(name, status, text));
    return { path: sidecarPath, status };
  } catch {
    try {
      await writeFile(sidecarPath, formatPdfText(name, "failed"));
      return { path: sidecarPath, status: "failed" as const };
    } catch {
      return { path: pdfPath, status: "failed" as const };
    }
  }
}

export async function storeUpload(sessionId: string, file: File): Promise<StoredUpload> {
  const { uploadDir } = await ensureSessionDirs(sessionId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const pdf = isPdf(file.name, file.type);
  const cleanBaseName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const cleanName = pdf && path.extname(cleanBaseName).toLowerCase() !== ".pdf" ? `${cleanBaseName}.pdf` : cleanBaseName;
  const storedName = `${Date.now()}-${cleanName}`;
  const storedPath = path.join(uploadDir, storedName);

  await writeFile(storedPath, bytes);

  if (pdf) {
    const extraction = await ensurePdfTextSidecar(storedPath, file.name);

    return {
      name: file.name,
      path: extraction.path,
      size: file.size,
      type: "application/pdf",
      warning: pdfWarning(file.name, extraction.status)
    };
  }

  return {
    name: file.name,
    path: storedPath,
    size: file.size,
    type: file.type || "application/octet-stream"
  };
}

export async function listUploads(sessionId: string): Promise<StoredUpload[]> {
  const { uploadDir } = await ensureSessionDirs(sessionId);
  const entries = await readdir(uploadDir, { withFileTypes: true });
  const fileEntries = entries.filter((entry) => entry.isFile());
  const fileNames = new Set(fileEntries.map((entry) => entry.name));
  const files = await Promise.all(
    fileEntries
      .filter((entry) => !(entry.name.toLowerCase().endsWith(".pdf.txt") && fileNames.has(entry.name.slice(0, -4))))
      .map(async (entry) => {
        const filePath = path.join(uploadDir, entry.name);
        const info = await stat(filePath);

        if (isPdf(entry.name)) {
          const extraction = await ensurePdfTextSidecar(filePath, entry.name);

          return {
            name: entry.name,
            path: extraction.path,
            size: info.size,
            type: "application/pdf",
            warning: pdfWarning(entry.name, extraction.status)
          };
        }

        return {
          name: entry.name,
          path: filePath,
          size: info.size,
          type: "application/octet-stream"
        };
      })
  );

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOutputs(sessionId: string): Promise<OutputFile[]> {
  const { outputDir } = await ensureSessionDirs(sessionId);
  const entries = await readdir(outputDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(outputDir, entry.name);
        const info = await stat(filePath);

        return {
          name: entry.name,
          path: filePath,
          size: info.size,
          updatedAt: info.mtime.toISOString()
        };
      })
  );

  return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function resolveOutputPath(sessionId: string, fileName: string) {
  const { outputDir } = await ensureSessionDirs(sessionId);
  const cleanName = path.basename(fileName);
  const filePath = path.join(outputDir, cleanName);
  const relativePath = path.relative(outputDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid output file path.");
  }

  return filePath;
}
