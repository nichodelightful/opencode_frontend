import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const models = (process.env.OPENCODE_MODEL_OPTIONS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return NextResponse.json({ models });
}
