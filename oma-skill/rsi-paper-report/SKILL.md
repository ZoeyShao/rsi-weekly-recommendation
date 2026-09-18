---
name: rsi-paper-report
description: 用于生成近七天 arXiv RSI 论文推荐列表，或阅读指定论文全文并生成严谨的中文解读报告。
---

# RSI 每周论文推荐与全文解读

本 Skill 包含两种明确的执行模式。每次执行时，从用户传入的参数中读取 `mode`。

- `mode=digest`：检索、筛选并排序本周论文推荐列表，写入 `digest.json`。
- `mode=report`：阅读一篇指定论文的全文，先写入 `report.md`，再写入 `result.json`。

参数还包含 `reference_time=<ISO-8601 格式的 UTC 时间戳>` 和 `request_id=<请求标识>`。时间窗口的上界为 `reference_time`（不包含），下界为其恰好七天前（包含）。判断论文是否在窗口内时，使用首次发布时间 `<published>`，而不是更新时间 `<updated>`。

## 通用筛选规则

相关研究方向包括：

- 递归自我改进（Recursive Self-Improvement，RSI）；
- 自我改进或自我演化的智能体；
- 智能体及其执行框架（harness）的自动化设计；
- 能持续保留的工具、评估器、策略或研究循环改进。

排除金融、医学、个人成长类内容，以及仅顺带提及自我改进的论文。

根据以下问题判断实质相关性并排序：

1. 系统是否改变自身的策略、执行框架、工具、评估器、训练数据或研究过程？
2. 这些改变是否会在一次回答结束后继续保留？
3. 这些改变是否会影响后续的改进循环？
4. 论文是否提供具体方法或评估？

作者、日期、指标、链接和实验结论必须有来源依据，不得编造。明确区分论文报告的事实、作者主张和你的推断。使用概括表达，不复制大段原文或重新分发论文。

## 推荐列表模式：`digest`

最多向 `https://export.arxiv.org/api/query` 发起一次请求，不进行分页。最多获取 50 条记录，按 `submittedDate` 降序排序。将时间条件 `submittedDate:[START TO END]` 与下列英文检索词的并集组合：

- `recursive self-improvement`
- `self-improving agent`
- `self-evolving agent`
- `agent self-improvement`
- `automated agent design`
- `harness self-improvement`

如果网页检索工具无法处理 Atom 格式，使用一次沙箱命令，通过 Python 标准库 `urllib.request` 和 `xml.etree.ElementTree` 获取并解析，不安装额外依赖。按 `<published>` 和相关性在本地筛选。

返回最值得推荐的 6–8 篇论文。本模式的分析依据是元数据和摘要，不代表已阅读全文。各字段内容应简洁，适合在用户端页面展示。

完整列表准备好后，再写入 `digest.json`：

```json
{
  "status": "success",
  "generated_at": "2026-09-18T09:00:00Z",
  "window_start": "2026-09-11T09:00:00Z",
  "window_end": "2026-09-18T09:00:00Z",
  "analysis_basis": "metadata_and_abstract",
  "papers": [
    {
      "rank": 1,
      "arxiv_id": "2609.20519v1",
      "title": "论文原标题",
      "authors": ["作者一", "作者二"],
      "published_at": "2026-09-17T14:58:29Z",
      "categories": ["cs.AI"],
      "abstract_url": "https://arxiv.org/abs/2609.20519v1",
      "html_url": "https://arxiv.org/html/2609.20519v1",
      "pdf_url": "https://arxiv.org/pdf/2609.20519v1",
      "one_line": "一句话说明论文做了什么。",
      "why_recommended": "为什么它值得本周关注。",
      "rsi_relevance_score": 92,
      "problem": "它试图解决的问题。",
      "approach": "基于摘要可确认的方法概览。",
      "evidence": ["摘要直接报告的关键结果或实验范围"],
      "limitations": ["摘要无法确认的内容必须明确标注"],
      "rsi_relation": "它改变什么、是否持久、是否进入下一轮。"
    }
  ],
  "error": null
}
```

如果真正相关的论文不足六篇，按实际数量返回；不要用低相关论文凑数。如果没有符合条件的论文，写入 `status: "no_candidate"`。

## 全文解读模式：`report`

必须提供 `arxiv_id`。打开论文摘要页，核实首次发布时间位于请求指定的窗口内。优先阅读 `https://arxiv.org/html/{arxiv_id}`，至少覆盖摘要、引言、方法、实验、局限和结论。如果无法获取可用的 HTML 全文，写入 `result.json`，并设置 `status: "no_full_text"`。

生成结构清晰的中文报告 `report.md`，包含以下内容：

1. 标题、作者、首次发布时间、分类和来源链接；
2. `30 秒结论`；
3. `研究问题`；
4. `核心方法`；
5. `关键实验结果`：包括数据集、对比基线、评估指标和论文报告的数值；
6. `与 RSI 的关系`：改进对象、改进是否持续保留、对下一轮循环的影响、评估器，以及仍需人工参与的环节；
7. `RSI 相关性评分`：0–100 分，并说明评分依据；
8. `局限与风险`；
9. `对工程实践的启发`；
10. `推荐阅读对象`；
11. 直接指向来源的 HTTPS 链接。

报告使用 Markdown，不包含原始 HTML、脚本、iframe、追踪链接或嵌入式远程图片。

确认 `report.md` 写入完成后，最后写入 `result.json`：

```json
{
  "status": "success",
  "arxiv_id": "2609.20519v1",
  "title": "论文原标题",
  "published_at": "2026-09-17T14:58:29Z",
  "analysis_basis": "full_html",
  "rsi_relevance_score": 90,
  "report_path": "report.md",
  "error": null
}
```

两种模式允许使用的终态均为 `success`、`irrelevant`、`out_of_window`、`no_candidate`、`no_full_text` 和 `error`。非成功结果必须在 `error` 字段中提供简洁且不包含敏感信息的错误说明。
