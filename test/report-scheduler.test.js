import test from "node:test";
import assert from "node:assert/strict";
import { ensureReportsForDigest } from "../src/report-scheduler.js";

test("automatically creates one report job for every digest paper and stays idempotent", async () => {
  const jobs = [];
  const store = { list: () => jobs };
  const runner = {
    async enqueue(input) {
      const job = { id: `report_${jobs.length + 1}`, status: "queued", ...input };
      jobs.push(job);
      return job;
    },
  };
  const digest = {
    id: "digest_1",
    kind: "digest",
    status: "succeeded",
    referenceTime: "2026-09-18T00:00:00.000Z",
    result: { papers: [{ arxiv_id: "2609.1" }, { arxiv_id: "2609.2" }] },
  };

  const firstRun = await ensureReportsForDigest({ digest, store, runner });
  const secondRun = await ensureReportsForDigest({ digest, store, runner });

  assert.equal(firstRun.length, 2);
  assert.equal(secondRun.length, 0);
  assert.deepEqual(jobs.map((job) => job.arxivId), ["2609.1", "2609.2"]);
  assert.ok(jobs.every((job) => job.parentJobId === digest.id && job.kind === "report"));
});
