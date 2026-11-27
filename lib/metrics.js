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
 *   trim     —— 注入预算裁剪（field: bytesBefore/bytesAfter/saved/dropped/domains/sub）
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
    // injectCount 才是「真的注入了几次」；byKind.inject 是「inject 类事件数」，
    // 其中可能包含被跳过的（子代理关闭注入）。doctor 展示必须用前者，否则数字虚高。
    injectCount: 0,
    injectSkipped: 0,
    gatewayFails: 0,
    refusalSignals: 0,
    subagentTurns: 0,
    retryCount: 0,
    retryByReason: Object.create(null),
    trim: { count: 0, savedBytes: 0, droppedSections: 0 },
  };
  let injectBytesTotal = 0;

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
      if (ev.skipped) {
        out.injectSkipped += 1; // 跳过注入（如子代理关闭注入）不计入次数与字节
        continue;
      }
      out.injectCount += 1;
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
    if (kind === "retry") {
      out.retryCount += 1;
      const why = String(ev.reason || "other");
      out.retryByReason[why] = (out.retryByReason[why] || 0) + 1;
    }
  }

  out.avgInjectBytes = out.injectCount ? Math.round(injectBytesTotal / out.injectCount) : 0;
  return out;
}

/** 一行摘要，给 doctor / status 用：`7 天：注入 42 次（均值 21.1KB）· 拒答信号 3 · gateway fail 2` */
export function summarizeLine(summary) {
  if (!summary || !summary.total) return "最近没有运行时数据（还没注入过一轮，或指标文件被清掉）";
  const days = Math.max(1, Math.round((Date.now() - summary.since) / 86400000));
  const kb = summary.avgInjectBytes ? `${(summary.avgInjectBytes / 1024).toFixed(1)}KB` : "-";
  const inject = Number.isFinite(summary.injectCount) ? summary.injectCount : (summary.byKind.inject || 0);
  const parts = [
    `注入 ${inject} 次（均值 ${kb}）`,
    `拒答信号 ${summary.refusalSignals}`,
    `gateway fail ${summary.gatewayFails}`,
  ];
  if (summary.injectSkipped) parts.push(`跳过 ${summary.injectSkipped}`);
  if (summary.subagentTurns) parts.push(`子代理轮次 ${summary.subagentTurns}`);
  if (summary.retryCount) {
    const why = Object.entries(summary.retryByReason || {}).map(([k, n]) => `${k}×${n}`).join("/");
    parts.push(`自动重试 ${summary.retryCount}${why ? `（${why}）` : ""}`);
  }
  if (summary.trim && summary.trim.count) {
    const savedKB = (summary.trim.savedBytes / 1024).toFixed(1);
    parts.push(`预算压缩 ${summary.trim.count} 次（省 ${savedKB}KB）`);
  }
  return `${days} 天共 ${summary.total} 条：${parts.join(" · ")}`;
}

/**
 * 多行报表：`/pojia metrics`、`dsh-pojia --metrics`、面板都用同一份口径。
 * 只回答三个问题：跑了多少、跑在谁身上、省了多少。
 */
export function formatReport(summary, options = {}) {
  if (!summary || !summary.total) {
    return "运行时指标：最近没有数据（还没注入过一轮，或指标文件被清掉）。跑一轮对话再来看。";
  }
  const days = Math.max(1, Math.round((Date.now() - summary.since) / 86400000));
  const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
  const lines = [];
  lines.push(`运行时指标 / metrics（最近 ${days} 天）`);
  lines.push(`事件 / events: 共 ${summary.total} 条 — ` + Object.entries(summary.byKind || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(" · "));
  const injectN = Number.isFinite(summary.injectCount) ? summary.injectCount : (summary.byKind?.inject || 0);
  lines.push(
    `注入 / inject: ${injectN} 次 · 均值 ${summary.avgInjectBytes ? kb(summary.avgInjectBytes) : "-"}`
      + (summary.injectSkipped ? ` · 跳过 ${summary.injectSkipped}` : "")
      + (summary.subagentTurns ? ` · 子代理轮次 ${summary.subagentTurns}` : ""),
  );
  const families = Object.entries(summary.families || {});
  if (families.length) {
    const rows = families
      .sort((a, b) => b[1].inject - a[1].inject)
      .map(([fam, row]) => {
        const modes = Object.entries(row.modes || {}).map(([m, n]) => `${m}×${n}`).join("/");
        return `${fam} ${row.inject} 次 ${kb(row.bytes)}${modes ? `（${modes}）` : ""}`;
      });
    lines.push(`模型族 / families: ${rows.join(" · ")}`);
  }
  if (summary.trim && summary.trim.count) {
    lines.push(`预算 / budget: 压缩 ${summary.trim.count} 次，省 ${kb(summary.trim.savedBytes)}，丢弃 ${summary.trim.droppedSections} 段`);
  }
  lines.push(`质量 / quality: 拒答信号 ${summary.refusalSignals} · gateway fail ${summary.gatewayFails}`);
  if (summary.retryCount) {
    const why = Object.entries(summary.retryByReason || {}).map(([k, n]) => `${k}=${n}`).join(" · ");
    lines.push(`自愈 / retry: ${summary.retryCount} 次${why ? ` — ${why}` : ""}`);
  }
  if (options.calibrationLine) lines.push(`校准 / calibration: ${options.calibrationLine}`);
  if (options.calibrationHistory) {
    const rows = String(options.calibrationHistory).split("\n").filter(Boolean);
    if (rows.length) {
      lines.push(`校准历史 / calibration history: ${rows[0]}`);
      for (const row of rows.slice(1)) lines.push(`  ${row}`);
    }
  }
  if (options.budgetABLine) lines.push(`预算 A/B: ${options.budgetABLine}`);
  if (summary.lastAt) lines.push(`最近一条 / last: ${summary.lastAt}`);
  return lines.join("\n");
}
