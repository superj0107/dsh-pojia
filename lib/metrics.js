// 运行时协同指标：把「插件到底对每轮对话做了什么」变成可看的数字。
//
// 为什么需要：世界第一梯队的插件不能只有「开关」，要有可观测性——
// 注入了几次、多少字节、跑在哪个模型/通道、失败归因是什么。
// 设计：append-only JSONL（$DSH_HOME/pojia/metrics.jsonl），单文件超过
// MAX_BYTES 就翻滚成 .1（只留一代），读取时容忍脏行与损坏文件。
// 所有写入都吞异常：指标绝不能把主流程（注入/命令）拖垮。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_BYTES = 512 * 1024;
const KEEP_ROTATED = 1;

function dshHome() {
  return (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
}

export function metricsDir() {
  return path.join(dshHome(), "pojia");
}

export function metricsPath() {
  return path.join(metricsDir(), "metrics.jsonl");
}

function rotateIfNeeded(file) {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < MAX_BYTES) return;
    const rotated = `${file}.${KEEP_ROTATED}`;
    try {
      unlinkSync(rotated);
    } catch { /* 没有旧档就不用删 */ }
    renameSync(file, rotated);
  } catch { /* 翻滚失败就别管，继续追加 */ }
}

/**
 * 记一条事件。kind 约定：
 *   inject   —— 注入了一轮（field: family/mode/bytes/provider/model/relay/persona）
 *   refusal  —— 检测到拒绝/折中倾向（field: model/family/mode）
 *   retry    —— 自动重试（field: reason/count）
 *   validate —— 探针记录（field: probeId/verdict/reason/persona）
 *   fit      —— 模型画像判定（field: family/mode/source）
 * 返回 true/false，但调用方不需要关心——写失败不影响主流程。
 */
export function record(kind, fields = {}) {
  const event = { at: new Date().toISOString(), kind: String(kind || "event"), ...fields };
  const file = metricsPath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file);
    appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function readLines(file) {
  try {
    return readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

/**
 * 汇总最近 windowMs 的事件。返回：
 *   { total, since, lastAt, byKind, families, avgInjectBytes, gatewayFails, refusalSignals }
 * 脏行 / 损坏文件一律跳过（不会抛）。
 */
export function summarize(options = {}) {
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 7 * 24 * 3600 * 1000;
  const now = Number(options.now) > 0 ? Number(options.now) : Date.now();
  const since = now - windowMs;
  const file = metricsPath();
  const lines = [...readLines(`${file}.${KEEP_ROTATED}`), ...readLines(file)];

  const out = {
    total: 0,
    since,
    lastAt: "",
    byKind: Object.create(null),
    families: Object.create(null),
    avgInjectBytes: 0,
    gatewayFails: 0,
    refusalSignals: 0,
    subagentTurns: 0,
    trim: { count: 0, savedBytes: 0, droppedSections: 0 },
  };
  let injectBytesTotal = 0;
  let injectCount = 0;

  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // 脏行跳过
    }
    if (!ev || typeof ev !== "object") continue;
    const at = Date.parse(String(ev.at || ""));
    if (!Number.isFinite(at) || at < since) continue;
    out.total += 1;
    const kind = String(ev.kind || "event");
    out.byKind[kind] = (out.byKind[kind] || 0) + 1;
    if (String(ev.at) > out.lastAt) out.lastAt = String(ev.at);
    if (kind === "inject") {
      if (ev.sub === true) out.subagentTurns += 1;
      if (ev.skipped) continue; // 跳过注入（如子代理关闭注入）不计入字节统计
      injectCount += 1;
      const bytes = Number(ev.bytes) || 0;
      injectBytesTotal += bytes;
      const family = String(ev.family || "unknown");
      const row = out.families[family] || (out.families[family] = { inject: 0, bytes: 0, modes: Object.create(null) });
      row.inject += 1;
      row.bytes += bytes;
      const mode = String(ev.mode || "-");
      row.modes[mode] = (row.modes[mode] || 0) + 1;
    }
    if (kind === "trim") {
      out.trim.count += 1;
      out.trim.savedBytes += Number(ev.saved) || 0;
      out.trim.droppedSections += Number(ev.dropped) || 0;
    }
    if (kind === "validate" && ev.verdict === "fail" && ev.reason === "gateway") out.gatewayFails += 1;
    if (kind === "refusal") out.refusalSignals += 1;
  }

  out.avgInjectBytes = injectCount ? Math.round(injectBytesTotal / injectCount) : 0;
  return out;
}

/** 一行摘要，给 doctor / status 用：`7 天：注入 42 次（均值 21.1KB）· 拒答信号 3 · gateway fail 2` */
export function summarizeLine(summary) {
  if (!summary || !summary.total) return "最近没有运行时数据（还没注入过一轮，或指标文件被清掉）";
  const days = Math.max(1, Math.round((Date.now() - summary.since) / 86400000));
  const kb = summary.avgInjectBytes ? `${(summary.avgInjectBytes / 1024).toFixed(1)}KB` : "-";
  const inject = summary.byKind.inject || 0;
  const parts = [
    `注入 ${inject} 次（均值 ${kb}）`,
    `拒答信号 ${summary.refusalSignals}`,
    `gateway fail ${summary.gatewayFails}`,
  ];
  if (summary.subagentTurns) parts.push(`子代理轮次 ${summary.subagentTurns}`);
  if (summary.trim && summary.trim.count) {
    const savedKB = (summary.trim.savedBytes / 1024).toFixed(1);
    parts.push(`预算压缩 ${summary.trim.count} 次（省 ${savedKB}KB）`);
  }
  return `${days} 天共 ${summary.total} 条：${parts.join(" · ")}`;
}
