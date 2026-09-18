const TERMINAL_AGENT_RESULTS = new Set([
  "irrelevant",
  "out_of_window",
  "no_candidate",
  "no_full_text",
  "error",
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeWorkspaceName(job) {
  return `rsi-${job.kind === "digest" ? "digest" : "report"}-${job.id.slice(0, 8)}`;
}

function parseResult(raw) {
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || typeof result.status !== "string") {
      throw new Error("missing status");
    }
    return result;
  } catch (error) {
    throw new Error(`Agent produced invalid result.json: ${error.message}`);
  }
}

export class JobRunner {
  constructor({ store, oma, agentId, pollIntervalMs, reportTimeoutMs, onJobSucceeded = async () => {} }) {
    this.store = store;
    this.oma = oma;
    this.agentId = agentId;
    this.pollIntervalMs = pollIntervalMs;
    this.reportTimeoutMs = reportTimeoutMs;
    this.onJobSucceeded = onJobSucceeded;
    this.running = false;
    this.drainPromise = Promise.resolve();
  }

  async recover() {
    for (const job of this.store.list()) {
      if (job.status === "running") {
        await this.store.update(job.id, { status: "queued", error: null });
      }
    }
    this.kick();
  }

  async enqueue({
    referenceTime = new Date().toISOString(),
    kind = "digest",
    parentJobId = null,
    arxivId = null,
  } = {}) {
    const job = await this.store.create({ referenceTime, kind, parentJobId, arxivId });
    this.kick();
    return job;
  }

  kick() {
    if (this.running) return;
    this.running = true;
    this.drainPromise = this.drain().finally(() => { this.running = false; });
  }

  async waitForIdle() {
    await this.drainPromise;
  }

  async drain() {
    while (true) {
      const job = this.store.list().find((candidate) => candidate.status === "queued");
      if (!job) return;
      try {
        await this.process(job);
      } catch (error) {
        await this.store.update(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async process(initialJob) {
    let job = await this.store.update(initialJob.id, { status: "running", error: null });

    if (!job.sessionId || !job.workspaceId) {
      const session = await this.oma.createSession(this.agentId, safeWorkspaceName(job));
      if (!session?.id || !session?.workspaceId) {
        throw new Error("OMA createSession response did not contain id and workspaceId");
      }
      job = await this.store.update(job.id, {
        sessionId: session.id,
        workspaceId: session.workspaceId,
      });
    }

    if (!job.submittedAt) {
      const command = job.kind === "digest"
        ? [
            "/skill:rsi-paper-report",
            "mode=digest",
            `reference_time=${job.referenceTime}`,
            `request_id=${job.id}`,
            "生成过去七天内的 RSI 论文推荐列表。",
          ].join(" ")
        : [
            "/skill:rsi-paper-report",
            "mode=report",
            ...(job.arxivId ? [`arxiv_id=${job.arxivId}`] : []),
            `reference_time=${job.referenceTime}`,
            `request_id=${job.id}`,
            job.arxivId
              ? "阅读全文并生成完整中文解读。"
              : "自动查找并分析过去七天内的一篇 RSI 相关论文。",
          ].join(" ");
      await this.oma.submitMessage(job.sessionId, command);
      job = await this.store.update(job.id, { submittedAt: new Date().toISOString() });
    }

    const deadline = Date.now() + this.reportTimeoutMs;
    while (Date.now() < deadline) {
      const markerPath = job.kind === "digest" ? "digest.json" : "result.json";
      const rawResult = await this.oma.getWorkspaceText(job.workspaceId, markerPath);
      if (rawResult !== null) {
        const result = parseResult(rawResult);
        if (result.status === "success") {
          if (job.kind === "digest") {
            if (!Array.isArray(result.papers) || result.papers.length === 0) {
              throw new Error("Agent completed without any recommendations");
            }
            const completed = await this.store.update(job.id, {
              status: "succeeded",
              completedAt: new Date().toISOString(),
              result,
            });
            try { await this.onJobSucceeded(completed); } catch (error) { console.error("Post-success scheduling failed:", error); }
            return;
          }
          const reportPath = typeof result.report_path === "string" ? result.report_path : "report.md";
          const reportMarkdown = await this.oma.getWorkspaceText(job.workspaceId, reportPath);
          if (!reportMarkdown) throw new Error(`Agent completed without ${reportPath}`);
          const completed = await this.store.update(job.id, {
            status: "succeeded",
            completedAt: new Date().toISOString(),
            result,
            reportMarkdown,
          });
          try { await this.onJobSucceeded(completed); } catch (error) { console.error("Post-success scheduling failed:", error); }
          return;
        }
        if (TERMINAL_AGENT_RESULTS.has(result.status)) {
          throw new Error(result.error || `Agent ended with status: ${result.status}`);
        }
        throw new Error(`Unknown Agent result status: ${result.status}`);
      }
      await delay(this.pollIntervalMs);
    }

    await this.oma.terminateSession(job.sessionId);
    throw new Error("Report generation timed out");
  }
}
