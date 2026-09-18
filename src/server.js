import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { OmaClient } from "./oma-client.js";
import { JobStore } from "./job-store.js";
import { JobRunner } from "./job-runner.js";
import { AnalyticsStore } from "./analytics-store.js";
import { renderReport } from "./report-renderer.js";
import { renderPage } from "./page.js";
import { renderAdminPage } from "./admin-page.js";
import { ensureReportsForDigest } from "./report-scheduler.js";

const config = loadConfig();
const store = new JobStore(config.jobDataFile);
await store.init();
const analytics = new AnalyticsStore(config.analyticsDataDirectory);
await analytics.init();
const oma = new OmaClient({ baseUrl: config.omaBaseUrl, apiKey: config.omaApiKey });
let runner;

runner = new JobRunner({
  store,
  oma,
  agentId: config.omaAgentId,
  pollIntervalMs: config.pollIntervalMs,
  reportTimeoutMs: config.reportTimeoutMs,
  onJobSucceeded: (digest) => ensureReportsForDigest({ digest, store, runner }),
});
await runner.recover();
for (const digest of store.list()) await ensureReportsForDigest({ digest, store, runner });

const app = new Hono({ strict: false }).basePath(config.basePath || "/");
const ipWindows = new Map();
const USER_COOKIE = "rsi_user_id";

function userId(c) {
  const cached = c.get("userId");
  if (cached) return cached;
  const cookieValue = getCookie(c, USER_COOKIE);
  const id = typeof cookieValue === "string" && /^[0-9a-f-]{36}$/i.test(cookieValue)
    ? cookieValue
    : randomUUID();
  c.set("userId", id);
  if (id !== cookieValue) {
    setCookie(c, USER_COOKIE, id, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.publicBaseUrl.startsWith("https://"),
      path: config.basePath || "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return id;
}

function clientIp(c) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "local";
}

function rateLimited(ip) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = (ipWindows.get(ip) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= config.requestsPerIpPerHour) {
    ipWindows.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipWindows.set(ip, recent);
  return false;
}

function activeJobCount() {
  return store.list().filter((job) => ["queued", "running"].includes(job.status)).length;
}

function reportProjection(job) {
  return {
    jobId: job.id,
    kind: job.kind ?? "report",
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    parentJobId: job.parentJobId ?? null,
    arxivId: job.arxivId ?? job.result?.arxiv_id ?? null,
    reportUrl: `${config.basePath}/reports/${job.id}`,
    ...(job.status === "succeeded" && job.reportMarkdown
      ? { reportHtml: renderReport(job.reportMarkdown) }
      : {}),
  };
}

function digestProjection(job, currentUserId = null) {
  const reportJobs = store.list().filter((candidate) => (candidate.kind ?? "report") === "report" && candidate.parentJobId === job.id);
  const papers = Array.isArray(job.result?.papers)
    ? job.result.papers.map((paper, position) => {
        const reportJob = reportJobs.find((candidate) => candidate.arxivId === paper.arxiv_id) ?? null;
        return {
          ...paper,
          position,
          feedback: analytics.feedbackSummary(job.id, paper.arxiv_id, currentUserId),
          reportJob: reportJob ? {
            jobId: reportJob.id,
            status: reportJob.status,
            reportUrl: `${config.basePath}/reports/${reportJob.id}`,
            error: reportJob.error,
          } : null,
        };
      })
    : [];
  return {
    jobId: job.id,
    kind: "digest",
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.error,
    digestUrl: `${config.basePath}/digests/${job.id}`,
    digest: job.result ? { ...job.result, papers } : null,
  };
}

async function readJson(c) {
  return c.req.json().catch(() => ({}));
}

app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/", (c) => {
  userId(c);
  return c.html(renderPage(null, config.basePath));
});
app.get("/digests/:id", (c) => {
  userId(c);
  const job = store.get(c.req.param("id"));
  if (!job || job.kind !== "digest") return c.html(renderPage(null, config.basePath), 404);
  return c.html(renderPage({ type: "digest", id: job.id }, config.basePath));
});
app.get("/reports/:id", (c) => {
  userId(c);
  const job = store.get(c.req.param("id"));
  if (!job || (job.kind ?? "report") !== "report") return c.html(renderPage(null, config.basePath), 404);
  return c.html(renderPage({ type: "report", id: job.id }, config.basePath));
});

