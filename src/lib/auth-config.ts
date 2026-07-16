const passwordHashPattern = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;

export function getAuthConfigurationError() {
  const username = process.env.ADMIN_USERNAME;
  if (!username || username !== username.trim() || username.length > 256) return "ADMIN_USERNAME is invalid.";
  if (!process.env.ADMIN_PASSWORD_HASH || !passwordHashPattern.test(process.env.ADMIN_PASSWORD_HASH)) {
    return "ADMIN_PASSWORD_HASH is invalid.";
  }
  if (!process.env.APP_SECRET || process.env.APP_SECRET === "change-me" || process.env.APP_SECRET.length < 32) {
    return "APP_SECRET must contain at least 32 characters.";
  }

  return null;
}
