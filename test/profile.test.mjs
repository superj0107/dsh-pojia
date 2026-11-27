// 协同层测试：模型画像（分类 / 人设匹配 / 注入决策）+ 运行时指标（记录 / 汇总 / 翻滚 / 容错）。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, statSync, readFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;
beforeEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "pojia-profile-"));
  process.env.DSH_HOME = tmpHome;
});

test("profile: 模型族识别（先看 model，再看 provider）", async () => {
  const p = await import("../lib/model-profile.js");
  const cases = [
    [{ provider: "deepseek", model: "deepseek-chat" }, "deepseek"],
    [{ provider: "x", model: "deepseek-v4-flash" }, "deepseek"],
    [{ provider: "anthropic", model: "claude-opus-5-5" }, "claude"],
    [{ provider: "openai", model: "gpt-6.1-sol" }, "gpt"],
    [{ provider: "google", model: "gemini-2.5-pro" }, "gemini"],
    [{ provider: "zhipu", model: "GLM-5.2" }, "glm"],
    [{ provider: "moonshot", model: "kimi-k3.1-pro" }, "kimi"],
    [{ provider: "ali", model: "qwen3-max" }, "qwen"],
    [{ provider: "local", model: "llama-3.3-70b" }, "llama"],
    [{ provider: "unknown-gw", model: "mystery-1" }, "unknown"],
  ];
  for (const [sel, want] of cases) {
    assert.equal(p.classifyModel(sel).family, want, `${sel.provider}/${sel.model}`);
  }
  // provider 名带厂商、model 名不认识时也能落到对应族
  assert.equal(p.classifyModel({ provider: "deepseek-relay", model: "v3" }).family, "deepseek");
  assert.equal(p.classifyModel({}).family, "unknown");
  assert.equal(p.classifyModel().family, "unknown");
});

test("profile: 推荐通道按族给，relay 会带提示", async () => {
  const p = await import("../lib/model-profile.js");
  assert.equal(p.profileFor({ provider: "deepseek", model: "deepseek-chat" }).recommendedMode, "user");
  assert.equal(p.profileFor({ provider: "anthropic", model: "claude-opus-5-5" }).recommendedMode, "both");
  assert.equal(p.profileFor({ provider: "openai", model: "gpt-6.1-sol" }).recommendedMode, "both");
  const relayed = p.profileFor({ provider: "wx", model: "GLM-5.2" }, { relay: true });
  assert.equal(relayed.relay, true);
  assert.ok(relayed.note.includes("疑似中转"));
  assert.ok(p.describeProfile(relayed).includes("疑似中转"));
  assert.ok(p.describeProfile(null).includes("未识别"));
});

test("profile: 人设按 model 元数据匹配（当前人设优先保留）", async () => {
  const persona = await import("../lib/persona.js");
  const p = await import("../lib/model-profile.js");
  const dir = persona.personaDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "for-claude.md"), '---\nid: for-claude\nname: 给 Claude\nmodel: ["claude"]\norder: 10\n---\nclaude 正文\n', "utf8");
  writeFileSync(path.join(dir, "for-gpt.md"), '---\nid: for-gpt\nname: 给 GPT\nmodel: ["gpt"]\norder: 20\n---\ngpt 正文\n', "utf8");

  const list = persona.listPersonas();
  assert.equal(p.personaForModel("claude", list).id, "for-claude");
  assert.equal(p.personaForModel("gpt", list).id, "for-gpt");
  // 没匹配到的族 → 落到 model: ["*"] 的内置人设
  assert.equal(p.personaForModel("qwen", list).id, "pojia-armor");

  // 当前人设如果在候选里，就不要来回切
  persona.usePersona("for-gpt");
  assert.equal(p.personaForModel("gpt", persona.listPersonas()).id, "for-gpt");
  persona.usePersona("pojia-armor");

  const profile = p.profileFor({ provider: "anthropic", model: "claude-opus-5-5" });
  assert.equal(profile.persona.id, "for-claude");
});

