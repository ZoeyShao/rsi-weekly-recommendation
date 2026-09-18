# RSI Weekly Recommendation

一个独立于 OMA Sandbox 的常驻 C 端网关与网页。用户点击一次即可获得近七天 RSI 论文推荐列表；列表完成后，网关会自动为每篇入选论文创建 OMA 全文解读任务。卡片采用渐进式披露，但计算不是按需触发的。

页面提供两个入口：直接生成本周推荐，或先通过多轮对话明确研究偏好，再生成个性化推荐。对话由真实 OMA Session 执行，支持历史记录与刷新恢复。

已有 OMA Agent 并已装备当前 Skill 时，部署网页无需重复上传 Skill；可直接从环境配置和启动步骤开始。

## 1. 上传最新版 OMA Skill

在 OMA 前端打开 **Skills**，上传整个目录：

`oma-skill/rsi-paper-report/`

如果之前已经上传过旧版本，需要重新上传/更新，并在 **RSI Weekly Analyst** 的 **Import Skills** 中确认装备的是最新版。Skill 有两种模式：

- `mode=digest`：检索、筛选并生成 6–8 篇推荐列表 `digest.json`；
- `mode=report`：阅读全文，生成单篇 `report.md` 和 `result.json`。

建议 Agent 的 System Prompt：

```text
你是一名严谨的 AI 研究分析师，专门分析 Recursive Self-Improvement、Self-Improving Agents 和 Self-Evolving Agents 方向的论文。

必须区分论文事实、作者主张和你自己的分析；不得仅根据标题或摘要假装完成全文分析；优先阅读 arXiv HTML 全文；输出中文并保留关键英文术语；遵循用户显式调用的 Skill；把最终产物写入 Workspace。
```

## 2. 配置环境变量

OMA API Key 在 OMA 前端的 **API Keys → Create Key** 创建。Agent ID 位于 Agent 页面 URL 的 `/agents/<Agent ID>`。

```bash
cp .env.example .env.local
chmod 600 .env.local
```

编辑 `.env.local`：

```env
OMA_BASE_URL=https://agentry.welltop.tech/api
OMA_API_KEY=完整的 OMA API Key
OMA_AGENT_ID=RSI Weekly Analyst 的 Agent ID

# 设置二者后开启私有数据看板 /admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=一段足够长的随机密码
```

`.env.local` 已被 `.gitignore` 排除，不能提交到 GitHub，也不要使用 `VITE_` 或 `NEXT_PUBLIC_` 这类会暴露到浏览器的前缀。

## 3. 安装并启动

```bash
npm install
npm test
npm start
```

打开 `http://localhost:8787`。私有数据看板位于 `http://localhost:8787/admin`，通过页面内的管理员登录表单访问；数据接口仍受认证保护。

## 4. 执行链路

1. 浏览器调用 `POST /api/digests`。
2. 网关创建 Digest OMA Session，提交 `mode=digest` 指令。
3. Agent 写入 `digest.json` 后，网页显示推荐列表。
4. 网关立即为列表中的每篇论文排队创建 Report OMA Session，不等待用户点击。
5. 每个 Report Agent 阅读全文并写入 `report.md` 与 `result.json`。
6. 卡片上的“查看全文解读”按钮在报告完成后启用；点击只打开成品，不启动新任务。

当前 OMA 任务使用单进程串行队列，防止同时向 arXiv 发起过多请求。任务状态保存在 `data/jobs.json`，OMA API Key 只存在于网关进程。

对话入口使用独立的 OMA Session，每条消息续接同一 Session。网关按事件游标读取回复，只展示用户消息和助手正文，不展示模型思考、工具日志或平台凭据。偏好对齐后点击“按当前偏好生成推荐”，网关创建推荐任务，并将当前完整对话交给推荐列表和各篇全文解读任务作为偏好依据。聊天中仍可补充偏好、再次生成；已生成的结果保留对应的对话快照。此流程无需添加新的 Skill mode。

## 5. 用户身份与埋点

网关会给每个浏览器签发一个持续一年的 `HttpOnly`、`SameSite=Lax` 匿名用户 Cookie，并验证签名。签名密钥保存在聊天数据目录的 `identity.key`，需要随数据持久化，不能提交到 Git。旧的未签名 Cookie 在首次访问时会换成新身份。以下行为会和该匿名 ID 关联并写入 `data/analytics.ndjson`：

- 生成和浏览推荐列表；
- 论文卡片曝光、展开和收起；
- 打开全文解读；
- 点击 arXiv 原文；
- 点赞、点踩和撤销反馈。
- 新建研究对话、发送消息、从对话生成推荐（事件中不保存消息正文）。

