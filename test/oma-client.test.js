import test from "node:test";
import assert from "node:assert/strict";
import { OmaClient } from "../src/oma-client.js";

test("creates a Session with the server-only API key", async () => {
  let captured;
  const fetchFn = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ id: "session_1", workspaceId: "workspace_1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new OmaClient({ baseUrl: "https://oma.example", apiKey: "secret", fetchFn });
  const session = await client.createSession("agent_1", "weekly-report");

  assert.equal(session.id, "session_1");
  assert.equal(captured.url, "https://oma.example/v1/sessions");
  assert.equal(captured.options.headers["x-api-key"], "secret");
  assert.deepEqual(JSON.parse(captured.options.body), { agent: "agent_1", workspace_name: "weekly-report" });
});

test("follows the signed Workspace preview URL without forwarding the API key", async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        path: "result.json",
        url: "https://oss.example.test/signed-result",
        contentType: "application/json",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response('{"status":"success"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new OmaClient({ baseUrl: "https://oma.example/api", apiKey: "secret", fetchFn });

  const content = await client.getWorkspaceText("workspace_1", "result.json");

  assert.equal(content, '{"status":"success"}');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://oss.example.test/signed-result");
  assert.equal(calls[1].options.headers?.["x-api-key"], undefined);
});
