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
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "node:fs";
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
/** 校准历史：每次「换通道 / 结论变化」追加一行，便于回答「为什么这周走了 both」。 */
export function calibrationHistoryPath() {
  return path.join(dshHome(), "pojia", "calibration-history.jsonl");
}
export const HISTORY_LIMIT = 200;
export function lastProfilePath() {
  return path.join(dshHome(), "pojia", "armor-last.json");
}

/** armor 每轮落一次「当前画像快照」，供 validate 记录与校准使用。 */
const SESSION_SNAPSHOT_CAP = 20;
const SNAPSHOT_LOCK_STALE_MS = 10_000;

/** 快照自己的锁：只保护 armor-last.json 的读-合并-写，争用就放弃这次写（下一轮会再写）。 */
function withSnapshotLock(fn) {
  const file = `${lastProfilePath()}.lock`;
  let fd = null;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      fd = openSync(file, "wx");
    } catch (e) {
      if (e?.code !== "EEXIST") return false;
      // 过期锁（进程崩了）直接清掉重试一次；否则放弃本次写，别硬抢。
      let age = Infinity;
      try {
        age = Date.now() - statSync(file).mtimeMs;
      } catch { age = Infinity; }
      if (age <= SNAPSHOT_LOCK_STALE_MS) return false;
      try { unlinkSync(file); } catch { /* 别人抢先清了 */ }
      try { fd = openSync(file, "wx"); } catch { return false; }
    }
    return fn();
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
      try { unlinkSync(file); } catch { /* ignore */ }
    }
  }
}

/**
 * 写画像快照。**按会话分开存**（sessions[sessionId]），同时留一份 last 供展示：
 * 一个进程里 A 会话跑完 B 会话又跑一轮时，A 的 validate/refusal 不能被记到 B 的模型上。
 */
export function writeLastProfile(snapshot, options = {}) {
  return withSnapshotLock(() => writeLastProfileUnlocked(snapshot, options));
}

