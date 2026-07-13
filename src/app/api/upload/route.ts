import { NextResponse } from "next/server";
import { safeSessionId, storeUpload } from "@/lib/workspace";

export const runtime = "nodejs";

const maxFileSize = 100 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const sessionId = safeSessionId(form.get("sessionId")?.toString());
  const files = form.getAll("files").filter((item): item is File => item instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const oversized = files.find((file) => file.size > maxFileSize);
  if (oversized) {
    return NextResponse.json({ error: `${oversized.name} is larger than 100MB.` }, { status: 413 });
  }

  const uploads = await Promise.all(files.map((file) => storeUpload(sessionId, file)));

  return NextResponse.json({ sessionId, uploads });
}
