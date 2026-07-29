import { NextResponse } from "next/server";
import { getAuthConfigurationError } from "@/lib/auth-config";
import { verifyPassword } from "@/lib/password";
import { isSameOrigin, isSecureRequest } from "@/lib/request-security";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/session";

export const runtime = "nodejs";

type Attempt = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, Attempt>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const maxGlobalAttempts = 30;
const maxTrackedIps = 1000;
const maxConcurrentVerifications = 4;
const maxLoginBodyBytes = 4096;
let globalAttempts: Attempt = { count: 0, resetAt: 0 };
let activeVerifications = 0;

function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function reserveAttempt(ip: string, now: number) {
  attempts.forEach((attempt, trackedIp) => {
    if (attempt.resetAt <= now) attempts.delete(trackedIp);
  });

  const current = attempts.get(ip);
  if (current && current.count >= maxAttempts) return false;

  if (globalAttempts.resetAt <= now) globalAttempts = { count: 0, resetAt: now + attemptWindowMs };
  if (globalAttempts.count >= maxGlobalAttempts) return false;

  if (!current && attempts.size >= maxTrackedIps) {
    const oldestIp = attempts.keys().next().value as string | undefined;
    if (oldestIp) attempts.delete(oldestIp);
  }

  attempts.set(ip, current ? { ...current, count: current.count + 1 } : { count: 1, resetAt: now + attemptWindowMs });
  globalAttempts.count += 1;
  return true;
}

async function readLoginBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > maxLoginBodyBytes) throw new RangeError("Login body is too large.");
  if (!request.body) throw new SyntaxError("Login body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxLoginBodyBytes) {
      await reader.cancel();
      throw new RangeError("Login body is too large.");
    }
    chunks.push(value);
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("Invalid login body.");
  return parsed as { username?: string; password?: string };
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  if (getAuthConfigurationError()) {
    return NextResponse.json({ error: "Login is not configured on the server." }, { status: 503 });
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminUsername || !adminPassword) return NextResponse.json({ error: "Login is not configured on the server." }, { status: 503 });

  let body: { username?: string; password?: string };
  try {
    body = await readLoginBody(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? "Login body is too large." : "Invalid JSON body." }, { status: error instanceof RangeError ? 413 : 400 });
  }

  if ((body.username !== undefined && typeof body.username !== "string") || (body.password !== undefined && typeof body.password !== "string")) {
    return NextResponse.json({ error: "Invalid login input." }, { status: 400 });
  }

  const username = body.username?.trim() || "";
  const password = body.password || "";
  if (username.length > 256 || password.length > 1024) {
    return NextResponse.json({ error: "Invalid login input." }, { status: 400 });
  }

  const ip = requestIp(request);
  const now = Date.now();
  if (activeVerifications >= maxConcurrentVerifications || !reserveAttempt(ip, now)) {
    return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
  }

  activeVerifications += 1;
  try {
    const valid = username === adminUsername && (await verifyPassword(password, adminPassword));

    if (!valid) {
      return NextResponse.json({ error: "帳號或密碼錯誤。" }, { status: 401 });
    }

    attempts.delete(ip);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookieName, await createSessionToken(username), {
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAgeSeconds
    });

    return response;
  } finally {
    activeVerifications -= 1;
  }
}
