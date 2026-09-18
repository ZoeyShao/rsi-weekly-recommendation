import { HTTPException } from "hono/http-exception";
import { renderReport } from "./report-renderer.js";

const CONTEXT = `你正在 RSI Weekly 的研究偏好对话中。用中文和用户连续交流，帮助明确关注的 RSI 方向、理论或工程侧重、阅读深度、希望排除的主题。
每次最多问 1–2 个有用的问题；用户已说明的偏好直接记住，不重复问。偏好明确后用简短条目总结，并提示可以点击“按当前偏好生成推荐”。用户可以继续修改。
用户明确要求搜索时可以检索并提供有来源的建议；没有实际检索就不要声称已找到本周论文。每次以用户可见的文字回复，不要只写文件。
本对话不是 mode=digest 或 mode=report 任务。正式推荐卡片及所有全文解读由页面上的生成按钮另行启动。正式推荐默认限近七天。`;

function textContent(data) {
  return Array.isArray(data?.content) ? data.content.filter(c => c.type === "text").map(c => c.text || "").join("\n") : "";
}

export class ChatService {
  constructor({ store, oma, agentId, runner, jobs, maxActive = 5 }) {
    Object.assign(this, { store, oma, agentId, runner, jobs, maxActive });
    this.locks = new Map();
  }
  async exclusive(id, fn) {
    const previous = this.locks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(id, task);
    try { return await task; } finally { if (this.locks.get(id) === task) this.locks.delete(id); }
  }
  owned(id, ownerId) {
    const chat = this.store.get(id);
    if (!chat || chat.ownerId !== ownerId) throw new HTTPException(404, { message: "对话不存在。" });
    return chat;
  }
  project(chat) {
    return { id: chat.id, title: chat.title, status: chat.status, error: chat.error,
      createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages.map(m => ({ ...m,
        ...(m.role === "assistant" ? { html: renderReport(m.text) } : {}),
      })),
      recommendations: chat.recommendations.map(r => ({ ...r, status: this.jobs.get(r.jobId)?.status ?? "unknown" })) };
  }
  async sync(id, ownerId) {
    return this.exclusive(id, () => this.syncUnlocked(this.owned(id, ownerId)));
  }
  async syncUnlocked(chat) {
    if (!chat.sessionId) return chat;
    let changed = false;
    for (let page = 0; page < 10; page++) {
      const result = await this.oma.getSessionEvents(chat.sessionId, chat.cursor);
      const events = result?.data ?? [];
      for (const event of events) {
        if (!Number.isInteger(event.seq) || event.seq <= chat.cursor) continue;
        chat.cursor = event.seq; changed = true;
        if (event.sessionThreadId && event.sessionThreadId !== "sthr_primary") continue;
        if (event.type === "user.message" && chat.pendingId && textContent(event.data).includes(`[request_id=${chat.pendingId}]`)) {
          chat.pendingObserved = true;
          const message = chat.messages.find(m => m.id === chat.pendingId);
          if (message) message.delivery = "sent";
        }
        if (event.type === "agent.message") {
          const text = textContent(event.data);
          if (text.trim()) chat.messages.push({ id: `oma-${event.seq}`, role: "assistant", text, at: event.ts });
        }
        if (event.type === "session.turn_completed" && chat.pendingObserved) {
          chat.pendingId = null; chat.pendingObserved = false; chat.status = "idle"; chat.error = null;
        }
      }
      if (!result?.has_more || !events.length) break;
    }
    const session = await this.oma.getSession(chat.sessionId);
    if (session.status === "terminated") {
      chat.status = "terminated"; chat.pendingId = null;
      chat.error = "这段对话已结束，可以新建对话继续。"; changed = true;
    } else if (chat.pendingObserved && session.status === "idle") {
      chat.pendingId = null; chat.pendingObserved = false; chat.status = "idle"; chat.error = null; changed = true;
    }
    if (changed) return this.store.update(chat.id, chat);
    return chat;
  }
  async send(id, ownerId, { text, requestId }) {
    if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new HTTPException(400, { message: "请输入 1–4000 字的消息。" });
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new HTTPException(400, { message: "消息标识无效。" });
    return this.exclusive(id, async () => {
      let chat = this.owned(id, ownerId);
      const existing = chat.messages.find(m => m.id === requestId);
      if (existing) {
        if (existing.text !== text.trim()) throw new HTTPException(409, { message: "消息标识已使用。" });
        return chat;
      }
      if (chat.pendingId) throw new HTTPException(409, { message: "上一条消息仍在回复中，请稍候。" });
      if (chat.status === "terminated") throw new HTTPException(410, { message: "对话已结束，请新建对话。" });
      if (this.store.activeCount() >= this.maxActive) throw new HTTPException(429, { message: "当前对话较多，请稍后再试。" });
      if (chat.messages.length >= 100) throw new HTTPException(409, { message: "这段对话较长，请新建对话继续。" });
      if (!chat.sessionId) {
        const session = await this.oma.createSession(this.agentId, `rsi-chat-${chat.id.slice(0,8)}`);
        if (!session?.id || !session.workspaceId) throw new Error("Invalid OMA Session");
        chat = await this.store.update(id, { sessionId: session.id, workspaceId: session.workspaceId });
      }
      const first = !chat.messages.length;
      const message = { id: requestId, role: "user", text: text.trim(), at: new Date().toISOString(), delivery: "sending" };
      chat = await this.store.update(id, { title: first ? text.trim().slice(0,40) : chat.title,
        messages: [...chat.messages, message], pendingId: requestId, pendingObserved: false, status: "running", error: null });
      try {
        await this.oma.submitMessage(chat.sessionId, `${CONTEXT}\n\n[request_id=${requestId}]\n用户本轮消息：\n${text.trim()}`);
        message.delivery = "sent";
        return await this.store.update(id, { messages: [...chat.messages.slice(0,-1), message] });
      } catch (error) {
        if (error.status >= 400 && error.status < 500) {
          message.delivery = "rejected";
          return this.store.update(id, { messages: [...chat.messages.slice(0,-1), message], pendingId: null,
            status: error.status === 410 ? "terminated" : "idle",
            error: "消息未被接收，请稍后重新发送，或新建对话。" });
        }
        // A network timeout may happen AFTER OMA accepted the input. Keep the
        // pending request for event reconciliation; do not silently send twice.
        message.delivery = "uncertain";
        return this.store.update(id, { messages: [...chat.messages.slice(0,-1), message],
          error: "暂未确认消息是否送达，正在核对进度。请勿重复发送；也可新建对话。" });
      }
    });
  }
  async recommend(id, ownerId, requestId) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new HTTPException(400, { message: "请求标识无效。" });
    return this.exclusive(id, async () => {
      let chat = this.owned(id, ownerId);
      const existing = this.jobs.list().find(j => j.chatId === id && j.recommendationRequestId === requestId);
      if (existing) return existing;
      chat = await this.syncUnlocked(chat);
      if (chat.pendingId) throw new HTTPException(409, { message: "请等待本轮回复完成后再生成推荐。" });
      if (!chat.messages.some(m => m.role === "assistant")) throw new HTTPException(409, { message: "先聊聊你的研究偏好，再生成推荐。" });
      const preferences = chat.messages.filter(m => !["uncertain", "rejected"].includes(m.delivery)).map(({role,text}) => ({role,text}));
      const job = await this.runner.enqueue({ kind: "digest", referenceTime: new Date().toISOString(),
        ownerId, chatId: id, recommendationRequestId: requestId, preferences });
      await this.store.update(id, { recommendations: [...chat.recommendations, { jobId: job.id, at: job.createdAt }] });
      return job;
    });
  }
}
