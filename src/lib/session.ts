export const sessionCookieName = "ai_chatbox_session";
export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

export type SessionPayload = {
  sub: string;
  ver: string;
  iat: number;
  exp: number;
};

function getSessionSecret() {
  const secret = process.env.APP_SECRET;

  if (!secret || secret === "change-me" || secret.length < 32) {
    throw new Error("APP_SECRET must be a random string of at least 32 characters.");
  }

  return secret;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function getCredentialVersion() {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!passwordHash) throw new Error("ADMIN_PASSWORD_HASH is required.");

  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), new TextEncoder().encode(passwordHash));
  return encodeBase64Url(new Uint8Array(signature).slice(0, 16));
}

export async function createSessionToken(username: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: username,
    ver: await getCredentialVersion(),
    iat: now,
    exp: now + sessionMaxAgeSeconds
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), new TextEncoder().encode(encodedPayload));

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return null;

  try {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return null;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(encodedPayload)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);

    if (!payload.sub || !payload.exp || payload.exp <= now || payload.ver !== (await getCredentialVersion())) return null;

    return payload;
  } catch {
    return null;
  }
}
