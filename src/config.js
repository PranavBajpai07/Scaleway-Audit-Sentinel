import fs from "node:fs";
import path from "node:path";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...rest] = trimmed.split("=");
    if (process.env[key] !== undefined) continue;

    const rawValue = rest.join("=").trim();
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

parseEnvFile(path.resolve(process.cwd(), ".env"));

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function loadConfig() {
  const mode = (process.env.SCW_MODE || "demo").toLowerCase();
  const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "./data");
  const logDir = path.resolve(process.cwd(), process.env.LOG_DIR || "./logs");

  return {
    mode,
    port: numberFromEnv("PORT", 3000),
    dataDir,
    logDir,
    stateFile: path.join(dataDir, "state.json"),
    scaleway: {
      baseUrl: process.env.SCW_BASE_URL || "https://api.scaleway.com",
      secretKey: process.env.SCW_SECRET_KEY || "",
      organizationId: process.env.SCW_ORGANIZATION_ID || "",
      projectId: process.env.SCW_PROJECT_ID || "",
      region: process.env.SCW_REGION || "fr-par",
      lookbackMinutes: numberFromEnv("SCW_LOOKBACK_MINUTES", 60),
      pageSize: numberFromEnv("SCW_PAGE_SIZE", 100)
    },
    scheduler: {
      pollIntervalSeconds: numberFromEnv("SCW_POLL_INTERVAL_SECONDS", 60)
    },
    detection: {
      failedLoginThreshold: numberFromEnv("FAILED_LOGIN_THRESHOLD", 3),
      failedLoginWindowMinutes: numberFromEnv("FAILED_LOGIN_WINDOW_MINUTES", 15),
      allowedCountryCodes: listFromEnv("ALLOWED_COUNTRY_CODES", ["FR", "IN", "SE"])
    }
  };
}

export function assertLiveConfig(config) {
  const missing = [];
  if (!config.scaleway.secretKey) missing.push("SCW_SECRET_KEY");
  if (!config.scaleway.organizationId) missing.push("SCW_ORGANIZATION_ID");

  if (config.mode === "live" && missing.length) {
    throw new Error(`Missing required live Scaleway configuration: ${missing.join(", ")}`);
  }
}
