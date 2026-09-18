import test from "node:test";
import assert from "node:assert/strict";
import { startFixture } from "./helpers/gateway-fixture.js";

test("private multi-turn chats preserve identity, hide internal events and personalize all report jobs", async t => {
  const fixture = await startFixture("/rsi-weekly-recommendation"); t.after(()=>fixture.close());
  async function visitor(){const r=await fetch(fixture.base+"/");return r.headers.get("set-cookie").split(";")[0];}
  const alice=await visitor(),bob=await visitor();
  async function request(path,cookie=alice,body){const r=await fetch(fixture.base+path,{method:body?"POST":"GET",headers:{cookie,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
  const chat=(await request("/api/chats",alice,{})).body;
  assert.equal((await request(`/api/chats/${chat.id}`,bob)).status,404);
  assert.equal((await request(`/api/chats/${chat.id}/messages`,bob,{text:"窃取会话",requestId:"message-evil"})).status,404);
  assert.equal((await request(`/api/chats/${chat.id}/recommendations`,alice,{requestId:"empty-recommend"})).status,409);
  const first={text:"我关注工程落地",requestId:"message-one"};
  assert.equal((await request(`/api/chats/${chat.id}/messages`,alice,first)).status,202);
  await request(`/api/chats/${chat.id}/messages`,alice,first);
  assert.equal(fixture.submitted.length,1,"retries must not submit twice");
  const reply=await request(`/api/chats/${chat.id}`);
  assert.equal(reply.body.status,"idle");
  assert.equal(reply.body.messages.length,2);
  assert.equal(JSON.stringify(reply.body).includes("PRIVATE_CHAIN_NOT_FOR_CLIENT"),false);
  assert.equal(JSON.stringify(reply.body).includes("test-secret"),false);
  assert.equal(reply.body.sessionId,undefined);
  await request(`/api/chats/${chat.id}/messages`,alice,{text:"有开源实现，排除金融",requestId:"message-two"});
  const second=await request(`/api/chats/${chat.id}`);
  assert.equal(second.body.messages.length,4);
  assert.equal(fixture.sessions.size,1,"same OMA Session across turns");
  const forged=alice.split(".")[0]+"."+"0".repeat(64);
  assert.equal((await request(`/api/chats/${chat.id}`,forged)).status,404);
  const generation=(await request(`/api/chats/${chat.id}/recommendations`,alice,{requestId:"recommend-one"})).body;
  const again=(await request(`/api/chats/${chat.id}/recommendations`,alice,{requestId:"recommend-one"})).body;
  assert.equal(again.jobId,generation.jobId);
  assert.ok(generation.digestUrl.startsWith("/rsi-weekly-recommendation/digests/"));
  let digest;
  for(let n=0;n<100;n++){digest=await request(`/api/digests/${generation.jobId}`);if(digest.body.digest?.papers[0]?.reportJob?.status==="succeeded")break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(digest.body.status,"succeeded");
  const report=digest.body.digest.papers[0].reportJob;
  assert.equal(report.status,"succeeded");
  assert.equal((await request(`/api/digests/${generation.jobId}`,bob)).status,404);
  assert.equal((await request(`/api/reports/${report.jobId}`,bob)).status,404);
  for(const mode of ["mode=digest","mode=report"]){const command=fixture.submitted.find(s=>s.text.includes(mode)&&s.text.startsWith("/skill:"));assert.ok(command);assert.ok(command.text.includes("我关注工程落地"));assert.ok(command.text.includes("有开源实现，排除金融"));}
  assert.equal((await request("/api/chats")).body.chats.length,1);
  assert.equal((await request("/api/chats",bob)).body.chats.length,0);
});
