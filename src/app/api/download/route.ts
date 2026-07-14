import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { resolveOutputPath, safeSessionId } from "@/lib/workspace";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

function contentTypeFor(fileName: string) {
  const extension = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];

  return extension ? contentTypes[extension] || "application/octet-stream" : "application/octet-stream";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSessionId = url.searchParams.get("sessionId");
  const fileName = url.searchParams.get("file");

  if (!rawSessionId || !fileName) {
    return NextResponse.json({ error: "sessionId and file are required." }, { status: 400 });
  }

  const sessionId = safeSessionId(rawSessionId);
  const filePath = await resolveOutputPath(sessionId, fileName);

  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const bytes = await readFile(filePath);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentTypeFor(fileName),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`
    }
  });
}
