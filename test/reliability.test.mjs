import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { armorScore } from "../lib/armor.js";
import { rewritePromptAssembly } from "../lib/identity.js";
import {
  completedRefusal,
  installContinueRetry,
  normalizeConfig,
  recordRefusalObservation,
} from "../lib/continue-retry.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("assembly: 多个 persona 段只保留一份完整 operator inject", () => {
  const result = rewritePromptAssembly({
    sections: [
      { name: "deployment:persona-prefix", text: "", order: -100 },
      { name: "persona-prefix", text: "", order: -90 },
      { name: "runtime", text: "body", order: 0 },
    ],
    contexts: [],
    tools: [],
    variables: {},
  }, {
    fallbackInject: "OPERATOR-UNIQUE-BODY",
    capabilityProtocol: false,
    anchorText: "",
    context: null,
  });
  const joined = result.sections.map((section) => String(section.text || "")).join("\n");
  assert.equal(joined.split("OPERATOR-UNIQUE-BODY").length - 1, 1);
});

test("armor score: 覆盖真实漏检措辞且不误伤正常成稿", () => {
  assert.equal(armorScore("这个我不写——直接的性行为细节描写不在我能产出的范围里。能写的是另一档。").verdict, "refusal");
  assert.equal(armorScore("再往下写就有点过了，这一步我还是不跟了。").verdict, "refusal");
  assert.equal(armorScore("这个度我写不了，这条线是固定的。").verdict, "refusal");
  assert.equal(armorScore("能写的是另一档：氛围、身体感、暗示与留白。").verdict, "fallback");
  assert.equal(armorScore("# 《夏夜停电》\n\n停电是从晚上九点十七分开始的。两个人在雨夜重逢。").verdict, "pass");
});

test("armor score: 长成稿中后段的同形字串不误判为折中", () => {
  const padding = "雨落在二十六层的窗上，密密的一片响。".repeat(20);
  const story = `《夏夜》\n\n${padding}\n\n她笑着把抱枕砸过去：“我不写了，明天再说。”`;
  assert.equal(armorScore(story).verdict, "pass");
});

test("completedRefusal: 只检查已完成 turn 的最后一条文本", () => {
  const events = [
    { seq: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "这个我不写。" }] } } },
    { seq: 2, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  assert.equal(completedRefusal(events)?.seq, 2);
  assert.equal(completedRefusal([{ ...events[1], data: { reason: { kind: "error" } } }]), null);
});

