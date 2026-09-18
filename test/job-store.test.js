import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobStore } from "../src/job-store.js";

test("persists job creation and updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsi-job-store-"));
  const path = join(directory, "jobs.json");
  const store = new JobStore(path);
  await store.init();
  const job = await store.create({ referenceTime: "2026-09-18T00:00:00.000Z" });
  await store.update(job.id, { status: "running" });

  const rows = JSON.parse(await readFile(path, "utf8"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "running");
  assert.equal(store.get(job.id).referenceTime, "2026-09-18T00:00:00.000Z");
});
