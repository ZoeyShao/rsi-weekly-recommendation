import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderPage } from "../src/page.js";

test("consumer page compiles and opens pre-generated reports without creating them", () => {
  const html = renderPage();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const script = scripts[0];

  assert.ok(script);
  for (const source of scripts) assert.doesNotThrow(() => new vm.Script(source));
  assert.match(html, /入选后立即生成全部全文解读/);
  assert.doesNotMatch(script, /papers\/[^'"\s]+\/report/);
  assert.match(script, /full_report_requested/);
});
