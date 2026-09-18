import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the bundled OMA production URL targets the API ingress prefix", async () => {
  const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const expected = "OMA_BASE_URL=https://agentry.welltop.tech/api";
  assert.match(template, new RegExp(`^${expected}$`, "m"));
  assert.match(readme, new RegExp(`^${expected}$`, "m"));
});
