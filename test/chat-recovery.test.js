import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.js";
import { ChatService } from "../src/chat-service.js";

test("reconciles an accepted message after a lost acknowledgement and process restart without resubmitting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsi-chat-recovery-"));
  const path = join(directory, "chats.json");
  let submissions = 0;
  let acceptedText = "";
  let ready = false;
  const oma = {
    async createSession() { return { id: "session", workspaceId: "workspace" }; },
    async submitMessage(_id, text) { submissions++; acceptedText = text; throw new Error("lost acknowledgement"); },
    async getSession() { return { status: "idle" }; },
    async getSessionEvents(_id, afterSeq) {
      return { has_more: false, data: ready ? [
        { seq: 1, type: "user.message", data: { content: [{ type: "text", text: acceptedText }] } },
        { seq: 2, type: "agent.message", data: { content: [{ type: "text", text: "已记住你的偏好。" }] } },
        { seq: 3, type: "session.turn_completed", data: {} },
      ].filter(e => e.seq > afterSeq) : [] };
    },
  };
  const store = new ChatStore(path); await store.init();
  const chat = await store.create("user");
  const service = new ChatService({ store, oma, agentId: "agent", jobs: { get:()=>null } });
  const input = { text: "优先开源实现", requestId: "request-one" };
  const pending = await service.send(chat.id, "user", input);
  assert.equal(pending.messages[0].delivery, "uncertain");
  assert.equal((await service.sync(chat.id, "user")).status, "running", "idle OMA before queued message is observed must not finish the turn");
  const restored = new ChatStore(path); await restored.init();
  const restarted = new ChatService({ store: restored, oma, agentId: "agent", jobs: { get:()=>null } });
  ready = true;
  const completed = await restarted.sync(chat.id, "user");
  assert.equal(completed.status, "idle");
  assert.equal(completed.error, null);
  assert.equal(completed.messages[0].delivery, "sent");
  assert.equal(completed.messages[1].text, "已记住你的偏好。");
  await restarted.send(chat.id, "user", input);
  await restarted.sync(chat.id, "user");
  assert.equal(submissions, 1);
  assert.equal(restored.get(chat.id).messages.length, 2);
});
