import { NextResponse } from "next/server";

export const runtime = "nodejs";

const defaultZenModels = [
  "opencode/big-pickle",
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/north-mini-code-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/gpt-5.6-sol",
  "opencode/gpt-5.6-terra",
  "opencode/gpt-5.6-luna",
  "opencode/gpt-5.5",
  "opencode/gpt-5.5-pro",
  "opencode/gpt-5.4",
  "opencode/gpt-5.4-pro",
  "opencode/gpt-5.4-mini",
  "opencode/gpt-5.4-nano",
  "opencode/gpt-5.3-codex",
  "opencode/gpt-5.3-codex-spark",
  "opencode/gpt-5.2",
  "opencode/gpt-5.2-codex",
  "opencode/gpt-5.1",
  "opencode/gpt-5.1-codex",
  "opencode/gpt-5.1-codex-max",
  "opencode/gpt-5.1-codex-mini",
  "opencode/gpt-5",
  "opencode/gpt-5-codex",
  "opencode/gpt-5-nano",
  "opencode/claude-fable-5",
  "opencode/claude-opus-4-8",
  "opencode/claude-opus-4-7",
  "opencode/claude-opus-4-6",
  "opencode/claude-opus-4-5",
  "opencode/claude-sonnet-5",
  "opencode/claude-sonnet-4-6",
  "opencode/claude-sonnet-4-5",
  "opencode/claude-haiku-4-5",
  "opencode/gemini-3.5-flash",
  "opencode/gemini-3.1-pro",
  "opencode/gemini-3-flash",
  "opencode/qwen3.7-max",
  "opencode/qwen3.7-plus",
  "opencode/qwen3.6-plus",
  "opencode/qwen3.5-plus",
  "opencode/deepseek-v4-pro",
  "opencode/deepseek-v4-flash",
  "opencode/minimax-m3",
  "opencode/minimax-m2.7",
  "opencode/minimax-m2.5",
  "opencode/glm-5.2",
  "opencode/glm-5.1",
  "opencode/glm-5",
  "opencode/kimi-k2.5",
  "opencode/kimi-k2.6",
  "opencode/kimi-k2.7-code",
  "opencode/grok-4.5",
  "opencode/grok-build-0.1"
];

export async function GET() {
  const configuredModels = (process.env.OPENCODE_MODEL_OPTIONS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  const models = configuredModels.length > 0 ? configuredModels : defaultZenModels;

  return NextResponse.json({ models });
}
