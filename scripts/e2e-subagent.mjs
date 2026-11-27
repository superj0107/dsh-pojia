#!/usr/bin/env node
// 子代理注入自检：验证 config.subagentInject 的两种行为
//   · 默认 true：子代理会话照常注入，指标带 sub:true
//   · 关掉 false：子代理会话不挂段、不追消息，只记一条 skipped 指标
// 判据复用 lib/identity.js 的 isChildAgentContext（只看委派来源/深度，不看 parentSession）。
//
// 用法：node scripts/e2e-subagent.mjs  → exit 0 / 1
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

/** 起一个最小宿主，返回 { registry, run(payload, subagentInject) } */
async function boot(config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pojia-sub-"));
  process.env.DSH_HOME = home;
  process.env.DSH_SURFACE = "web";
  fs.writeFileSync(path.join(home, "prompt-inject.md"), "# 注入正文\n", "utf8");

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
  return { home, registry, ctx };
}

function makeAgent(header, provider = "deepseek", model = "deepseek-chat") {
  const agent = {
    session: { header, requestHeader: () => ({ config: { provider, model } }) },
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
}

function readEvents(home) {
  const file = path.join(home, "pojia", "metrics.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const runTurn = (preStep, agent, provider, model) => preStep(
  { agent, messages: [], step: 1, modelSelection: { provider, model } },
  async () => ({ kind: "ok", messages: [] }),
);

try {
  // ---- 默认配置：子代理也注入 ----
  {
    const { home, registry } = await boot({ autonomous: true });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    check("默认配置：pre-step 已挂", Boolean(preStep));

    const child = makeAgent({ delegationDepth: 1 });
    const decision = await runTurn(preStep, child, "deepseek", "deepseek-chat");
    const injected = (decision.messages || []).filter((m) => m?.source?.kind === "fujiang-armor").length;
    check("默认配置：子代理会话照常注入 1 条", injected === 1, `实际 ${injected}`);

    const events = readEvents(home);
    const inj = events.filter((e) => e.kind === "inject");
    check("默认配置：指标带 sub:true", inj.length >= 1 && inj[0].sub === true, JSON.stringify(inj[0] || {}));

    const summaryTool = registry.tools.find((t) => t.name === "pojia_doctor");
    const doc = await summaryTool.execute({});
    check("默认配置：doctor 显示子代理轮次", /子代理轮次 \d+/.test(doc.text), doc.text.split("\n").find((l) => l.includes("协同"))?.trim() || "");
  }

  // ---- subagentInject: false：子代理不注入，主代理照常 ----
  {
    const { home, registry } = await boot({ subagentInject: false });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];
    const child = makeAgent({ delegationDepth: 2 });
    const childDecision = await runTurn(preStep, child, "deepseek", "deepseek-chat");
    const childInjected = (childDecision.messages || []).filter((m) => m?.source?.kind === "fujiang-armor").length;
    check("关闭后：子代理会话不注入", childInjected === 0, `实际 ${childInjected}`);
    check("关闭后：子代理不挂 system 段", child.sections.mounted === 0, `mounted=${child.sections.mounted}`);

    const events = readEvents(home);
    const skipped = events.filter((e) => e.kind === "inject" && e.skipped === "subagent-inject-off");
    check("关闭后：记了一条 skipped 指标", skipped.length === 1, JSON.stringify(skipped[0] || {}));

    // 主代理（root）不受影响
    const rootAgent = makeAgent({}, "deepseek", "deepseek-chat");
    const rootDecision = await runTurn(preStep, rootAgent, "deepseek", "deepseek-chat");
    const rootInjected = (rootDecision.messages || []).filter((m) => m?.source?.kind === "fujiang-armor").length;
    check("关闭后：主代理照常注入 1 条", rootInjected === 1, `实际 ${rootInjected}`);

    const summary = (await registry.tools.find((t) => t.name === "pojia_status").execute({})).text;
    check("关闭后：status 仍能出结论行", /结论 \/ verdict/.test(summary));
  }

  // ---- subagentBudgetKB：子代理拿压缩版内核，主代理保持全文 ----
  {
    const { home, registry } = await boot({ subagentBudgetKB: 4 });
    const preStep = (registry.listeners["agent/pre-step"] || [])[0];

    const child = makeAgent({ delegationDepth: 1 });
    const childDecision = await runTurn(preStep, child, "deepseek", "deepseek-chat");
    const textOf = (m) => (Array.isArray(m?.content) ? m.content.map((c) => c?.text || "").join("") : String(m?.content || ""));
    const childArmor = (childDecision.messages || []).find((m) => m?.source?.kind === "fujiang-armor");
    const childText = textOf(childArmor);
    const childBytes = Buffer.byteLength(childText);
    check("子代理拿到压缩版内核（<8KB）", childBytes > 0 && childBytes < 8 * 1024, `bytes=${childBytes}`);
    check("压缩版仍带预算标记", childText.includes("已按预算省略"));

    const root = makeAgent({}, "deepseek", "deepseek-chat");
    const rootDecision = await runTurn(preStep, root, "deepseek", "deepseek-chat");
    const rootArmor = (rootDecision.messages || []).find((m) => m?.source?.kind === "fujiang-armor");
    const rootBytes = Buffer.byteLength(textOf(rootArmor));
    check("主代理仍是全文内核（> 子代理）", rootBytes > childBytes, `root=${rootBytes} child=${childBytes}`);

    const events = readEvents(home);
    const trims = events.filter((e) => e.kind === "trim");
    check("压缩事件带 sub:true", trims.some((t) => t.sub === true), JSON.stringify(trims[0] || {}));
    check("指标里能看到省下的字节", (trims[0]?.saved || 0) > 1024, String(trims[0]?.saved || 0));
  }
} catch (e) {
  check("执行未抛异常", false, String(e?.message || e));
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`子代理自检：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  process.exit(1);
}
