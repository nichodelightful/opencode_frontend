import { NextResponse } from "next/server";
import { getAuthConfigurationError } from "@/lib/auth-config";

export const runtime = "nodejs";

export async function GET() {
  if (getAuthConfigurationError()) {
    return NextResponse.json({ status: "error", error: "Authentication is not configured." }, { status: 503 });
  }

  return NextResponse.json({ status: "ok" });
}
