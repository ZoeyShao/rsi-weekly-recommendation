import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { once } from "node:events";
import vm from "node:vm";

for (const prefix of ["", "/rsi-weekly-recommendation"]) {
  test(`serves login and protected metrics under ${prefix || "/"}`, async (t) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const directory = await mkdtemp(join(tmpdir(), "rsi-subpath-"));
    const base = `http://127.0.0.1:${port}${prefix}`;
    const child = spawn(process.execPath, ["src/server.js"], {
      env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base,
        OMA_BASE_URL: "http://127.0.0.1:1", OMA_API_KEY: "test-key", OMA_AGENT_ID: "test-agent",
        JOB_DATA_FILE: join(directory, "jobs.json"), ANALYTICS_DATA_DIRECTORY: directory,
        ADMIN_USERNAME: "test-admin", ADMIN_PASSWORD: "test-password" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => { if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; } });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
      child.stdout.on("data", chunk => { if (chunk.toString().includes("listening on")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Server exited during startup")); });
    });
    const admin = await fetch(base + "/admin");
    assert.equal(admin.status, 200);
    const html = await admin.text();
    assert.match(html, /管理员登录/);
    assert.ok(html.includes(`const basePath=${JSON.stringify(prefix)}`));
    assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
    assert.equal((await fetch(base + "/api/admin/metrics")).status, 401);
    const headers = { authorization: "Basic " + Buffer.from("test-admin:test-password").toString("base64") };
    const metrics = await fetch(base + "/api/admin/metrics", { headers });
    assert.equal(metrics.status, 200);
    assert.ok(Array.isArray((await metrics.json()).users));
    const home = await fetch(base + "/");
    assert.equal(home.status, 200);
    assert.ok(home.headers.get("set-cookie").includes(`Path=${prefix || "/"}`));
    assert.ok((await home.text()).includes(`const basePath=${JSON.stringify(prefix)}`));
    if (prefix) assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/metrics`, { headers })).status, 404);
  });
}
