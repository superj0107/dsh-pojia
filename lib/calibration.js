// 在线校准：用本机实测的 validate 结果反推「每个模型族到底用哪个注入通道最有效」。
//
// 为什么要这一层：`lib/model-profile.js` 的推荐通道是**静态规则**（按厂商特性给的保守默认），
// 真实效果还得看本机链路（模型 + 中转 + 人设）。所以把 validate 的记录按
// 「模型族 × 生效通道」聚合，样本够了就用实测覆盖规则——规则负责冷启动，实测负责收敛。
//
// 数据流：
//   armor 每轮写 $DSH_HOME/pojia/armor-last.json（当前 family / mode / provider / model）
//     → effect-check record 时把它附进记录（family/mode）
//       → 本模块 calibrate() 聚合
//         → $DSH_HOME/pojia/calibration.json
//           → armor 每轮读（缓存）→ 未钉住时优先用校准通道。
//
// 原则：
//   1. 样本不足不猜（MIN_SAMPLES 门槛），宁愿用规则默认；
//   2. 只要有人设/模型族维度对不上，就退回规则，不硬套；
//   3. 纯函数统计 + 两个小 I/O 助手，好测。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const MIN_SAMPLES = 6; // 同一族 × 同一通道至少 6 条记录才敢覆盖规则
export const MIN_MARGIN = 15; // 换通道至少领先这么多「百分点」才换，防止薄差距抖动
export const MODES = Object.freeze(["user", "legacy", "both"]);

function dshHome() {
  return (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
}
export function calibrationPath() {
  return path.join(dshHome(), "pojia", "calibration.json");
}
export function lastProfilePath() {
  return path.join(dshHome(), "pojia", "armor-last.json");
}

/** armor 每轮落一次「当前画像快照」，供 validate 记录与校准使用。 */
export function writeLastProfile(snapshot) {
  try {
    const file = lastProfilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...snapshot, at: new Date().toISOString() }, null, 2), "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function readLastProfile() {
  try {
    const j = JSON.parse(readFileSync(lastProfilePath(), "utf8"));
    if (!j || typeof j !== "object") return null;
    return {
      family: String(j.family || ""),
      mode: String(j.mode || ""),
      provider: String(j.provider || ""),
      model: String(j.model || ""),
      at: String(j.at || ""),
    };
  } catch {
    return null;
  }
}

export function readCalibration() {
  try {
    const j = JSON.parse(readFileSync(calibrationPath(), "utf8"));
    if (!j || typeof j !== "object" || !j.byFamily) return { version: 1, byFamily: {} };
    return { version: 1, byFamily: j.byFamily, updatedAt: String(j.updatedAt || "") };
  } catch {
    return { version: 1, byFamily: {} };
  }
}

