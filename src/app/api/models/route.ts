import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const goModelsEndpoint = "https://opencode.ai/zen/go/v1/models";
const dynamicCacheMs = 5 * 60 * 1000;
const fallbackCacheMs = 60 * 1000;
type DiscoveryResult = { models: string[]; source: "api" | "opencode" | "fallback" };
let cachedResult: DiscoveryResult = { models: [], source: "fallback" };
let cacheExpiresAt = 0;
let pendingDiscovery: Promise<DiscoveryResult> | null = null;

const defaultOpenAiOauthModels = [
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.3-codex-spark",
  "openai/gpt-5.5"
];

const defaultGoModels = [
  "opencode-go/grok-4.5",
  "opencode-go/kimi-k3",
  "opencode-go/hy3",
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
  "opencode-go/glm-5.2",
  "opencode-go/minimax-m2.5",
  "opencode-go/kimi-k2.5",
  "opencode-go/glm-5",
  "opencode-go/qwen3.5-plus",
  "opencode-go/mimo-v2-pro",
  "opencode-go/mimo-v2-omni",
  "opencode-go/hy3-preview"
];

function selectedProvider() {
  const provider = (process.env.OPENCODE_PROVIDER || process.env.OPENCODE_MODEL?.split("/")[0] || "openai").trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(provider) ? provider : "openai";
}

function isChatGptOauthModel(model: string) {
  const id = model.slice("openai/".length);
  if (["gpt-5.4", "gpt-5.4-fast", "gpt-5.4-mini", "gpt-5.4-mini-fast", "gpt-5.3-codex-spark", "gpt-5.5"].includes(id)) return true;
  if (["gpt-5.5-pro", "gpt-5.6"].includes(id)) return false;

  const version = id.match(/^gpt-(\d+\.\d+)(?:-|$)/)?.[1];
  return version ? Number(version) > 5.4 : false;
}

function filterProviderModels(models: string[], provider: string) {
  return provider === "openai" ? models.filter(isChatGptOauthModel) : models;
}

function configuredModels() {
  return (process.env.OPENCODE_MODEL_OPTIONS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function modelResponse(models: string[], source: "api" | "opencode" | "configured" | "fallback", provider: string) {
  return NextResponse.json({ models, source, provider }, { headers: { "Cache-Control": "no-store" } });
}

function parseProviderModels(output: string, provider: string) {
  const prefix = `${provider}/`;
  const models = output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix) && !/\s/.test(line));

  return filterProviderModels(Array.from(new Set(models)), provider);
}

async function fetchGoModels() {
  try {
    const response = await fetch(goModelsEndpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) return [];

    return Array.from(
      new Set(
        payload.data
          .map((item) => (item && typeof item === "object" && "id" in item ? (item as { id?: unknown }).id : undefined))
          .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9._-]+$/.test(id))
          .map((id) => `opencode-go/${id}`)
      )
    );
  } catch {
    return [];
  }
}

async function discoverProviderModels(provider: string): Promise<DiscoveryResult> {
  if (provider === "opencode-go") {
    const apiModels = await fetchGoModels();
    if (apiModels.length > 0) return { models: apiModels, source: "api" };
  }

  const opencodeBin = process.env.OPENCODE_BIN || "opencode";
  const attempts = [
    ["models", provider, "--refresh"],
    ["models", provider]
  ];

  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync(opencodeBin, args, {
        encoding: "utf8",
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const models = parseProviderModels(String(stdout), provider);
      if (models.length > 0) return { models, source: "opencode" };
    } catch {
      // Try the cached provider list before using the built-in fallback.
    }
  }

  return { models: [], source: "fallback" };
}

async function detectedModels(provider: string) {
  if (Date.now() < cacheExpiresAt) return cachedResult;
  if (pendingDiscovery) return pendingDiscovery;

  pendingDiscovery = discoverProviderModels(provider)
    .then((result) => {
      cachedResult = result;
      cacheExpiresAt = Date.now() + (result.models.length > 0 ? dynamicCacheMs : fallbackCacheMs);
      return result;
    })
    .finally(() => {
      pendingDiscovery = null;
    });

  return pendingDiscovery;
}

export async function GET() {
  const provider = selectedProvider();
  const configured = configuredModels();
  if (configured.length > 0) {
    return modelResponse(configured, "configured", provider);
  }

  const detected = await detectedModels(provider);
  const fallbackModels = provider === "opencode-go" ? defaultGoModels : provider === "openai" ? defaultOpenAiOauthModels : [];
  const defaultModel = process.env.OPENCODE_MODEL;
  const configuredDefault = defaultModel?.startsWith(`${provider}/`) ? [defaultModel] : [];
  const models = detected.models.length > 0 ? detected.models : fallbackModels.length > 0 ? fallbackModels : configuredDefault;

  return modelResponse(models, detected.models.length > 0 ? detected.source : "fallback", provider);
}
