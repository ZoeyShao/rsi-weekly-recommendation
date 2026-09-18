import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderPage } from "../src/page.js";

test("consumer page compiles and opens pre-generated reports without creating them", () => {
  const html = renderPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(html, /入选后立即生成全部全文解读/);
  assert.doesNotMatch(script, /papers\/[^'"\s]+\/report/);
  assert.match(script, /full_report_requested/);
});
