import { randomBytes, scrypt } from "node:crypto";

const password = process.env.ADMIN_PASSWORD;

if (!password) {
  console.error("Set ADMIN_PASSWORD temporarily before running this command.");
  process.exit(1);
}

if (password.length < 12) {
  console.error("ADMIN_PASSWORD must contain at least 12 characters.");
  process.exit(1);
}

const cost = 16384;
const blockSize = 8;
const parallelization = 1;
const salt = randomBytes(16);
const hash = await new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: cost, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
    if (error) reject(error);
    else resolve(derivedKey);
  });
});

console.log(`scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString("base64url")}$${hash.toString("base64url")}`);