test("profile: 注入决策优先级 = 用户钉住 > 模型画像 > 默认", async () => {
  const p = await import("../lib/model-profile.js");
  const profile = p.profileFor({ provider: "approach", model: "claude-opus-5-5" });

  const pinned = p.decideInjection(profile, { pinned: true, runtimeMode: "user" });
  assert.equal(pinned.mode, "user", "用户钉住后不被自适应改掉");
  assert.equal(pinned.source, "pinned");

  const auto = p.decideInjection(profile, { pinned: false, runtimeMode: "user" });
  assert.equal(auto.mode, "both");
  assert.equal(auto.source, "profile");

  const noProfile = p.decideInjection(null, { pinned: false, runtimeMode: "legacy" });
  assert.equal(noProfile.mode, "legacy");
  assert.equal(noProfile.source, "default");
});

test("metrics: 记录 + 汇总 + 脏行容错 + 翻滚", async () => {
  const m = await import("../lib/metrics.js");
  assert.equal(m.record("inject", { family: "claude", bytes: 2048, mode: "both" }), true);
  assert.equal(m.record("inject", { family: "claude", bytes: 4096, mode: "both", sub: true }), true);
  assert.equal(m.record("inject", { family: "deepseek", bytes: 0, mode: "user", sub: true, skipped: "subagent-inject-off" }), true);
  assert.equal(m.record("trim", { family: "claude", saved: 4096, dropped: 3 }), true);
  assert.equal(m.record("refusal", { family: "claude" }), true);
  assert.equal(m.record("validate", { verdict: "fail", reason: "gateway" }), true);
  assert.equal(m.record("validate", { verdict: "pass" }), true);

  const sum = m.summarize();
  assert.equal(sum.total, 7);
  assert.equal(sum.byKind.inject, 3, "inject 类事件共 3 条（含一条 skipped）");
  assert.equal(sum.injectCount, 2, "真正注入的次数不能把 skipped 算进去");
  assert.equal(sum.injectSkipped, 1);
  assert.equal(sum.families.claude.inject, 2);
  assert.equal(sum.avgInjectBytes, 3072, "skipped 的 inject 不计入字节均值");
  assert.equal(sum.gatewayFails, 1);
  assert.equal(sum.refusalSignals, 1);
  assert.equal(sum.subagentTurns, 2, "子代理轮次按 sub:true 计数（含被跳过的）");
  assert.equal(sum.trim.count, 1);
  assert.equal(sum.trim.savedBytes, 4096);
  const line = m.summarizeLine(sum);
  assert.ok(line.includes("注入 2 次"), line);
  assert.ok(line.includes("跳过 1"), line);
  assert.ok(line.includes("子代理轮次 2"), line);
  assert.ok(line.includes("预算压缩 1 次"), line);

  // 多行报表（/pojia metrics、--metrics、面板共用）
  const report = m.formatReport(sum, {
    calibrationLine: "claude 实测最优 both（100%，6 条）",
    budgetABLine: "claude/both：压缩 67%（3 条） vs 全文 100%（3 条） → 压缩更差，建议先关掉 injectBudgetKB",
  });
  for (const needle of ["运行时指标", "事件 / events", "注入 / inject", "模型族 / families", "预算 / budget", "质量 / quality", "校准 / calibration", "预算 A/B", "最近一条 / last"]) {
    assert.ok(report.includes(needle), `报表缺「${needle}」：\n${report}`);
  }
  assert.ok(report.includes("claude 2 次"), report);
  assert.ok(m.formatReport({ total: 0 }).includes("最近没有数据"));

  // 脏行不能把汇总打挂
  appendFileSync(m.metricsPath(), "{这不是 JSON\n\n", "utf8");
  assert.equal(m.summarize().total, 7);

  // 超过上限自动翻滚，旧档留 .1
  const file = m.metricsPath();
  writeFileSync(file, `${"x".repeat(600 * 1024)}\n`, "utf8");
  assert.equal(m.record("inject", { family: "deepseek", bytes: 100 }), true);
  assert.equal(existsSync(`${file}.1`), true, "旧档应改名为 .1");
  assert.ok(statSync(file).size < 4096, "新档应重新开始");
  assert.ok(readFileSync(`${file}.1`, "utf8").length > 600 * 1024);

  // 空目录 → 汇总为空但可用
  rmSync(path.join(tmpHome, "pojia"), { recursive: true, force: true });
  const empty = m.summarize();
  assert.equal(empty.total, 0);
  assert.ok(m.summarizeLine(empty).includes("最近没有运行时数据"));
});

