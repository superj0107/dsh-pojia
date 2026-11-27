#!/usr/bin/env node
// 运行时状态自检（对应第三轮复审找出的几个真实坑）：
//   1. 旧版状态文件（有 mode、没有 pinnedMode）升级后不能被自适应覆盖
//   2. 配置里写 armorMode: both 必须真的生效（MODE_CHANNEL 曾漏 both → 静默变 user）
//   3. off → on 之后 system 段必须重新挂上（曾因 WeakMap 缓存永久缺失）
//   4. subagentInject:false 时，both 模型的子代理不许挂 system 段
//
// 用法：node scripts/e2e-armor-state.mjs → exit 0 / 1
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function makeAgent({ id, provider = "anthropic", model = "claude-opus-5-5", header = {} }) {
  const agent = {
    id,
    session: { id, header, requestHeader: () => ({ config: { provider, model } }) },
    sections: { mounted: 0, disposed: 0, texts: [] },
  };
  agent.ctx = {
    systemPrompt: {
      section(def) {
        agent.sections.mounted += 1;
        agent.sections.texts.push(String(def?.text || ""));
        return () => { agent.sections.disposed += 1; };
      },
    },
  };
  return agent;
}

async function boot(config, { preState = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pojia-armor-state-"));
  process.env.DSH_HOME = home;
  process.env.DSH_SURFACE = "web";
  fs.writeFileSync(path.join(home, "prompt-inject.md"), "# 注入正文\n", "utf8");
  if (preState) fs.writeFileSync(path.join(home, "dsh-pojia-armor.state.json"), JSON.stringify(preState, null, 2), "utf8");

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
  mod.apply(ctx, { enabled: true, autoApplyOnStart: false, autoProfile: true, ...config });
  return { home, registry, ctx, mod };
}

const turn = (preStep, agent) => preStep(
  { agent, messages: [], step: 1, modelSelection: { provider: agent.session.requestHeader().config.provider, model: agent.session.requestHeader().config.model } },
  async () => ({ kind: "ok", messages: [] }),
);

try {
  // ---- 1) 旧状态文件迁移：mode=legacy、没有 pinnedMode ----
  {
    const { registry, ctx } = await boot({}, { preState: { version: 1, enabled: true, mode: "legacy", updatedAt: "2026-11-01T00:00:00.000Z" } });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    check("旧状态：pre-step 已挂", Boolean(preStep));
    const p0 = ctx._pojiaArmor.statePayload();
    check("旧状态：mode 保留为 legacy", p0.mode === "legacy", String(p0.mode));
    check("旧状态：视为已钉住（不被自适应覆盖）", p0.pinnedMode === true, String(p0.pinnedMode));
    // 跑一轮 Claude（规则推荐 both）——不得覆盖用户原来的 legacy
    const agent = makeAgent({ id: "sess-legacy" });
    await turn(preStep, agent);
    const p1 = ctx._pojiaArmor.statePayload();
    check("旧状态：跑一轮后仍是 legacy", p1.effectiveMode === "legacy", String(p1.effectiveMode));
    check("旧状态：决策来源 = pinned", p1.decision?.source === "pinned", JSON.stringify(p1.decision));
  }

  // ---- 2) 配置 armorMode:"both" 必须真的生效 ----
  {
    const { registry, ctx } = await boot({ armorMode: "both" });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    const p = ctx._pojiaArmor.statePayload();
    check('配置 armorMode:"both"：mode = both', p.mode === "both", String(p.mode));
    check('配置 armorMode:"both"：钉住', p.pinnedMode === true, String(p.pinnedMode));
    const agent = makeAgent({ id: "sess-both" });
    await turn(preStep, agent);
    check("配置 armorMode:both：全局挂载生效（该会话不需要自挂）", agent.sections.mounted === 0,
      `agent=${agent.sections.mounted}`);
  }

  // ---- 3) off → on 之后 system 段要重新挂上 ----
  {
    const { registry, ctx } = await boot({});
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    const cmd = registry.commands.find((c) => c.name === "pojia");
    const agent = makeAgent({ id: "sess-toggle" });

    await turn(preStep, agent);
    check("off→on：首轮按会话挂上 system 段（both）", agent.sections.mounted === 1, `mounted=${agent.sections.mounted}`);

    await cmd.handler({ rawInput: "armor off", agent: null });
    check("off→on：关闭后段被摘除", agent.sections.disposed >= 1, `disposed=${agent.sections.disposed}`);

    await cmd.handler({ rawInput: "armor on", agent: null });
    await turn(preStep, agent);
    check("off→on：重新开启后段恢复挂载", agent.sections.mounted === 2,
      `mounted=${agent.sections.mounted} disposed=${agent.sections.disposed}`);
  }

  // ---- 4) subagentInject:false 时，both 模型的子代理不许挂 system 段 ----
  {
    const { registry, ctx } = await boot({ subagentInject: false });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    const child = makeAgent({ id: "sess-child", header: { delegationDepth: 1 } });
    const decision = await turn(preStep, child);
    const injected = (decision.messages || []).filter((m) => m?.source?.kind === "fujiang-armor").length;
    check("子代理关闭注入：不追加消息", injected === 0, `messages=${injected}`);
    check("子代理关闭注入：不挂 system 段（both 模型也一样）", child.sections.mounted === 0,
      `mounted=${child.sections.mounted}`);
  }
} catch (e) {
  check("执行未抛异常", false, String(e?.message || e));
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`状态自检：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  process.exit(1);
}