function writeLastProfileUnlocked(snapshot, options = {}) {
  try {
    const file = lastProfilePath();
    mkdirSync(path.dirname(file), { recursive: true });
    const at = new Date().toISOString();
    const row = { ...snapshot, at };
    const prev = readLastProfileRaw();
    const sessions = { ...(prev.sessions || {}) };
    const sessionId = String(options.sessionId || "").trim();
    if (sessionId) {
      sessions[sessionId] = row;
      // 只留最近 N 个会话，别让文件无限长。
      const keys = Object.keys(sessions);
      if (keys.length > SESSION_SNAPSHOT_CAP) {
        keys
          .sort((a, b) => String(sessions[a].at || "").localeCompare(String(sessions[b].at || "")))
          .slice(0, keys.length - SESSION_SNAPSHOT_CAP)
          .forEach((k) => delete sessions[k]);
      }
    }
    const payload = { last: row, sessions };
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function normalizeSnapshot(j) {
  if (!j || typeof j !== "object") return null;
  return {
    family: String(j.family || ""),
    mode: String(j.mode || ""),
    provider: String(j.provider || ""),
    model: String(j.model || ""),
    trimmed: j.trimmed === true,
    at: String(j.at || ""),
  };
}

function readLastProfileRaw() {
  try {
    const j = JSON.parse(readFileSync(lastProfilePath(), "utf8"));
    if (!j || typeof j !== "object") return { last: null, sessions: {} };
    // 旧格式：整个文件就是一条快照
    if (!j.last && !j.sessions && (j.family || j.mode || j.model)) {
      return { last: normalizeSnapshot(j), sessions: {} };
    }
    const sessions = {};
    for (const [id, row] of Object.entries(j.sessions || {})) {
      const norm = normalizeSnapshot(row);
      if (norm) sessions[id] = norm;
    }
    return { last: normalizeSnapshot(j.last), sessions };
  } catch {
    return { last: null, sessions: {} };
  }
}

/** 读画像快照：给了 sessionId 就取该会话的，取不到再退回 last（调用方据 attribution 决定是否采用）。 */
export function readLastProfile(sessionId = "") {
  const raw = readLastProfileRaw();
  const id = String(sessionId || "").trim();
  if (id && raw.sessions[id]) return { ...raw.sessions[id], attribution: "session" };
  return raw.last ? { ...raw.last, attribution: "last" } : null;
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
    appendHistory(data);
    return true;
  } catch {
    return false;
  }
}

/** 只留「家族 → 最优通道」这一维，历史文件才不会膨胀。 */
function historyRow(byFamily = {}) {
  const out = {};
  for (const [fam, row] of Object.entries(byFamily)) {
    out[fam] = { best: row?.bestMode || "", confidence: row?.confidence || "", samples: row?.samples || 0, rate: row?.bestRate ?? null };
  }
  return out;
}

/** 历史只关心「决策有没有变」，样本数从 6 涨到 7 不该算一次变化。 */
function decisionKey(byFamily = {}) {
  return Object.keys(byFamily)
    .sort()
    .map((fam) => `${fam}:${byFamily[fam]?.bestMode || "-"}:${byFamily[fam]?.confidence || "-"}`)
    .join("|");
}

function sameHistory(a, b) {
  return decisionKey(a || {}) === decisionKey(b || {});
}

function appendHistory(data) {
  try {
    const file = calibrationHistoryPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const row = historyRow(data?.byFamily);
    // 与上一条的「决策」完全一致就不重复记（否则每次 record 都追一行）。
    const prevLines = readLines(file);
    const last = prevLines.length ? prevLines[prevLines.length - 1] : "";
    if (last) {
      try {
        const prevByFamily = JSON.parse(last)?.byFamily || {};
        const prevDecision = Object.fromEntries(
          Object.entries(prevByFamily).map(([fam, v]) => [fam, { bestMode: v.best, confidence: v.confidence }]),
        );
        if (sameHistory(prevDecision, data?.byFamily || {})) return;
      } catch { /* 脏行就当没上一行 */ }
    }
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), byFamily: row })}\n`, "utf8");
    // 超过上限就重写尾部，避免无限增长。
    const lines = readLines(file);
    if (lines.length > HISTORY_LIMIT) {
      const keep = lines.slice(lines.length - HISTORY_LIMIT).join("\n");
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${keep}\n`, "utf8");
      renameSync(tmp, file);
    }
  } catch { /* 历史记不成不影响校准本身 */ }
}

function readLines(file) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** 读最近 N 条校准历史（新的在前）。 */
export function readCalibrationHistory(limit = 5) {
  const rows = [];
  for (const line of readLines(calibrationHistoryPath()).slice(-Math.max(1, limit)).reverse()) {
    try {
      const j = JSON.parse(line);
      if (j && typeof j === "object") rows.push({ at: String(j.at || ""), byFamily: j.byFamily || {} });
    } catch { /* 脏行跳过 */ }
  }
  return rows;
}

