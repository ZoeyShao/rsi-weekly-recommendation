import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function startFixture(prefix = "") {
  const sessions = new Map();
  const submitted = [];
  const paper = { arxiv_id: "2609.00001v1", title: "Fixture RSI Paper", authors: ["Fixture Author"], published_at: "2026-09-18T00:00:00Z", categories: ["cs.AI"], abstract_url: "https://arxiv.org/abs/2609.00001v1", one_line: "用于验证的推荐", why_recommended: "契合研究偏好", rsi_relevance_score: 90, problem: "问题", approach: "方法", evidence: ["证据"], limitations: ["局限"], rsi_relation: "持续改进" };
  const oma = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = ""; for await (const chunk of req) body += chunk;
    const json = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/sessions" && req.method === "POST") {
      const id = `sess_${sessions.size+1}`;
      const s = { id, workspaceId: `ws_${sessions.size+1}`, status: "idle", events: [] }; sessions.set(id,s); return json(s);
    }
    const match = url.pathname.match(/^\/v1\/sessions\/(sess_\d+)(?:\/(events))?$/);
    if (match) {
      const s = sessions.get(match[1]);
      if (req.method === "POST") {
        const text = JSON.parse(body).events[0].data.content[0].text; submitted.push({ sessionId: s.id, text });
        const push = (type,data) => s.events.push({ seq: s.events.length+1, type, data, ts: new Date().toISOString(), sessionThreadId: "sthr_primary" });
        push("user.message", {content:[{type:"text",text}]});
        push("agent.thinking", {text:"PRIVATE_CHAIN_NOT_FOR_CLIENT"});
        push("agent.message", {content:[{type:"text",text:s.events.length>3?"好的，已记住你偏好开源实现，排除金融。":"你更偏向工程落地还是理论分析？"}]});
        push("session.turn_completed", {});
        return json({ accepted:true });
      }
      if (match[2]) return json({ data:s.events.filter(e=>e.seq>Number(url.searchParams.get("after_seq")||0)), has_more:false });
      return json({ id:s.id, workspaceId:s.workspaceId, status:s.status });
    }
    if (url.pathname.endsWith("/files/digest.json")) return json({status:"success",papers:[paper]});
    if (url.pathname.endsWith("/files/result.json")) return json({status:"success",title:paper.title,report_path:"report.md"});
    if (url.pathname.endsWith("/files/report.md")) { res.setHeader("content-type","text/plain"); return res.end("# Fixture report\n\n全文解读。"); }
    res.statusCode=404; json({error:"not found"});
  });
  oma.listen(0,"127.0.0.1"); await once(oma,"listening");
  const reserve=http.createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const directory=await mkdtemp(join(tmpdir(),"rsi-chat-test-"));
  const base=`http://127.0.0.1:${port}${prefix}`;
  const child=spawn(process.execPath,["src/server.js"],{env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:base,
    OMA_BASE_URL:`http://127.0.0.1:${oma.address().port}`,OMA_API_KEY:"test-secret",OMA_AGENT_ID:"test-agent",
    JOB_DATA_FILE:join(directory,"jobs.json"),CHAT_DATA_FILE:join(directory,"chats.json"),ANALYTICS_DATA_DIRECTORY:directory,
    POLL_INTERVAL_MS:"10",REPORT_TIMEOUT_MS:"10000",REQUESTS_PER_IP_PER_HOUR:"100",ADMIN_USERNAME:"admin",ADMIN_PASSWORD:"test-password"},stdio:["ignore","pipe","pipe"]});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("startup timeout")),5000);child.stdout.on("data",b=>{if(b.toString().includes("listening on")){clearTimeout(timeout);resolve()}});child.once("exit",()=>{clearTimeout(timeout);reject(new Error("server exited"))});});
  return {base,submitted,sessions,directory,async close(){if(child.exitCode===null){const end=once(child,"exit");child.kill();await end;}await new Promise(resolve=>oma.close(resolve));}};
}
