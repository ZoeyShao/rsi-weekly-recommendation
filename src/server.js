import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { getConnInfo } from "@hono/node-server/conninfo";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { OmaClient } from "./oma-client.js";
import { JobStore } from "./job-store.js";
import { JobRunner } from "./job-runner.js";
import { AnalyticsStore } from "./analytics-store.js";
import { renderReport } from "./report-renderer.js";
import { renderPage } from "./page.js";
import { renderAdminPage } from "./admin-page.js";
import { ensureReportsForDigest } from "./report-scheduler.js";
import { createIdentity } from "./identity.js";
import { ChatStore } from "./chat-store.js";
import { ChatService } from "./chat-service.js";

const config = loadConfig();
const store = new JobStore(config.jobDataFile);
await store.init();
const analytics = new AnalyticsStore(config.analyticsDataDirectory);
await analytics.init();
const oma = new OmaClient({ baseUrl: config.omaBaseUrl, apiKey: config.omaApiKey });
const chatStore = new ChatStore(config.chatDataFile);
await chatStore.init();
const userId = await createIdentity({ dataDirectory: dirname(config.chatDataFile), basePath: config.basePath,
  secure: config.publicBaseUrl.startsWith("https://") });
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
const chats = new ChatService({ store: chatStore, oma, agentId: config.omaAgentId, runner, jobs: store });
// Complete and persist replies even when the browser tab has been closed.
let syncingChats = false;
setInterval(async () => {
  if (syncingChats) return;
  syncingChats = true;
  try { await Promise.allSettled(chatStore.pending().map(chat => chats.sync(chat.id, chat.ownerId))); }
  finally { syncingChats = false; }
}, 5000).unref();

const app = new Hono({ strict: false }).basePath(config.basePath || "/");
const ipWindows = new Map();
app.use("/*", bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: "请求内容过长。" }, 413) }));
app.use("/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function clientIp(c) {
  const remote = getConnInfo(c).remote.address ?? "local";
  // Only a local reverse proxy may supply the client address.
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)
    ? c.req.header("x-real-ip") || remote : remote;
}

function rateLimited(ip, limit = config.requestsPerIpPerHour) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = (ipWindows.get(ip) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= limit) {
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

function canReadJob(job, c) { return job && (!job.ownerId || job.ownerId === userId(c)); }

function reportProjection(job) {
  return {
    jobId: job.id,
    kind: job.kind ?? "report",
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    chatId: job.chatId ?? null,
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
    chatId: job.chatId ?? null,
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
  if (!canReadJob(job, c) || job.kind !== "digest") return c.text("推荐任务不存在。", 404);
  return c.html(renderPage({ type: "digest", id: job.id }, config.basePath));
});
app.get("/reports/:id", (c) => {
  userId(c);
  const job = store.get(c.req.param("id"));
  if (!canReadJob(job, c) || (job.kind ?? "report") !== "report") return c.text("报告不存在。", 404);
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
  if (!canReadJob(job, c) || job.kind !== "digest") return c.json({ error: "推荐任务不存在。" }, 404);
  return c.json(digestProjection(job, userId(c)));
});

app.post("/api/digests/:id/papers/:arxivId/report", async (c) => {
  const digest = store.get(c.req.param("id"));
  if (!canReadJob(digest, c) || digest.kind !== "digest" || digest.status !== "succeeded") {
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
    ownerId: digest.ownerId ?? null,
    chatId: digest.chatId ?? null,
    preferences: digest.preferences ?? null,
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
  if (!canReadJob(job, c) || (job.kind ?? "report") !== "report") return c.json({ error: "任务不存在。" }, 404);
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

app.get("/chats/:id", (c) => {
  const chat = chats.owned(c.req.param("id"), userId(c));
  return c.html(renderPage({ type: "chat", id: chat.id }, config.basePath));
});
app.get("/api/chats", (c) => c.json({ chats: chatStore.list(userId(c)).map(chat => ({
  id: chat.id, title: chat.title, updatedAt: chat.updatedAt, status: chat.status,
})) }));
app.post("/api/chats", async (c) => {
  const owner = userId(c);
  if (rateLimited(`chat-create:${clientIp(c)}`, 10)) return c.json({ error: "创建对话过于频繁，请稍后再试。" }, 429);
  const chat = await chatStore.create(owner);
  await analytics.track({ type: "chat_started", userId: owner, chatId: chat.id });
  return c.json(chats.project(chat), 201);
});
app.get("/api/chats/:id", async (c) => {
  const chat = await chats.sync(c.req.param("id"), userId(c));
  return c.json(chats.project(chat));
});
app.post("/api/chats/:id/messages", async (c) => {
  const owner = userId(c), id = c.req.param("id");
  const current = chats.owned(id, owner);
  const body = await readJson(c);
  const duplicate = current.messages.some(m => m.id === body.requestId);
  if (!duplicate && rateLimited(`chat-message:${clientIp(c)}`, config.chatRequestsPerHour)) return c.json({ error: "对话消息过于频繁，请稍后再试。" }, 429);
  const chat = await chats.send(id, owner, body);
  if (!duplicate) await analytics.track({ type: "chat_message_sent", userId: owner, chatId: id });
  return c.json(chats.project(chat), 202);
});
app.post("/api/chats/:id/recommendations", async (c) => {
  const owner = userId(c), id = c.req.param("id");
  chats.owned(id, owner);
  const body = await readJson(c);
  const duplicate = store.list().some(j => j.chatId === id && j.recommendationRequestId === body.requestId);
  if (!duplicate && rateLimited(clientIp(c))) return c.json({ error: "生成推荐过于频繁，请稍后再试。" }, 429);
  if (!duplicate && activeJobCount() >= config.maxQueuedJobs) return c.json({ error: "当前推荐任务较多，请稍后再试。" }, 503);
  const job = await chats.recommend(id, owner, body.requestId);
  if (!duplicate) {
    await analytics.track({ type: "chat_recommendation_requested", userId: owner, chatId: id, digestId: job.id });
    await analytics.track({ type: "digest_requested", userId: owner, chatId: id, digestId: job.id });
  }
  return c.json({ jobId: job.id, digestUrl: `${config.basePath}/digests/${job.id}` }, 202);
});

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
  if (error instanceof HTTPException) return error.res ? error.getResponse() : c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: "服务暂时不可用。" }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`RSI Weekly Recommendation listening on ${config.publicBaseUrl} (port ${info.port})`);
});
