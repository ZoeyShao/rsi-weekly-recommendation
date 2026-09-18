import { resolve, dirname } from "node:path";

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function loadConfig({ requireOma = true } = {}) {
  const omaBaseUrl = trimTrailingSlash(process.env.OMA_BASE_URL?.trim() ?? "");
  const omaApiKey = process.env.OMA_API_KEY?.trim() ?? "";
  const omaAgentId = process.env.OMA_AGENT_ID?.trim() ?? "";
  const publicBaseUrl = trimTrailingSlash(process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:8787");
  const basePath = new URL(publicBaseUrl).pathname.replace(/\/+$/, "");
  const jobDataFile = resolve(process.env.JOB_DATA_FILE?.trim() || "./data/jobs.json");
  if (basePath && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(basePath)) {
    throw new Error("PUBLIC_BASE_URL must use a simple URL path");
  }

  if (requireOma) {
    const missing = [
      ["OMA_BASE_URL", omaBaseUrl],
      ["OMA_API_KEY", omaApiKey],
      ["OMA_AGENT_ID", omaAgentId],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
  }

  return {
    omaBaseUrl,
    omaApiKey,
    omaAgentId,
    port: positiveInteger("PORT", 8787),
    publicBaseUrl,
    basePath,
    maxQueuedJobs: positiveInteger("MAX_QUEUED_JOBS", 20),
    reportTimeoutMs: positiveInteger("REPORT_TIMEOUT_MS", 15 * 60 * 1000),
    pollIntervalMs: positiveInteger("POLL_INTERVAL_MS", 3000),
    requestsPerIpPerHour: positiveInteger("REQUESTS_PER_IP_PER_HOUR", 5),
    jobDataFile,
    chatDataFile: resolve(process.env.CHAT_DATA_FILE?.trim() || `${dirname(jobDataFile)}/chats.json`),
    chatRequestsPerHour: positiveInteger("CHAT_REQUESTS_PER_HOUR", 30),
    analyticsDataDirectory: resolve(process.env.ANALYTICS_DATA_DIRECTORY?.trim() || "./data"),
    adminUsername: process.env.ADMIN_USERNAME?.trim() ?? "",
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
  };
}
