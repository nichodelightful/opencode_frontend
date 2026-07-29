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

function configuredModels() {
  return (process.env.OPENCODE_MODEL_OPTIONS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function modelResponse(models: string[], source: "api" | "opencode" | "configured" | "fallback") {
  return NextResponse.json({ models, source }, { headers: { "Cache-Control": "no-store" } });
}

function parseGoModels(output: string) {
  const models = output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^opencode-go\/\S+$/.test(line));

  return Array.from(new Set(models));
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

async function discoverGoModels(): Promise<DiscoveryResult> {
  const apiModels = await fetchGoModels();
  if (apiModels.length > 0) return { models: apiModels, source: "api" };

  const opencodeBin = process.env.OPENCODE_BIN || "opencode";
  const attempts = [
    ["models", "opencode-go", "--refresh"],
    ["models", "opencode-go"],
    ["models", "--refresh"],
    ["models"]
  ];

  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync(opencodeBin, args, {
        encoding: "utf8",
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const models = parseGoModels(String(stdout));
      if (models.length > 0) return { models, source: "opencode" };
    } catch {
      // Try the cache and the unfiltered provider list before using the fallback.
    }
  }

  return { models: [], source: "fallback" };
}

async function detectedModels() {
  if (Date.now() < cacheExpiresAt) return cachedResult;
  if (pendingDiscovery) return pendingDiscovery;

  pendingDiscovery = discoverGoModels()
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
  const configured = configuredModels();
  if (configured.length > 0) {
    return modelResponse(configured, "configured");
  }

  const detected = await detectedModels();
  const models = detected.models.length > 0 ? detected.models : defaultGoModels;

  return modelResponse(models, detected.source);
}
