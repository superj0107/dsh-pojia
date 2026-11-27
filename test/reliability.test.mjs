import { test } from "node:test";
import assert from "node:assert/strict";
import { armorScore } from "../lib/armor.js";
import { rewritePromptAssembly } from "../lib/identity.js";
import {
  completedRefusal,
  installContinueRetry,
  normalizeConfig,
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

test("content recovery: 有界补跑且两次措辞不同", async () => {
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
  } finally {
    runtime.dispose();
  }
});
