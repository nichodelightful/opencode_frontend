import { NextResponse } from "next/server";

export const runtime = "nodejs";

const defaultGoModels = [
  "opencode-go/deepseek-v4-flash",
  "opencode-go/mimo-v2.5",
  "opencode-go/qwen3.7-plus",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m3",
  "opencode-go/qwen3.6-plus",
  "opencode-go/kimi-k2.6",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/qwen3.7-max",
  "opencode-go/glm-5.1",
  "opencode-go/glm-5.2"
];

export async function GET() {
  const configuredModels = (process.env.OPENCODE_MODEL_OPTIONS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  const models = configuredModels.length > 0 ? configuredModels : defaultGoModels;

  return NextResponse.json({ models });
}
