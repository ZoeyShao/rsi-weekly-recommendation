import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class ChatStore {
  constructor(path) { this.path = path; this.rows = new Map(); this.chain = Promise.resolve(); }
  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try { for (const row of JSON.parse(await readFile(this.path, "utf8"))) this.rows.set(row.id, row); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  get(id) { return this.rows.has(id) ? structuredClone(this.rows.get(id)) : null; }
  list(ownerId) { return [...this.rows.values()].filter(c => c.ownerId === ownerId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(c => structuredClone(c)); }
  activeCount() { return [...this.rows.values()].filter(c => c.pendingId).length; }
  pending() { return [...this.rows.values()].filter(c => c.pendingId).map(c => structuredClone(c)); }
  async create(ownerId) {
    const now = new Date().toISOString();
    const row = { id: randomUUID(), ownerId, title: "新的研究对话", createdAt: now, updatedAt: now,
      sessionId: null, workspaceId: null, cursor: 0, messages: [], pendingId: null, pendingObserved: false,
      status: "idle", error: null, recommendations: [] };
    this.rows.set(row.id, row); await this.save(); return structuredClone(row);
  }
  async update(id, patch) {
    const row = this.rows.get(id);
    if (!row) throw new Error("Unknown chat");
    const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
    this.rows.set(id, next); await this.save(); return structuredClone(next);
  }
  save() {
    const snapshot = JSON.stringify([...this.rows.values()], null, 2);
    const task = this.chain.then(async () => {
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, snapshot + "\n", { mode: 0o600 });
      await rename(temp, this.path);
    });
    this.chain = task.catch(() => {}); return task;
  }
}
