export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const host = forwardedHost?.split(",")[0]?.trim();
    return Boolean(host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request) {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
}
