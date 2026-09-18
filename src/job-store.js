import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class JobStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.jobs = new Map();
    this.saveChain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const rows = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(rows)) throw new Error("job store root must be an array");
      for (const row of rows) this.jobs.set(row.id, row);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  async create({ referenceTime, kind = "report", parentJobId = null, arxivId = null,
    ownerId = null, chatId = null, recommendationRequestId = null, preferences = null }) {
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      kind,
      parentJobId,
      arxivId,
      ownerId,
      chatId,
      recommendationRequestId,
      preferences,
      status: "queued",
      referenceTime,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      workspaceId: null,
      submittedAt: null,
      completedAt: null,
      result: null,
      reportMarkdown: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    await this.persist();
    return structuredClone(job);
  }

  async update(id, patch) {
    const current = this.jobs.get(id);
    if (!current) throw new Error(`Unknown job: ${id}`);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, updated);
    await this.persist();
    return structuredClone(updated);
  }

  persist() {
    this.saveChain = this.saveChain.then(async () => {
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.list(), null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.filePath);
    });
    return this.saveChain;
  }
}