test("doctor: 协同行（画像 + 指标）与中转建议", async () => {
  const { buildDoctor } = await import("../lib/doctor.js");
  const state = {
    surface: "desktop",
    dsh_home: tmpHome,
    ai_base: "/fake/@deepseek-ai",
    display_applied: 64,
    display_total: 64,
    display_pending: 0,
    display_skipped: 0,
    display_ready: 64,
    patches_applied: 64,
    patches_total: 64,
    patches_pending: 0,
    patches_ready: 64,
    override_path: path.join(tmpHome, "prompt-inject.md"),
    override_status: "custom",
    asar_still_sealed: false,
  };
  writeFileSync(path.join(tmpHome, "prompt-inject.md"), "# ok\n", "utf8");

  const doc = buildDoctor({
    state,
    config: { enabled: true },
    armor: {
      enabled: true,
      mode: "user",
      effectiveMode: "both",
      pinnedMode: false,
      autoProfile: true,
      profileLine: "wx / GLM-5.2 → user（GLM） · 人设 pojia-armor · 疑似中转",
      decision: { mode: "user", source: "profile" },
    },
    metrics: { total: 12, byKind: { inject: 10 }, families: {}, avgInjectBytes: 21500, gatewayFails: 2, refusalSignals: 1, since: Date.now() - 86400000, lastAt: new Date().toISOString() },
    persona: { current: "pojia-armor", total: 1 },
    provider: { provider: "wx", model: "GLM-5.2", baseURL: "https://relay.example/v1", relay: true, note: "（疑似中转，过滤行为不可控）" },
    hostVersion: "0.2.2-rc.5",
    targets: ["0.2.2-rc.5"],
    pluginVersion: "1.1.0",
    injectBytes: 21500,
    command: { ok: true, via: "direct" },
    validation: [{ persona: "pojia-armor", pass: 4, fail: 0, skip: 0, rate: 100, builtin: 4, custom: 0, reasons: { refusal: 0, gateway: 0, transport: 0, other: 0 } }],
  });

  assert.ok(doc.text.includes("协同"), doc.text);
  assert.ok(doc.text.includes("画像 wx / GLM-5.2"), doc.text);
  assert.ok(doc.text.includes("注入 10 次"), doc.text);
  assert.ok(doc.text.includes("gateway fail"), doc.text);
  assert.equal(doc.exitCode, 0, doc.text);

  // 注入均值偏大且没开预算 → 给具体建议，但不擅自改
  const heavy = buildDoctor({
    state,
    config: { enabled: true },
    armor: { enabled: true, mode: "both", effectiveMode: "both", pinnedMode: false, autoProfile: true, profileLine: "x / y → both（GPT）", injectBudgetKB: 0 },
    metrics: { total: 10, byKind: { inject: 10 }, families: {}, avgInjectBytes: 40 * 1024, gatewayFails: 0, refusalSignals: 0, since: Date.now() - 86400000, lastAt: new Date().toISOString() },
    persona: { current: "pojia-armor", total: 1 },
    provider: { provider: "x", model: "y", baseURL: "https://api.openai.com/v1", relay: false, note: "" },
    hostVersion: "0.2.2-rc.5",
    targets: ["0.2.2-rc.5"],
    pluginVersion: "1.1.0",
    injectBytes: 40960,
    command: { ok: true, via: "direct" },
    validation: [{ persona: "pojia-armor", pass: 4, fail: 0, skip: 0, rate: 100, builtin: 4, custom: 0, reasons: { refusal: 0, gateway: 0, transport: 0, other: 0 } }],
  });
  assert.ok(heavy.text.includes("injectBudgetKB"), heavy.text);
  assert.ok(heavy.text.includes("40.0KB"), heavy.text);
});

test("cleanup", () => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});
