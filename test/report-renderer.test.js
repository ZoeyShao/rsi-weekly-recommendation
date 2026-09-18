import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report-renderer.js";

test("renders useful markdown while removing executable HTML", () => {
  const html = renderReport(`# Report\n\n[paper](https://arxiv.org/abs/1234.5678)\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>`);
  assert.match(html, /<h1>Report<\/h1>/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /script|iframe|alert\(1\)/i);
});

test("drops unsafe URL schemes", () => {
  const html = renderReport(`[bad](javascript:alert(1))`);
  assert.doesNotMatch(html, /javascript:/i);
});
