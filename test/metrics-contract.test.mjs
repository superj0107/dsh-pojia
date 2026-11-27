// 指标契约测试：文档里写了的每类事件，代码里必须有写入者，且汇总/报表都得认。
//
// 为什么要有这条：连着三轮发现三个「文档承诺了、代码从没写过」的死指标
// （refusal / retry / validate），其中 validate 直接让 doctor 的「中转 + gateway fail」建议
// 永远不会触发。靠人眼看文档是查不出来的，靠测试才行。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const libDir = path.join(root, "lib");
const metricsSrc = readFileSync(path.join(libDir, "metrics.js"), "utf8");

/** 从 metrics.js 的 docblock 里抽出「kind 约定」列出的所有事件类型。 */
function documentedKinds() {
  const block = metricsSrc.slice(metricsSrc.indexOf("kind 约定"), metricsSrc.indexOf("export function record"));
  const kinds = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*\*\s{2,}([a-z][a-z-]*)\s+——/);
    if (m) kinds.push(m[1]);
  }
  return kinds;
}

let tmpHome;
beforeEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "pojia-metrics-contract-"));
  process.env.DSH_HOME = tmpHome;
});

test("metrics 契约：文档里的每类事件都有写入者", () => {
  const kinds = documentedKinds();
  assert.ok(kinds.length >= 5, `文档里应列出至少 5 类事件，实际 ${kinds.length}: ${kinds.join(",")}`);
  const writers = readdirSync(libDir)
    .filter((n) => n.endsWith(".js") && n !== "metrics.js")
    .map((n) => readFileSync(path.join(libDir, n), "utf8"))
    .join("\n");
  for (const kind of kinds) {
    assert.ok(
      writers.includes(`metrics.record("${kind}"`),
      `事件 "${kind}" 在文档里有、但代码里没有 writer（死指标）——要么补写入者，要么从文档里删掉`,
    );
  }
});

test("metrics 契约：每类事件都进 byKind 与 total（可计数）", async () => {
  const m = await import("../lib/metrics.js");
  const kinds = documentedKinds();
  for (const kind of kinds) {
    assert.equal(m.record(kind, { probe: "x" }), true, `record(${kind}) 应成功`);
  }
  const sum = m.summarize();
  assert.equal(sum.total, kinds.length, `total 应等于事件数 ${kinds.length}`);
  for (const kind of kinds) {
    assert.equal(sum.byKind[kind], 1, `${kind} 没进 byKind`);
  }
  // 报表与摘要对任何合法 summary 都不能抛
  assert.ok(m.summarizeLine(sum).length > 0);
  assert.ok(m.formatReport(sum).length > 0);
  const future = m.summarize({ windowMs: 1, now: Date.now() + 60_000 });
  assert.equal(future.total, 0, "窗口之外的旧事件不该被算进来");
  assert.ok(m.formatReport(future).includes("最近没有数据"), "空态要有明确文案");
});

test("metrics 契约：写入失败不抛（只读目录也不能把主流程带崩）", async () => {
  const m = await import("../lib/metrics.js");
  const prev = process.env.DSH_HOME;
  // 把 home 指到一个「作为文件存在」的路径，制造 mkdir 失败
  const badHome = path.join(tmpHome, "not-a-dir");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(badHome, "x", "utf8");
  process.env.DSH_HOME = badHome;
  try {
    assert.equal(m.record("inject", { bytes: 1 }), false, "写失败应返回 false");
    assert.doesNotThrow(() => m.summarize());
  } finally {
    process.env.DSH_HOME = prev;
  }
});
