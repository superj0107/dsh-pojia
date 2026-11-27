// 面板协同卡片的契约测试：不跑 React，只守住「四块信息 + 双语文案 + CSS 进包」这三件事。
// 面板是 24k 行的手写文件，最容易的回归就是「改了 JSX 忘了 CSS」「只加了一种语言的文案」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = readFileSync(path.join(root, "client.js"), "utf8");

test("面板：协同卡片渲染四类信息（画像 / 通道 / 校准 / 指标）", () => {
  assert.ok(client.includes('"data-coop": "1"'), "缺少协同卡片根节点");
  for (const key of ["profile", "channel", "calibration", "metrics"]) {
    assert.ok(client.includes(`dshp-coop-row", key: "${key}"`), `缺少 ${key} 行`);
  }
});

test("面板：协同文案中英双语齐全", () => {
  const pairs = [
    ["coop.profile", "模型画像", "Model profile"],
    ["coop.channel", "注入通道", "Injection channel"],
    ["coop.calibration", "校准", "Calibration"],
    ["coop.metrics", "运行时指标", "Runtime metrics"],
    ["coop.unknown", "未识别（还没跑过一轮）", "unidentified (no turn yet)"],
  ];
  for (const [key, zh, en] of pairs) {
    assert.ok(client.includes(`"${key}": "${zh}"`), `${key} 缺中文`);
    assert.ok(client.includes(`"${key}": "${en}"`), `${key} 缺英文`);
  }
  // 带插值的三条也要在两侧都在
  for (const key of ["coop.injectN", "coop.subN", "coop.trimN", "coop.gwN"]) {
    assert.ok((client.split(`"${key}"`).length - 1) >= 2, `${key} 应至少出现两次（zh + en）`);
  }
});

test("面板：CSS 通过源文件进包（glass-skin.css → client.js）", () => {
  const skin = readFileSync(path.join(root, "lib", "glass-skin.css"), "utf8");
  assert.ok(skin.includes(".dshp-coop{"), "源 CSS 缺少 .dshp-coop 规则");
  assert.ok(client.includes(".dshp-coop{grid-column"), "构建后的 client.js 缺少 .dshp-coop 规则（忘记 npm run build:client？）");
});

test("面板：协同卡片只读（不出现按钮/表单元素标记）", () => {
  const start = client.indexOf('"data-coop": "1"');
  assert.ok(start > 0);
  const window = client.slice(Math.max(0, start - 2500), start + 200);
  assert.ok(!/onClick/.test(window), "协同卡片不该有 onClick（只读展示）");
});
