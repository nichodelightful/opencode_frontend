export function getAuthConfigurationError() {
  const username = process.env.ADMIN_USERNAME;
  if (!username || username !== username.trim() || username.length > 256) return "ADMIN_USERNAME is invalid.";
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.length > 1024) return "ADMIN_PASSWORD must contain 12 to 1024 characters.";
  if (!process.env.APP_SECRET || process.env.APP_SECRET === "change-me" || process.env.APP_SECRET.length < 32) {
    return "APP_SECRET must contain at least 32 characters.";
  }

  return null;
}
