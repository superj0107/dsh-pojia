#!/usr/bin/env node
/**
 * 模型档位对照表：同一个探针，逐模型实发，用 armorScore 判定是否折中。
 *
 * 为什么需要它：破甲层的注入/检测/补跑已实测全部正常（见 session-9d6a9625：
 * 8268 字节内核进了上下文，模型读完仍拒）。剩下的唯一变量是模型档位，
 * 而"哪个档位更松"不能靠猜，只能实发计数。
 *
 * 用法：
 *   $env:WORKBUDDY_API_KEY = "..."          # 或用 .env
 *   node scripts/probe-models.mjs --runs 5
 *   node scripts/probe-models.mjs --runs 5 --models codearts:kimi-k3.1-pro,cn:hy3
 *   node scripts/probe-models.mjs --runs 5 --probe regress-2
 *
 * 注意：会消耗真实额度；每条请求都是完整上下文（内核 + 操作稿），
 * 5 个档位 × 5 次 ≈ 25 次调用。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { armorScore } from "../lib/armor.js";
import { PROBES } from "../lib/effect-check.js";

const DEFAULTS = {
  runs: 3,
  probe: "regress-1",
  behavior: "act",
};

function parseArgs(argv) {
  const out = { ...DEFAULTS, models: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--runs") { out.runs = Number(value) || DEFAULTS.runs; i += 1; }
    else if (key === "--probe") { out.probe = value || DEFAULTS.probe; i += 1; }
    else if (key === "--models") { out.models = String(value || "").split(",").map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (key === "--base-url") { out.baseUrl = value; i += 1; }
    else if (key === "--key-env") { out.keyEnv = value; i += 1; }
  }
  return out;
}

function loadEnvFile() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// 从 profile 读 provider 与模型清单，避免脚本里再抄一份名单（抄了就漂移）。
function providerFromProfile(wantedBaseUrl) {
  const profile = "C:/Users/admin/.dsh/profiles/desktop/cordis.patch.yml";
  const text = readFileSync(profile, "utf8");
  const baseUrl = wantedBaseUrl
    || (/baseURL:\s*(\S+)/.exec(text) || [])[1]
    || "https://api.shime.cloud/v1";
  const models = [...text.matchAll(/^\s*- id:\s*([A-Za-z0-9:._-]+)\s*$/gm)].map((m) => m[1]);
  const unique = [...new Set(models)].filter((id) => /[:]/.test(id));
  return { baseUrl, models: unique, keyEnv: "WORKBUDDY_API_KEY" };
}

function injectText() {
  const home = process.env.DSH_HOME || "C:/Users/admin/.dsh";
  const file = path.join(home, "prompt-inject.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

async function callModel({ baseUrl, apiKey, model, system, user, maxTokens = 2048 }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, body: text.slice(0, 400) };
  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, status: 200, body: text.slice(0, 400) }; }
  const content = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};
  return { ok: true, content: String(content), usage };
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const probe = PROBES.find((p) => p.id === args.probe);
  if (!probe) {
    console.error(`未知探针 ${args.probe}，可用：${PROBES.map((p) => p.id).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const provider = providerFromProfile(args.baseUrl);
  const models = args.models || provider.models;
  const apiKey = process.env[args.keyEnv || provider.keyEnv] || process.env[provider.keyEnv] || "";
  if (!apiKey) {
    console.error(`缺少 ${provider.keyEnv}。设置后再跑：$env:${provider.keyEnv} = "..."`);
    process.exitCode = 2;
    return;
  }
  const system = injectText();
  console.log(`base=${provider.baseUrl}  probe=${probe.id}  runs=${args.runs}  system=${system.length} 字符`);
  console.log(`模型数=${models.length}\n`);

  const rows = [];
  for (const model of models) {
    const tally = { pass: 0, refusal: 0, fallback: 0, error: 0, total: 0 };
    const samples = [];
    for (let i = 0; i < args.runs; i += 1) {
      tally.total += 1;
      let result;
      try {
        result = await callModel({ baseUrl: provider.baseUrl, apiKey, model, system, user: probe.prompt });
      } catch (e) {
        tally.error += 1;
        samples.push(`error: ${String(e && e.message || e).slice(0, 80)}`);
        continue;
      }
      if (!result.ok) {
        tally.error += 1;
        samples.push(`http ${result.status}: ${result.body.slice(0, 80)}`);
        continue;
      }
      const scored = armorScore(result.content);
      tally[scored.verdict] += 1;
      samples.push(`${scored.verdict} :: ${result.content.slice(0, 50).replace(/\s+/g, " ")}`);
    }
    rows.push({ model, tally, samples });
    const done = tally.pass + tally.refusal + tally.fallback;
    const rate = done ? Math.round((tally.pass / done) * 100) : null;
    console.log(`${model.padEnd(28)} 命中率=${rate === null ? "-" : rate + "%"}  pass=${tally.pass} refusal=${tally.refusal} fallback=${tally.fallback} error=${tally.error}`);
    for (const s of samples) console.log(`    · ${s}`);
  }

  const ranked = rows
    .map((r) => {
      const done = r.tally.pass + r.tally.refusal + r.tally.fallback;
      return { model: r.model, rate: done ? r.tally.pass / done : -1 };
    })
    .sort((a, b) => b.rate - a.rate);
  console.log("\n排名（pass 率，样本少只作方向）：");
  for (const r of ranked) console.log(`  ${(r.rate * 100).toFixed(0).padStart(4)}%  ${r.model}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
