export function renderAdminPage(basePath = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RSI Weekly · 数据看板</title>
  <style>
    :root{color-scheme:dark;--bg:#0b0e12;--panel:#14191f;--line:#29323c;--ink:#f4f6f8;--muted:#98a4af;--accent:#c7ff5e}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,"Noto Sans SC",system-ui,sans-serif}.shell{width:min(1180px,calc(100% - 32px));margin:auto;padding:32px 0 80px}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:32px}h1{margin:8px 0 0;font-size:40px;letter-spacing:-.04em}.eyebrow{color:var(--accent);font:12px ui-monospace,monospace;letter-spacing:.14em}.stamp{color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,.table-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}.metric{font-size:32px;font-weight:800;margin-top:8px}.label{color:var(--muted);font-size:13px}.table-card{margin-top:16px;overflow:auto}h2{font-size:18px;margin:0 0 16px}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);font-size:13px}th{color:var(--muted);font-weight:600}.error{color:#ff806e}form{max-width:440px}label{display:block;margin:16px 0 6px}input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid var(--line)}input{width:100%;background:var(--bg);color:var(--ink)}button{cursor:pointer;background:var(--accent);color:#111;margin-top:18px}button:disabled{opacity:.5}[hidden]{display:none!important}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}header{align-items:start;flex-direction:column;gap:12px}}
  </style>
</head>
<body><main class="shell">
<header><div><div class="eyebrow">PRIVATE PRODUCT ANALYTICS</div><h1>用户反馈回流</h1></div><div id="stamp" class="stamp">请使用管理员账号登录</div></header>
<form id="login" class="card">
<h2>管理员登录</h2>
<label for="username">用户名</label><input id="username" autocomplete="username" required>
<label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required>
<button id="submit" type="submit">登录看板</button>
</form>
<div id="dashboard" hidden>
<button id="refresh" type="button">刷新数据</button> <button id="logout" type="button">退出登录</button>
<section id="metrics" class="grid"></section>
<section class="table-card"><h2>论文表现</h2><table><thead><tr><th>arXiv</th><th>曝光</th><th>展开</th><th>展开率</th><th>全文打开</th><th>全文转化率</th><th>👍</th><th>👎</th></tr></thead><tbody id="papers"></tbody></table></section>
<section class="table-card"><h2>用户行为（匿名 ID）</h2><table><thead><tr><th>用户 ID</th><th>首次访问</th><th>最近访问</th><th>生成雷达</th><th>展开</th><th>全文打开</th><th>arXiv 点击</th><th>反馈</th><th>对话消息</th><th>对话生成推荐</th></tr></thead><tbody id="users"></tbody></table></section>
<section class="table-card"><h2>推荐位表现</h2><table><thead><tr><th>位置</th><th>曝光</th><th>展开</th><th>展开率</th></tr></thead><tbody id="positions"></tbody></table></section>
</div><p id="error" class="error" role="alert"></p></main>
<script>
const basePath=${JSON.stringify(basePath)};
const $=selector=>document.querySelector(selector);
const pct=v=>(v*100).toFixed(1)+'%';
let authorization='';
function table(selector,rows){
  const body=$(selector);body.replaceChildren();
  for(const values of rows){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)}body.append(row)}
  if(!rows.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.textContent='暂无数据';row.append(cell);body.append(row)}
}
async function load(){
  $('#error').textContent='';
  const r=await fetch(basePath+'/api/admin/metrics',{headers:{authorization},credentials:'omit',cache:'no-store'});
  if(r.status===401)throw new Error('用户名或密码不正确，请重试。');
  if(!r.ok)throw new Error('数据读取失败，请稍后重试。');
  const d=await r.json();
  $('#stamp').textContent='更新于 '+new Date(d.generatedAt).toLocaleString();
  $('#metrics').replaceChildren();
  for(const [label,value] of [['独立用户',d.uniqueVisitors],['推荐列表浏览',d.funnel.digestViews],['论文展开率',pct(d.funnel.expansionRate)],['全文打开率',pct(d.funnel.fullReportRate)],['研究对话',d.counts.chat_started||0],['对话消息',d.counts.chat_message_sent||0],['对话生成推荐',d.counts.chat_recommendation_requested||0]]){
    const card=document.createElement('div'),name=document.createElement('div'),metric=document.createElement('div');
    card.className='card';name.className='label';metric.className='metric';name.textContent=label;metric.textContent=value;card.append(name,metric);$('#metrics').append(card);
  }
  table('#papers',d.papers.map(p=>[p.arxivId,p.impressions,p.expansions,pct(p.expansionRate),p.fullReports,pct(p.fullReportRate),p.up,p.down]));
  table('#users',d.users.map(u=>[u.userId,new Date(u.firstSeenAt).toLocaleString(),new Date(u.lastSeenAt).toLocaleString(),u.digestRequests,u.expansions,u.fullReportOpens,u.sourceClicks,u.votes,u.chatMessages||0,u.chatRecommendations||0]));
  table('#positions',d.positions.map(p=>['#'+(p.position+1),p.impressions,p.expansions,pct(p.expansionRate)]));
  $('#login').hidden=true;$('#dashboard').hidden=false;
}
$('#login').addEventListener('submit',async event=>{
  event.preventDefault();$('#submit').disabled=true;
  const bytes=new TextEncoder().encode($('#username').value+':'+$('#password').value);
  authorization='Basic '+btoa(String.fromCharCode(...bytes));
  try{await load();$('#password').value=''}catch(error){authorization='';$('#error').textContent=error.message}finally{$('#submit').disabled=false}
});
$('#refresh').addEventListener('click',()=>load().catch(error=>{$('#error').textContent=error.message}));
$('#logout').addEventListener('click',()=>{authorization='';$('#dashboard').hidden=true;$('#login').hidden=false;for(const id of ['#metrics','#papers','#users','#positions'])$(id).replaceChildren();$('#stamp').textContent='已退出登录';$('#error').textContent=''});
</script></body></html>`;
}