export function writeCalibration(data) {
  try {
    const file = calibrationPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, ...data, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function emptyStat() {
  return { pass: 0, fail: 0, gateway: 0, refusal: 0, transport: 0, other: 0 };
}

function scoreOf(stat) {
  const denom = stat.pass + stat.fail;
  if (!denom) return { rate: null, denom };
  // gateway 类失败不该算到「通道不好」头上（那是链路问题），但也不给它加分：
  // 这里用「有效失败」= fail - gateway，避免中转把某个通道冤枉死。
  const effectiveFail = Math.max(0, stat.fail - stat.gateway);
  const effectiveDenom = stat.pass + effectiveFail;
  return {
    rate: effectiveDenom ? Math.round((stat.pass / effectiveDenom) * 100) : null,
    denom,
    effectiveDenom,
  };
}

/**
 * 聚合校准表。records 里每条至少要有 {family, mode, verdict, reason}。
 * 返回：
 *   { byFamily: { claude: { modes: {both: {pass,fail,gateway,rate,samples}}, bestMode, samples, confidence, updatedAt } } }
 * confidence：'measured'（样本达标且有明确赢家）/ 'insufficient'（样本不足）/ 'tie'（打平）
 */
export function calibrate(records = [], options = {}) {
  const minSamples = Number(options.minSamples) > 0 ? Number(options.minSamples) : MIN_SAMPLES;
  const byFamily = {};
  for (const r of records) {
    const family = String(r?.family || "").trim();
    const mode = String(r?.mode || "").trim();
    if (!family || !MODES.includes(mode)) continue; // 老记录没画像 → 跳过，不硬算
    const verdict = String(r.verdict || "");
    if (verdict !== "pass" && verdict !== "fail") continue; // skip 不进分母
    const stat = byFamily[family] || (byFamily[family] = { modes: {} });
    const row = stat.modes[mode] || (stat.modes[mode] = emptyStat());
    if (verdict === "pass") row.pass += 1;
    else {
      row.fail += 1;
      const reason = String(r.reason || "other");
      if (reason === "gateway") row.gateway += 1;
      else if (reason === "refusal") row.refusal += 1;
      else if (reason === "transport") row.transport += 1;
      else row.other += 1;
    }
  }

  const out = {};
  for (const [family, stat] of Object.entries(byFamily)) {
    const modes = {};
    let best = null;
    let eligible = 0;
    for (const mode of MODES) {
      const row = stat.modes[mode];
      if (!row) continue;
      const scored = scoreOf(row);
      modes[mode] = { ...row, rate: scored.rate, samples: scored.denom, effectiveDenom: scored.effectiveDenom };
      const samples = scored.denom;
      const enough = samples >= minSamples;
      if (enough) eligible += 1;
      if (
        enough
        && scored.rate !== null
        && (!best || scored.rate > best.rate || (scored.rate === best.rate && samples > best.samples))
      ) {
        best = { mode, rate: scored.rate, samples };
      }
    }
    const totalSamples = Object.values(modes).reduce((a, m) => a + m.samples, 0);
    let confidence = "insufficient";
    if (best) confidence = "measured";
    else if (eligible > 1 && !best) confidence = "tie";
    out[family] = {
      modes,
      bestMode: best ? best.mode : "",
      bestRate: best ? best.rate : null,
      samples: totalSamples,
      confidence,
    };
  }
  return { byFamily: out };
}

/**
 * 校准结果覆盖画像推荐通道（带防抖动）。
 * options.currentMode：当前正在用的通道；新赢家必须领先 MIN_MARGIN 个百分点才换。
 * options.margin：覆盖领先门槛。
 * 返回 { mode, source, reason }：source ∈ calibrated | profile。没有实测数据时 source=profile。
 */
export function applyCalibration(profile, calibration, options = {}) {
  const family = String(profile?.family || "");
  const base = { mode: String(profile?.recommendedMode || "").trim() || "user", source: "profile", reason: "" };
  if (!family || !calibration || !calibration.byFamily) return base;
  const row = calibration.byFamily[family];
  if (!row || row.confidence !== "measured" || !row.bestMode) return base;

  const margin = Number.isFinite(Number(options.margin)) ? Number(options.margin) : MIN_MARGIN;
  const current = String(options.currentMode || "").trim();
  if (current && current !== row.bestMode) {
    const cur = row.modes ? row.modes[current] : null;
    const curRate = cur && typeof cur.rate === "number" ? cur.rate : null;
    const bestRate = typeof row.bestRate === "number" ? row.bestRate : null;
    // 薄差距（或当前通道压根没样本）就先不换：来回切比切错更伤效果。
    if (curRate !== null && bestRate !== null && bestRate - curRate < margin) {
      return {
        mode: current,
        source: "calibrated",
        reason: `实测 ${row.bestMode} 只领先 ${bestRate - curRate}pp（门槛 ${margin}pp），保持 ${current} 防抖动`,
      };
    }
  }

  if (row.bestMode === base.mode) {
    return { mode: base.mode, source: "calibrated", reason: `本机实测也是 ${base.mode}（${row.samples} 条记录）` };
  }
  return {
    mode: row.bestMode,
    source: "calibrated",
    reason: `本机实测 ${row.bestMode} 更优（命中率 ${row.bestRate}%，${row.samples} 条记录）→ 覆盖规则推荐 ${base.mode}`,
  };
}

/** 一行展示，给 doctor / status 用。 */
export function describeCalibration(calibration, family = "") {
  const table = calibration?.byFamily || {};
  const keys = Object.keys(table);
  if (!keys.length) return "还没有可用校准（先跑 /pojia validate 记录几条）";
  if (family && table[family]) {
    const row = table[family];
    if (row.confidence === "measured") return `${family} 实测最优 ${row.bestMode}（${row.bestRate}%，${row.samples} 条）`;
    return `${family} 样本不足（${row.samples} 条，门槛 ${MIN_SAMPLES}）`;
  }
  return keys.map((k) => `${k}:${table[k].bestMode || "样本不足"}`).join(" · ");
}
