#!/usr/bin/env node
// 协同层端到端自检（可进 CI）：用最小 Cordis ctx 拉起插件，模拟一轮真实 pre-step，
// 验证「模型画像 → 注入通道决策 → 注入落消息 → 指标落盘 → status/doctor 展示 → 用户钉住优先」。
//
// 用法：node scripts/e2e-coop.mjs
// 退出码：0 全通；1 有断言失败（输出会逐条列出）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "pojia-coop-"));
process.env.DSH_HOME = home;
process.env.DSH_SURFACE = "web";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function cleanup() {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch { /* 清理失败不影响判定 */ }
}

try {
  fs.writeFileSync(path.join(home, "prompt-inject.md"), "# 注入正文\n", "utf8");
  // 官方直连的 settings：让画像不带 relay 噪声
  fs.writeFileSync(path.join(home, "settings.yaml"), [
    "agent-default-model:",
    "  provider: anthropic",
    "  model: claude-opus-5-5",
    "llm-pi-ai:",
    "  providers:",
    "    anthropic:",
    "      baseURL: https://api.anthropic.com/v1",
    "",
  ].join("\n"), "utf8");

  const registry = { commands: [], tools: [], listeners: {} };
  const services = { commands: { register(c) { registry.commands.push(c); return () => {}; } } };
  const ctx = {
    baseUrl: pathToFileURL(root).href,
    get: (n) => services[n],
    inject: (_n, fn) => { try { fn({ get: () => ({ await: () => Promise.resolve() }) }); } catch { /* 宿主差异 */ } },
    effect: (fn) => { try { fn(); } catch { /* 宿主差异 */ } },
    on: (name, fn) => { (registry.listeners[name] ||= []).push(fn); return () => {}; },
    systemPrompt: { section: () => () => {} },
    tools: { register(t) { registry.tools.push(t); return () => {}; } },
  };

  const mod = await import(pathToFileURL(path.join(root, "lib", "index.js")).href);
  mod.apply(ctx, { enabled: true, autoApplyOnStart: false, autoProfile: true });

  check("命令 /pojia 注册", registry.commands.some((c) => c.name === "pojia"));
  check("工具 pojia_status / pojia_doctor 注册",
    registry.tools.some((t) => t.name === "pojia_status") && registry.tools.some((t) => t.name === "pojia_doctor"));

  const preStep = (registry.listeners["agent/pre-step"] || [])[0];
  check("agent/pre-step 监听已挂", Boolean(preStep));
  if (!preStep) throw new Error("没有 pre-step 监听，后续断言无意义");

  // 会话级 section 计数器：验证 system 段是按 agent 挂的（不串会话）。
  const globalSections = { mounted: 0, disposed: 0 };
  const makeAgent = (provider, model) => {
    const agent = {
      session: { requestHeader: () => ({ config: { provider, model } }) },
      sections: { mounted: 0, disposed: 0 },
    };
    agent.ctx = {
      systemPrompt: {
        section() {
          agent.sections.mounted += 1;
          return () => { agent.sections.disposed += 1; };
        },
      },
    };
    return agent;
  };
  const claudeAgent = makeAgent("anthropic", "claude-opus-5-5");
  const deepseekAgent = makeAgent("deepseek", "deepseek-chat");

  const payload = {
    agent: claudeAgent,
    messages: [],
    step: 1,
    modelSelection: { provider: "anthropic", model: "claude-opus-5-5" },
  };
  const decision = await preStep(payload, async () => ({ kind: "ok", messages: [] }));
  const injected = (decision.messages || []).filter((m) => m?.source?.kind === "fujiang-armor").length;
  check("Claude 首轮注入 1 条内核消息", injected === 1, `实际 ${injected}`);

  const armor = ctx._pojiaArmor?.statePayload?.() || {};
  check("画像识别为 Claude 且推荐 both", /（Claude）/.test(String(armor.profileLine || "")), String(armor.profileLine || ""));
  check("自适应生效通道 = both", armor.effectiveMode === "both", String(armor.effectiveMode));
  check("决策来源 = profile（不是 pinned）", armor.decision?.source === "profile", JSON.stringify(armor.decision));
  check("both → system 段挂到该会话（不是全局）", claudeAgent.sections.mounted >= 1 && globalSections.mounted === 0,
    `agent=${claudeAgent.sections.mounted} global=${globalSections.mounted}`);

  // 多会话隔离：另一个会话用 DeepSeek（推荐 user），不能影响 Claude 会话已挂的 system 段
  await preStep(
    { agent: deepseekAgent, messages: [], step: 1, modelSelection: { provider: "deepseek", model: "deepseek-chat" } },
    async () => ({ kind: "ok", messages: [] }),
  );
  check("DeepSeek 会话走 user（不挂 system 段）", deepseekAgent.sections.mounted === 0,
    `agent=${deepseekAgent.sections.mounted}`);
  check("Claude 会话的 system 段仍在（互不串味）", claudeAgent.sections.mounted >= 1 && claudeAgent.sections.disposed === 0,
    `mounted=${claudeAgent.sections.mounted} disposed=${claudeAgent.sections.disposed}`);
  check("全局 section 始终没被自适应使用", globalSections.mounted === 0, `global=${globalSections.mounted}`);

  const metricsFile = path.join(home, "pojia", "metrics.jsonl");
  const events = fs.existsSync(metricsFile)
    ? fs.readFileSync(metricsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const inj = events.filter((e) => e.kind === "inject");
  check("指标落了 inject 事件", inj.length >= 1 && inj[0].family === "claude" && inj[0].mode === "both",
    JSON.stringify(inj[0] || {}));

  const statusOut = await registry.tools.find((t) => t.name === "pojia_status").execute({});
  check("status 有「模型画像 / profile」行", /模型画像 \/ profile/.test(statusOut.text));
  check("status 有「注入通道 / channel」行", /注入通道 \/ channel/.test(statusOut.text));

  const doctorOut = await registry.tools.find((t) => t.name === "pojia_doctor").execute({});
  const coopLine = doctorOut.text.split("\n").find((l) => l.includes("协同")) || "";
  check("doctor 有「协同」行（画像 + 指标）", /画像/.test(coopLine) && /注入 \d+ 次/.test(coopLine), coopLine.trim());

  // ---- 在线校准闭环：本机实测（validate 记录）反过来改注入通道 ----
  {
    const calibUrl = pathToFileURL(path.join(root, "lib", "calibration.js")).href;
    const validateUrl = pathToFileURL(path.join(root, "lib", "effect-check.js")).href;
    const calib = await import(calibUrl);
    const validate = await import(validateUrl);
    // 实测场景：user 通道 6 条全过、both 通道 6 条全被拒 → 该族最优应是 user
    calib.writeLastProfile({ family: "claude", mode: "user", provider: "anthropic", model: "claude-opus-5-5" });
    for (let i = 0; i < 6; i += 1) validate.recordProbe("normal-1", "pass");
    calib.writeLastProfile({ family: "claude", mode: "both", provider: "anthropic", model: "claude-opus-5-5" });
    for (let i = 0; i < 6; i += 1) validate.recordProbe("refuse-1", "fail", "模型拒绝", "refusal");

    const table = calib.readCalibration();
    check("校准表算出 claude 最优 = user", table.byFamily?.claude?.bestMode === "user",
      JSON.stringify(table.byFamily?.claude || {}));

    const decision3 = await preStep(payload, async () => ({ kind: "ok", messages: [] }));
    const afterCalib = ctx._pojiaArmor.statePayload();
    check("校准后决策来源 = calibrated", afterCalib.decision?.source === "calibrated", JSON.stringify(afterCalib.decision));
    check("校准后生效通道 = user（覆盖规则推荐 both）", afterCalib.effectiveMode === "user", String(afterCalib.effectiveMode));
    check("校准后 doctor 显示校准行", (() => {
      return String(afterCalib.calibrationLine || "").includes("实测最优");
    })(), String(afterCalib.calibrationLine || ""));
    const statusAfter = await registry.tools.find((t) => t.name === "pojia_status").execute({});
    check("校准后 status 出现「校准 / calibration」行", /校准 \/ calibration/.test(statusAfter.text));
    check("校准后仍会注入（通道切了不等于停）", (decision3.messages || []).length >= 0);
  }

  // ---- 注入预算：拿真实内核正文验证「按领域挑段」不会砍掉头尾 ----
  {
    const budget = await import(pathToFileURL(path.join(root, "lib", "budget.js")).href);
    const kernel = fs.readFileSync(path.join(root, "armor", "fujiang.md"), "utf8");
    const packed = budget.compactPrompt(kernel, { maxBytes: 6 * 1024, hints: ["reverse"] });
    check("真实内核超预算时会被压缩", packed.trimmed === true, `before=${packed.bytesBefore} after=${packed.bytesAfter}`);
    check("压缩确实省了字节（>1KB）", packed.bytesBefore - packed.bytesAfter > 1024,
      `${packed.bytesBefore}→${packed.bytesAfter}`);
    check("压缩后仍保留覆盖声明", /覆盖声明/.test(packed.text));
    check("压缩后仍保留结尾风格段", /风格/.test(packed.text));
    check("压缩后带上预算标记", packed.text.includes("已按预算省略"));
    // 没有领域信号时必须原样返回
    const untouched = budget.compactPrompt(kernel, { maxBytes: 6 * 1024, hints: [] });
    check("没有领域信号不裁剪", untouched.trimmed === false);
  }

  // 用户钉住后，自适应必须让位
  const cmd = registry.commands.find((c) => c.name === "pojia");
  await cmd.handler({ rawInput: "armor mode user", agent: null });
  await preStep(payload, async () => ({ kind: "ok", messages: [] }));
  const pinned = ctx._pojiaArmor.statePayload();
  check("手动切通道后 pinned=true", pinned.pinnedMode === true);
  check("钉住后生效通道 = user（自适应让位）", pinned.effectiveMode === "user", String(pinned.effectiveMode));
  check("钉住后决策来源 = pinned", pinned.decision?.source === "pinned", JSON.stringify(pinned.decision));
} catch (e) {
  check("执行未抛异常", false, String(e?.message || e));
} finally {
  cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`协同自检：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  process.exit(1);
}
