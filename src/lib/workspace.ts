import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const root = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspaces");

export type StoredUpload = {
  name: string;
  path: string;
  size: number;
  type: string;
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

export async function storeUpload(sessionId: string, file: File): Promise<StoredUpload> {
  const { uploadDir } = await ensureSessionDirs(sessionId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const cleanName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedName = `${Date.now()}-${cleanName}`;
  const storedPath = path.join(uploadDir, storedName);

  await writeFile(storedPath, bytes);

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
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(uploadDir, entry.name);
        const info = await stat(filePath);

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