app.post("/api/digests", async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: "请求过于频繁，请稍后再试。" }, 429);
  if (activeJobCount() >= config.maxQueuedJobs) return c.json({ error: "当前任务较多，请稍后再试。" }, 503);
  const currentUserId = userId(c);
  const job = await runner.enqueue({ kind: "digest", referenceTime: new Date().toISOString() });
  await analytics.track({ type: "digest_requested", userId: currentUserId, digestId: job.id });
  return c.json({
    jobId: job.id,
    status: job.status,
    statusUrl: `${config.basePath}/api/digests/${job.id}`,
    digestUrl: `${config.basePath}/digests/${job.id}`,
  }, 202);
});

app.get("/api/digests/:id", (c) => {
  const job = store.get(c.req.param("id"));
  if (!job || job.kind !== "digest") return c.json({ error: "推荐任务不存在。" }, 404);
  return c.json(digestProjection(job, userId(c)));
});

app.post("/api/digests/:id/papers/:arxivId/report", async (c) => {
  const digest = store.get(c.req.param("id"));
  if (!digest || digest.kind !== "digest" || digest.status !== "succeeded") {
    return c.json({ error: "推荐列表尚未完成或不存在。" }, 404);
  }
  const arxivId = c.req.param("arxivId");
  const paper = digest.result?.papers?.find((candidate) => candidate.arxiv_id === arxivId);
  if (!paper) return c.json({ error: "该论文不在本次推荐列表中。" }, 404);
  const existing = store.list().find((candidate) =>
    (candidate.kind ?? "report") === "report"
    && candidate.parentJobId === digest.id
    && candidate.arxivId === arxivId
  );
  if (existing) return c.json(reportProjection(existing), existing.status === "succeeded" ? 200 : 202);
  if (activeJobCount() >= config.maxQueuedJobs) return c.json({ error: "当前任务较多，请稍后再试。" }, 503);
  const job = await runner.enqueue({
    kind: "report",
    parentJobId: digest.id,
    arxivId,
    referenceTime: digest.referenceTime,
  });
  return c.json(reportProjection(job), 202);
});

// Compatibility endpoint retained for already-created report URLs and direct tests.
app.post("/api/reports", async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: "请求过于频繁，请稍后再试。" }, 429);
  if (activeJobCount() >= config.maxQueuedJobs) return c.json({ error: "当前任务较多，请稍后再试。" }, 503);
  const body = await readJson(c);
  const job = await runner.enqueue({
    kind: "report",
    arxivId: typeof body.arxivId === "string" ? body.arxivId : null,
    referenceTime: new Date().toISOString(),
  });
  return c.json({ ...reportProjection(job), statusUrl: `${config.basePath}/api/reports/${job.id}` }, 202);
});

app.get("/api/reports/:id", (c) => {
  userId(c);
  const job = store.get(c.req.param("id"));
  if (!job || (job.kind ?? "report") !== "report") return c.json({ error: "任务不存在。" }, 404);
  return c.json(reportProjection(job));
});

app.post("/api/analytics/events", async (c) => {
  try {
    await analytics.track({ ...(await readJson(c)), userId: userId(c) });
    return c.body(null, 204);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid event" }, 400);
  }
});

app.post("/api/feedback", async (c) => {
  try {
    return c.json(await analytics.vote({ ...(await readJson(c)), userId: userId(c) }));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid feedback" }, 400);
  }
});

app.get("/api/me", (c) => c.json({ userId: userId(c), identityType: "anonymous_cookie" }));

if (config.adminUsername && config.adminPassword) {
  const protectAdmin = basicAuth({ username: config.adminUsername, password: config.adminPassword });
  app.use("/api/admin/*", protectAdmin);
  app.get("/admin", (c) => c.html(renderAdminPage(config.basePath)));
  app.get("/api/admin/metrics", (c) => c.json(analytics.metrics()));
} else {
  app.get("/admin", (c) => c.json({ error: "Admin dashboard is not configured." }, 503));
  app.get("/api/admin/metrics", (c) => c.json({ error: "Admin dashboard is not configured." }, 503));
}

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: "服务暂时不可用。" }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`RSI Weekly Recommendation listening on ${config.publicBaseUrl} (port ${info.port})`);
});
