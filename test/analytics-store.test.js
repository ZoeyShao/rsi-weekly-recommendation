import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalyticsStore } from "../src/analytics-store.js";

test("aggregates progressive-disclosure events and current feedback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsi-analytics-"));
  const store = new AnalyticsStore(directory);
  await store.init();
  const base = { userId: "user_1", digestId: "digest_1", arxivId: "2609.1", position: 0 };
  await store.track({ ...base, type: "paper_impression" });
  await store.track({ ...base, type: "paper_expanded" });
  await store.track({ ...base, type: "full_report_requested" });
  const vote = await store.vote({ userId: "user_1", digestId: "digest_1", arxivId: "2609.1", value: 1 });

  assert.deepEqual(vote, { up: 1, down: 0, mine: 1 });
  const metrics = store.metrics();
  assert.equal(metrics.uniqueVisitors, 1);
  assert.equal(metrics.funnel.expansionRate, 1);
  assert.equal(metrics.funnel.fullReportRate, 1);
  assert.equal(metrics.papers[0].up, 1);
  assert.equal(metrics.users[0].userId, "user_1");
  assert.equal(metrics.users[0].expansions, 1);
  assert.equal(metrics.users[0].fullReportOpens, 1);
  assert.equal(metrics.users[0].votes, 1);
});
