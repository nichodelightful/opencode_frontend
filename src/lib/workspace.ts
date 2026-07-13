import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const root = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspaces");

export type StoredUpload = {
  name: string;
  path: string;
  size: number;
  type: string;
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
