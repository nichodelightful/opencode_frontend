import { scrypt, timingSafeEqual } from "crypto";

function deriveKey(password: string, salt: Buffer, length: number, cost: number, blockSize: number, parallelization: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      length,
      { N: cost, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export async function verifyPassword(password: string, storedHash: string) {
  try {
    const [algorithm, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue] = storedHash.split("$");
    if (algorithm !== "scrypt" || !costValue || !blockSizeValue || !parallelizationValue || !saltValue || !hashValue) {
      return false;
    }

    const cost = Number(costValue);
    const blockSize = Number(blockSizeValue);
    const parallelization = Number(parallelizationValue);
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (cost !== 16384 || blockSize !== 8 || parallelization !== 1 || salt.length !== 16 || expected.length !== 64) return false;

    const actual = await deriveKey(password, salt, expected.length, cost, blockSize, parallelization);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