当前身份是“浏览器级匿名身份”：清除 Cookie 或换设备会产生新 ID。以后接入手机号、邮箱或 OAuth 登录时，可以将匿名 ID 绑定到正式账号，从而实现跨设备历史与个性化推荐。

反馈当前值保存在 `data/feedback.json`，同一用户对同一推荐列表中的同一论文只有一个有效反馈。配置管理员账号后，`/admin` 可查看用户、论文和推荐位置维度的数据。

对话正文与 OMA Session 映射保存在 `data/chats.json`；对话及从对话生成的推荐、报告均验证所属用户。转发私人对话或个性化推荐链接不会授权其他用户读取。清除 Cookie 后将无法再访问原匿名身份的私人对话；尚未实现登录绑定或跨设备恢复。

## 6. 主要接口

- `POST /api/digests`：创建一次完整周报任务；
- `GET /api/digests/:id`：读取推荐列表与每篇全文任务状态；
- `GET /api/reports/:id`：读取单篇全文报告；
- `POST /api/analytics/events`：记录当前用户行为；
- `POST /api/feedback`：记录当前用户点赞/点踩；
- `GET /api/me`：返回当前匿名用户 ID；
- `GET/POST /api/chats`：列出自己的对话或新建对话；
- `GET /api/chats/:id`：读取并同步自己的对话；
- `POST /api/chats/:id/messages`：向同一 OMA Session 发送消息（`text`、`requestId`）；
- `POST /api/chats/:id/recommendations`：按对话偏好生成推荐（`requestId`，重复提交返回同一任务）；
- `GET /api/admin/metrics`：带 Basic Auth 的聚合数据。

## 7. Demo 边界

- 当前实现适合单实例 Demo；生产环境应把任务、身份、事件和限流迁移到共享数据库/队列。
- 匿名 Cookie 不是登录系统，不能保证跨浏览器或跨设备身份一致。
- 当前每个 IP 默认每小时最多创建 5 个推荐任务。
- 对话消息默认每 IP 每小时 30 条（`CHAT_REQUESTS_PER_HOUR`），单条最多 4000 字，每段对话最多 100 条用户/助手消息。同时最多处理 5 段对话；等待本轮回复后再发送下一条。
- 单个 OMA 任务默认超时 15 分钟，超时后网关会终止对应 Session。
- 论文 PDF 不会被网关重新托管；报告只提供原始 arXiv 链接。

## 8. GitHub 交付与部署

项目目录与仓库名称使用 `rsi-weekly-recommendation`。私有仓库地址为 https://github.com/ZoeyShao/rsi-weekly-recommendation ，服务器维护者需先获得读取权限：

```bash
git clone https://github.com/ZoeyShao/rsi-weekly-recommendation.git
cd rsi-weekly-recommendation
```

仓库保留源码、依赖锁文件、测试、OMA Skill 和 `.env.example`；`.env.local`、`data/`、`node_modules/` 与日志由 `.gitignore` 排除。密钥通过私密渠道单独交付。历史任务与反馈如需迁移，应单独备份和传输 `data/`。

服务器维护者操作：

临时使用服务器 IP 时，设置 `PUBLIC_BASE_URL=http://服务器公网IP:8787`，运行服务并放行 TCP 8787；C 端入口为该地址的 `/`，看板为 `/admin`。现阶段无需配置域名。以下为以后启用域名的可选步骤。

1. 拉取仓库，在项目根目录执行 `npm ci`。
2. 复制 `.env.example` 为 `.env.local`，填入 OMA 配置和独立的管理员密码。
3. 设置 `PUBLIC_BASE_URL=https://opengrove.io/rsi-weekly-recommendation`，保留 `PORT=8787`。应用会自动将该子路径用于页面、API、返回链接及 Cookie。
4. 用 systemd 或现有进程管理器运行 `npm start`，工作目录设为项目根目录，启用自动重启；只运行一个实例。
5. 配置 HTTPS 反向代理，仅将 `/rsi-weekly-recommendation/` 转发到 `127.0.0.1:8787`，保留完整请求路径；持久化并备份 `data/`。
6. 提供服务器公网 IP，由域名管理者添加根域名的 A 记录；检查现有解析后再修改。

更新部署时拉取代码、执行 `npm ci` 并重启服务，保留服务器上的 `.env.local` 和 `data/`。

正式页面入口为 `https://opengrove.io/rsi-weekly-recommendation/`，看板入口为 `https://opengrove.io/rsi-weekly-recommendation/admin`。

现有 Nginx HTTPS server 块中可添加以下配置；`proxy_pass` 的端口后面不要添加 `/`，以保留子路径：

```nginx
location = /rsi-weekly-recommendation {
    return 308 /rsi-weekly-recommendation/;
}
location /rsi-weekly-recommendation/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
