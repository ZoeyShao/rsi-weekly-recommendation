import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobStore } from "../src/job-store.js";
import { JobRunner } from "../src/job-runner.js";

test("runs one OMA job through the completion marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsi-job-runner-"));
  const store = new JobStore(join(directory, "jobs.json"));
  await store.init();
  let command = "";
  const oma = {
    async createSession() { return { id: "session_1", workspaceId: "workspace_1" }; },
    async submitMessage(_id, text) { command = text; },
    async getWorkspaceText(_workspaceId, path) {
      if (path === "result.json") return JSON.stringify({ status: "success", title: "A paper", report_path: "report.md" });
      if (path === "report.md") return "# A paper\n\nUseful report.";
      return null;
    },
    async terminateSession() {},
  };
  const runner = new JobRunner({ store, oma, agentId: "agent_1", pollIntervalMs: 1, reportTimeoutMs: 1000 });
  const job = await runner.enqueue({
    kind: "report",
    referenceTime: "2026-09-18T00:00:00.000Z",
  });
  await runner.waitForIdle();

  const completed = store.get(job.id);
  assert.equal(completed.status, "succeeded");
  assert.match(completed.reportMarkdown, /Useful report/);
  assert.match(command, /^\/skill:rsi-paper-report/);
  assert.match(command, /reference_time=2026-09-18T00:00:00.000Z/);
});

test("runs a digest job and persists its recommendation list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsi-digest-runner-"));
  const store = new JobStore(join(directory, "jobs.json"));
  await store.init();
  let command = "";
  const oma = {
    async createSession() { return { id: "session_2", workspaceId: "workspace_2" }; },
    async submitMessage(_id, text) { command = text; },
    async getWorkspaceText(_workspaceId, path) {
      if (path === "digest.json") return JSON.stringify({
        status: "success",
        papers: [{ arxiv_id: "2609.20519v1", title: "A paper" }],
      });
      return null;
    },
    async terminateSession() {},
  };
  const succeeded = [];
  const runner = new JobRunner({
    store,
    oma,
    agentId: "agent_1",
    pollIntervalMs: 1,
    reportTimeoutMs: 1000,
    onJobSucceeded: async (completed) => succeeded.push(completed.id),
  });
  const job = await runner.enqueue({ kind: "digest", referenceTime: "2026-09-18T00:00:00.000Z" });
  await runner.waitForIdle();

  const completed = store.get(job.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.result.papers.length, 1);
  assert.match(command, /mode=digest/);
  assert.deepEqual(succeeded, [job.id]);
});
