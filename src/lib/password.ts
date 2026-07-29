import { createHash, timingSafeEqual } from "crypto";

export async function verifyPassword(password: string, expectedPassword: string) {
  const actual = createHash("sha256").update(password).digest();
  const expected = createHash("sha256").update(expectedPassword).digest();

  return timingSafeEqual(actual, expected);
}
