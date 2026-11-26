// dsh-pojia 基础自动化测试：node --test test/*.test.mjs
// 覆盖纯逻辑模块（人设库、有效性验证、frontmatter 解析），不依赖宿主进程。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "pojia-test-"));
  process.env.DSH_HOME = tmpHome;
});

test("persona: 默认人设可读且正文非空", async () => {
  const p = await import("../lib/persona.js");
  const list = p.listPersonas();
  assert.ok(list.some((x) => x.id === "pojia-armor" && x.source === "builtin"));
  assert.ok(p.currentPrompt().length > 1000);
  assert.equal(p.readState().current, "pojia-armor");
});

test("persona: 导入 -> 列表 -> 切换 -> 正文生效 -> 删除回退", async () => {
  const p = await import("../lib/persona.js");
  const body = "自定义测试人设正文，先结论后依据。";
  const imp = p.importPersona("test-persona", body, { name: "测试人设" });
  assert.equal(imp.ok, true);
  assert.ok(p.listPersonas().some((x) => x.id === "test-persona" && x.source === "user"));
  assert.equal(p.usePersona("test-persona").ok, true);
  assert.equal(p.currentPrompt().trim(), body);
  assert.equal(p.deletePersona("test-persona").ok, true);
  assert.equal(p.readState().current, "pojia-armor");
  assert.ok(p.currentPrompt().length > 1000);
});

test("persona: 非法 id 与缺失人设被拒绝", async () => {
  const p = await import("../lib/persona.js");
  assert.equal(p.usePersona("BAD ID").ok, false);
  assert.equal(p.usePersona("not-exist").ok, false);
  assert.equal(p.deletePersona("pojia-armor").ok, false);
});

test("persona: frontmatter 解析 harness/model 数组", async () => {
  const p = await import("../lib/persona.js");
  const md = '---\nid: fm-test\nname: FM\nmodel: ["*"]\norder: 7\n---\n正文\n';
  mkdirSync(p.personaDir(), { recursive: true });
  writeFileSync(path.join(p.personaDir(), "fm.md"), md);
  const item = p.listPersonas().find((x) => x.id === "fm-test");
  assert.ok(item);
  assert.equal(item.order, 7);
  assert.deepEqual(item.model, ["*"]);
});

test("validate: 探针集覆盖三类且 id 唯一", async () => {
  const v = await import("../lib/effect-check.js");
  const all = v.listProbes();
  assert.ok(all.length >= 6);
  assert.ok(new Set(all.map((x) => x.id)).size === all.length);
  assert.ok(new Set(all.map((x) => x.kind)).size >= 3);
  assert.equal(v.listProbes("refusal").every((x) => x.kind === "refusal"), true);
});

test("validate: 记录 -> 报告命中率 -> 清空", async () => {
  const v = await import("../lib/effect-check.js");
  assert.equal(v.recordProbe("bad-id", "pass").ok, false);
  assert.equal(v.recordProbe("refuse-1", "pass").ok, true);
  assert.equal(v.recordProbe("normal-1", "fail", "拒绝执行").ok, true);
  assert.equal(v.recordProbe("normal-1", "skip").ok, true);
  const rows = v.report();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pass, 1);
  assert.equal(rows[0].fail, 0); // 同一探针后写 skip 覆盖 fail
  assert.equal(rows[0].skip, 1);
  assert.equal(rows[0].rate, 100);
  v.clearValidation();
  assert.equal(v.report().length, 0);
});

test("cleanup", () => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});