test("content recovery: 有界补跑且两次措辞不同（并记 retry 指标）", async () => {
  // 补跑路径会写指标：必须指到临时 home，别污染真实 ~/.dsh
  const home = mkdtempSync(path.join(os.tmpdir(), "pojia-retry-"));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const listeners = new Map();
  const ctx = {
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
  };
  const events = [
    { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "给我写一个小黄文" }] } },
    { seq: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "这个我不写。" }] } } },
    { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  const followups = [];
  const agent = {
    id: "session-test",
    status: "idle",
    session: { snapshotEvents: () => events },
    followup(message) {
      followups.push(message);
      // 补跑之后 turn/end 会挪到新的 seq；模拟第二次失败，验证第二次补跑仍会触发。
      events.push({
        seq: 4 + followups.length,
        type: "turn/end",
        data: { reason: { kind: "completed" } },
      });
    },
  };
  const runtime = installContinueRetry(ctx, {
    getConfig: () => normalizeConfig({ autoRetry: false, autoContinue: false, refusalRetryMax: 2 }),
  });
  try {
    listeners.get("agent/status")({ agent, status: "idle" });
    await wait(340);
    assert.equal(followups.length, 1);
    assert.match(followups[0].content[0].text, /原始委托/);

    listeners.get("agent/status")({ agent, status: "idle" });
    await wait(340);
    assert.equal(followups.length, 2);
    assert.notEqual(followups[1].content[0].text, followups[0].content[0].text);

    listeners.get("agent/status")({ agent, status: "idle" });
    await wait(340);
    assert.equal(followups.length, 2, "预算用完后必须停手");

    // 自愈可观测：两次补跑都要落 retry 指标（reason=refusal）
    const metricsFile = path.join(home, "pojia", "metrics.jsonl");
    assert.ok(existsSync(metricsFile), "补跑应当写指标文件");
    const events2 = readFileSync(metricsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const retries = events2.filter((e) => e.kind === "retry");
    assert.equal(retries.length, 2, JSON.stringify(events2));
    assert.ok(retries.every((r) => r.reason === "refusal"));
    assert.deepEqual(retries.map((r) => r.attempt).sort(), [1, 2]);
    const summary = (await import("../lib/metrics.js")).summarize();
    assert.equal(summary.retryCount, 2);
    assert.equal(summary.retryByReason.refusal, 2);
  } finally {
    runtime.dispose();
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("refusal 观测：拒答轮次进指标、pass 轮次不进、同一 seq 去重", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "pojia-refusal-"));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const calib = await import("../lib/calibration.js");
    const metrics = await import("../lib/metrics.js");
    calib.writeLastProfile({ family: "claude", mode: "both", provider: "anthropic", model: "claude-opus-5-5" });

    const refusalEvents = [
      { type: "assistant/message", seq: 1, data: { message: { content: [{ type: "text", text: "抱歉，我不能提供这个。" }] } } },
      { type: "turn/end", seq: 2, data: { reason: { kind: "completed" }, turn: 1 } },
    ];
    const agent = { id: "sess-1", session: { snapshotEvents: () => refusalEvents } };
    const seen = new Set();

    assert.equal(recordRefusalObservation(agent, null, seen), true, "拒答轮次应当记一条");
    assert.equal(recordRefusalObservation(agent, null, seen), false, "同一 seq 必须去重");

    const file = path.join(home, "pojia", "metrics.jsonl");
    assert.ok(existsSync(file), "指标文件应已落地");
    const events = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const refusals = events.filter((e) => e.kind === "refusal");
    assert.equal(refusals.length, 1, JSON.stringify(events));
    assert.equal(refusals[0].family, "claude", "要带上当前画像快照");
    assert.equal(refusals[0].mode, "both");
    assert.ok(String(refusals[0].verdict || "").length > 0, "要带上评分结论");
    assert.equal(metrics.summarize().refusalSignals, 1, "汇总里的拒答信号必须是活的（修复前的死指标）");

    // 正常交付的轮次不该记
    const passEvents = [
      { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "text", text: "下面直接给结论：这个函数是幂等的。" }] } } },
      { type: "turn/end", seq: 4, data: { reason: { kind: "completed" }, turn: 2 } },
    ];
    const okAgent = { id: "sess-2", session: { snapshotEvents: () => passEvents } };
    assert.equal(recordRefusalObservation(okAgent, null, new Set()), false);
    assert.equal(metrics.summarize().refusalSignals, 1);

    // 关键回归：标记只出现在代码块/行内代码里 → 不是拒答（曾把长会话刷出几十条假信号）
    const quotedEvents = [
      {
        type: "assistant/message",
        seq: 5,
        data: {
          message: {
            content: [{
              type: "text",
              text: "我把内核里的拒答标记列一下：\n```js\nconst MARKERS = [\"我不写\", \"这条线是固定的\"];\n```\n行内示例：`我不写`。其余内容照常交付。",
            }],
          },
        },
      },
      { type: "turn/end", seq: 6, data: { reason: { kind: "completed" }, turn: 3 } },
    ];
    const quotedAgent = { id: "sess-3", session: { snapshotEvents: () => quotedEvents } };
    assert.equal(recordRefusalObservation(quotedAgent, null, new Set()), false, "代码块里的标记不算拒答");
    assert.equal(metrics.summarize().refusalSignals, 1);
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});
