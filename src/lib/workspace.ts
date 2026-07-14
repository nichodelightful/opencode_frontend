import { mkdir, readdir, stat, writeFile } from "fs/promises";
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