/** 一行展示校准历史：`11-27 10:05 claude→both(measured,12) · deepseek→user(insufficient,3)` */
export function describeCalibrationHistory(limit = 3) {
  const rows = readCalibrationHistory(limit);
  if (!rows.length) return "";
  return rows.map((r) => {
    const at = r.at.replace("T", " ").slice(5, 16);
    const fams = Object.entries(r.byFamily)
      .map(([fam, v]) => `${fam}→${v.best || "-"}(${v.confidence || "?"},${v.samples})`)
      .join(" · ");
    return `${at} ${fams}`;
  }).join("\n");
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
    // 归属不可靠（记录时拿不到会话，只能读「最近一条」快照）→ 保留记录但**不进校准聚合**：
    // 把 A 会话的结果算到 B 的模型头上，比少几条样本更糟。
    if (String(r?.attribution || "") === "fallback") continue;
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
    // 预算 A/B：同一条记录还带「这一轮是不是压缩过的内核」，单独攒一份对照样本。
    const ab = row.ab || (row.ab = { full: { pass: 0, fail: 0 }, trimmed: { pass: 0, fail: 0 } });
    const bucket = r.trimmed === true ? ab.trimmed : ab.full;
    bucket[verdict === "pass" ? "pass" : "fail"] += 1;
  }

  const out = {};
  for (const [family, stat] of Object.entries(byFamily)) {
    const modes = {};
    let best = null;
    for (const mode of MODES) {
      const row = stat.modes[mode];
      if (!row) continue;
      const scored = scoreOf(row);
      modes[mode] = {
        ...row,
        rate: scored.rate,
        samples: scored.denom, // 原始条数（展示用）
        effectiveSamples: scored.effectiveDenom, // 剔除 gateway 后的有效条数（判定用）
      };
      // 门槛按「有效样本」算：1 pass + 5 gateway fail 不能算 6 条样本
      const enough = scored.effectiveDenom >= minSamples && scored.rate !== null;
      if (!enough) continue;
      if (
        !best
        || scored.rate > best.rate
        || (scored.rate === best.rate && scored.effectiveDenom > best.effectiveSamples)
      ) {
        best = { mode, rate: scored.rate, effectiveSamples: scored.effectiveDenom };
      }
    }
    const totalSamples = Object.values(modes).reduce((a, m) => a + m.samples, 0);
    // 有效命中率并列（且都够样本）就不算 measured：宁可继续用规则，也别在两个一样好的通道里抖。
    let tie = false;
    if (best) {
      tie = Object.values(modes).some(
        (m) => m !== modes[best.mode]
          && m.effectiveSamples >= minSamples
          && m.rate === best.rate,
      );
    }
    let confidence = "insufficient";
    if (best) confidence = tie ? "tie" : "measured";
    out[family] = {
      modes,
      bestMode: best && !tie ? best.mode : "",
      bestRate: best && !tie ? best.rate : null,
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
    const curEnough = cur && (cur.effectiveSamples >= MIN_SAMPLES);
    // 薄差距（或当前通道压根没样本）就先不换：来回切比切错更伤效果。
    if (curEnough && curRate !== null && bestRate !== null && bestRate - curRate < margin) {
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

/**
 * 预算 A/B：同一族同一通道下，「压缩过的内核」与「全文」谁的效果好。
 * 返回 { verdict, line }：
 *   verdict ∈ insufficient（任一侧样本 < MIN_AB_SAMPLES）/ same / trim-worse / trim-better
 *   line：给人看的一句话结论（含两侧命中率与样本数）
 */
export const MIN_AB_SAMPLES = 3;

export function compareBudgetAB(calibration, family = "") {
  const table = calibration?.byFamily || {};
  const families = family && table[family] ? [family] : Object.keys(table);
  const rows = [];
  for (const fam of families) {
    const forFamily = table[fam].modes || {};
    for (const [mode, row] of Object.entries(forFamily)) {
      const ab = row.ab;
      if (!ab) continue;
      const fullN = ab.full.pass + ab.full.fail;
      const trimN = ab.trimmed.pass + ab.trimmed.fail;
      if (!fullN && !trimN) continue;
      const fullRate = fullN ? Math.round((ab.full.pass / fullN) * 100) : null;
      const trimRate = trimN ? Math.round((ab.trimmed.pass / trimN) * 100) : null;
      let verdict = "insufficient";
      if (fullN >= MIN_AB_SAMPLES && trimN >= MIN_AB_SAMPLES) {
        if (trimRate === fullRate) verdict = "same";
        else if (trimRate < fullRate) verdict = "trim-worse";
        else verdict = "trim-better";
      }
      rows.push({ family: fam, mode, fullN, trimN, fullRate, trimRate, verdict });
    }
  }
  if (!rows.length) return { verdict: "insufficient", rows, line: "预算 A/B 还没有样本（压缩/全文各需要 ≥3 条 validate 记录）" };
  const head = rows[0];
  const fmt = (n, r) => (n ? `${r}%（${n} 条）` : "无样本");
  const line = `${head.family}/${head.mode}：压缩 ${fmt(head.trimN, head.trimRate)} vs 全文 ${fmt(head.fullN, head.fullRate)}`;
  const advice = {
    "trim-worse": " → 压缩更差，建议先关掉 injectBudgetKB",
    "trim-better": " → 压缩更好，可以继续用",
    same: " → 两者打平，按 token 省不省决定",
    insufficient: " → 样本不足，先各跑几条 validate",
  }[head.verdict];
  return { verdict: head.verdict, rows, line: line + (advice || "") };
}
