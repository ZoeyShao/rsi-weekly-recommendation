---
name: rsi-paper-report
description: Build a seven-day arXiv RSI recommendation radar, or read one selected paper and produce a rigorous Chinese full report.
---

# RSI Weekly Radar and Paper Report

This Skill has two explicit modes. Always read `mode` from the user arguments.

- `mode=digest`: discover and rank a weekly recommendation list; write `digest.json`.
- `mode=report`: read one specified paper in full; write `report.md` and then `result.json`.

Arguments also contain `reference_time=<ISO-8601 UTC timestamp>` and `request_id=<opaque id>`. Treat `reference_time` as the exclusive upper bound and exactly seven days earlier as the inclusive lower bound. Use the paper's first `<published>` timestamp, never `<updated>`, for the window check.

## Shared discovery rules

The relevant topic family includes:

- recursive self-improvement;
- self-improving or self-evolving agents;
- automated agent/harness design;
- persistent tool, evaluator, policy or research-loop improvement.

Exclude finance, medicine, human self-help and papers where self-improvement is only a passing phrase.

Rank substantive relevance using these questions:

1. Does the system change its own policy, harness, tools, evaluator, training data or research process?
2. Does the change persist beyond one answer?
3. Can the change affect a later improvement cycle?
4. Is there a concrete method or evaluation?

Never invent authors, dates, metrics, links or experimental conclusions. Distinguish reported facts, author claims and your inference. Do not reproduce long passages or redistribute the paper.

## Mode: `digest`

Make at most one request to `https://export.arxiv.org/api/query`. Do not paginate. Request at most 50 entries sorted by `submittedDate` descending. Combine `submittedDate:[START TO END]` with a union of:

- `recursive self-improvement`
- `self-improving agent`
- `self-evolving agent`
- `agent self-improvement`
- `automated agent design`
- `harness self-improvement`

If public web retrieval cannot consume Atom, use one sandbox command with Python standard-library `urllib.request` and `xml.etree.ElementTree`; install no package. Filter locally by `<published>` and relevance.

Return the strongest 6–8 papers. This mode is a recommendation scan based on metadata and abstracts, not a full-paper review. Keep each field concise enough for a consumer UI.

Write `digest.json` only after the complete list is ready:

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
      "title": "Paper title",
      "authors": ["Author One", "Author Two"],
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

If fewer than six genuinely relevant papers exist, return the smaller honest list. If none exist, write `status: "no_candidate"`. Do not fill the list with weak matches.

## Mode: `report`

Require `arxiv_id`. Open its abstract page and verify the first publication time lies in the requested window. Prefer `https://arxiv.org/html/{arxiv_id}` and read at least abstract, introduction, method, experiments, limitations and conclusion. If usable HTML is unavailable, write `result.json` with `status: "no_full_text"`.

Write a polished Chinese `report.md` containing:

1. title, authors, first publication time, categories and source links;
2. `30 秒结论`;
3. `研究问题`;
4. `核心方法`;
5. `关键实验结果`, including datasets, baselines, metrics and reported numbers;
6. `与 RSI 的关系`: what improves, persistence, next-cycle effect, evaluator and remaining human role;
7. `RSI 相关性评分` from 0–100 with rationale;
8. `局限与风险`;
9. `对工程实践的启发`;
10. `推荐阅读对象`;
11. direct HTTPS sources.

The report must contain no raw HTML, script, iframe, tracking URL or embedded remote image.

After `report.md` is complete, write `result.json` last:

```json
{
  "status": "success",
  "arxiv_id": "2609.20519v1",
  "title": "Paper title",
  "published_at": "2026-09-17T14:58:29Z",
  "analysis_basis": "full_html",
  "rsi_relevance_score": 90,
  "report_path": "report.md",
  "error": null
}
```

Allowed terminal statuses in either mode are `success`, `irrelevant`, `out_of_window`, `no_candidate`, `no_full_text`, and `error`. Non-success output must include a concise safe `error` string.
