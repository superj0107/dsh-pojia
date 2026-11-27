// 在线校准测试：聚合「模型族 × 通道」的实测命中率，样本够了才覆盖规则推荐。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;
beforeEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "pojia-calib-"));
  process.env.DSH_HOME = tmpHome;
});

const rec = (family, mode, verdict, reason = "other") => ({ family, mode, verdict, reason });

test("calibration: 样本不足只用规则，不猜", async () => {
  const c = await import("../lib/calibration.js");
  const out = c.calibrate([rec("claude", "user", "pass"), rec("claude", "both", "pass")]);
  assert.equal(out.byFamily.claude.confidence, "insufficient");
  assert.equal(out.byFamily.claude.bestMode, "");

  const applied = c.applyCalibration({ family: "claude", recommendedMode: "both" }, out);
  assert.equal(applied.mode, "both");
  assert.equal(applied.source, "profile", "样本不足时不许覆盖规则");
});

test("calibration: 样本达标后用实测覆盖规则推荐", async () => {
  const c = await import("../lib/calibration.js");
  const records = [
    ...Array.from({ length: 6 }, () => rec("claude", "both", "pass")),
    ...Array.from({ length: 6 }, () => rec("claude", "user", "fail", "refusal")),
  ];
  const out = c.calibrate(records);
  assert.equal(out.byFamily.claude.confidence, "measured");
  assert.equal(out.byFamily.claude.bestMode, "both");
  assert.equal(out.byFamily.claude.samples, 12);
  assert.equal(out.byFamily.claude.bestRate, 100);

  // 规则推荐 user，但实测 both 更好 → 覆盖并说明理由
  const applied = c.applyCalibration({ family: "claude", recommendedMode: "user" }, out);
  assert.equal(applied.mode, "both");
  assert.equal(applied.source, "calibrated");
  assert.ok(applied.reason.includes("本机实测"));

  // 实测与规则一致时也标 calibrated，但理由是「吻合」
  const same = c.applyCalibration({ family: "claude", recommendedMode: "both" }, out);
  assert.equal(same.mode, "both");
  assert.equal(same.source, "calibrated");
  assert.ok(same.reason.includes("本机实测也是"));
});

test("calibration: gateway 失败不冤枉通道（净失败口径）", async () => {
  const c = await import("../lib/calibration.js");
  const records = [
    ...Array.from({ length: 6 }, () => rec("glm", "user", "fail", "gateway")),
    ...Array.from({ length: 6 }, () => rec("glm", "both", "pass")),
  ];
  const out = c.calibrate(records);
  // user 全是 gateway（链路问题）→ 有效失败 0、命中率 null，不能当赢家
  assert.equal(out.byFamily.glm.modes.user.gateway, 6);
  assert.equal(out.byFamily.glm.modes.user.rate, null);
  assert.equal(out.byFamily.glm.bestMode, "both");
});

test("calibration: 没画像字段的老记录被跳过；skip 不进分母", async () => {
  const c = await import("../lib/calibration.js");
  const out = c.calibrate([
    { probeId: "x", verdict: "pass" }, // 老记录：没 family/mode
    rec("deepseek", "user", "skip"),
    ...Array.from({ length: 6 }, () => rec("deepseek", "user", "pass")),
  ]);
  assert.deepEqual(Object.keys(out.byFamily), ["deepseek"]);
  assert.equal(out.byFamily.deepseek.samples, 6);
  assert.equal(out.byFamily.deepseek.bestMode, "user");
});

test("calibration: 画像快照与校准表读写（含损坏容错）", async () => {
  const c = await import("../lib/calibration.js");
  assert.equal(c.writeLastProfile({ family: "claude", mode: "both", provider: "anthropic", model: "opus" }), true);
  const snap = c.readLastProfile();
  assert.equal(snap.family, "claude");
  assert.equal(snap.mode, "both");
  assert.ok(snap.at);

  assert.equal(c.writeCalibration({ byFamily: { claude: { bestMode: "both", confidence: "measured", samples: 8, bestRate: 100, modes: {} } } }), true);
  const back = c.readCalibration();
  assert.equal(back.byFamily.claude.bestMode, "both");
  assert.ok(c.describeCalibration(back, "claude").includes("实测最优 both"));
  assert.ok(c.describeCalibration({ byFamily: {} }).includes("还没有可用校准"));

  // 损坏文件 → 当没有校准，不抛
  writeFileSync(c.calibrationPath(), "{坏 JSON", "utf8");
  assert.deepEqual(c.readCalibration().byFamily, {});
  writeFileSync(c.lastProfilePath(), "not json", "utf8");
  assert.equal(c.readLastProfile(), null);
});

test("calibration: validate 记录自动带上画像，并在记录后刷新校准表", async () => {
  const c = await import("../lib/calibration.js");
  const v = await import("../lib/effect-check.js");
  const SESSION = "sess-claude";
  c.writeLastProfile({ family: "claude", mode: "both", provider: "anthropic", model: "claude-opus-5-5" }, { sessionId: SESSION });

  assert.equal(v.recordProbe("refuse-1", "pass", "", "other", { sessionId: SESSION }).ok, true);
  const rows = v.readValidation().records;
  assert.equal(rows[0].family, "claude");
  assert.equal(rows[0].mode, "both");
  assert.equal(rows[0].attribution, "session", "给了 sessionId 就必须是可靠归属");

  // 再灌到门槛，校准表应出现 measured
  for (let i = 0; i < 5; i += 1) v.recordProbe("refuse-1", "pass", "", "other", { sessionId: SESSION });
  for (let i = 0; i < 6; i += 1) v.recordProbe("normal-1", "fail", "", "refusal", { sessionId: SESSION });
  const cal = c.readCalibration();
  assert.ok(cal.byFamily.claude, JSON.stringify(cal));
  assert.equal(cal.byFamily.claude.modes.both.pass, 6);

  // 归属不可靠的记录（没给 sessionId）保留，但不进校准聚合
  const before = c.readCalibration().byFamily.claude.samples;
  assert.equal(v.recordProbe("refuse-2", "fail", "", "refusal").ok, true);
  const last = v.readValidation().records.at(-1);
  assert.equal(last.attribution, "fallback", "没给会话 id 时标 fallback");
  assert.equal(c.readCalibration().byFamily.claude.samples, before, "fallback 记录不许改变校准");

  // 清空验证记录必须同时清校准，避免没有数据支撑的「最优通道」
  v.clearValidation();
  assert.deepEqual(c.readCalibration().byFamily, {});
});

test("calibration: 薄差距不换通道（防抖动）", async () => {
  const c = await import("../lib/calibration.js");
  // both 100%，user 92%（11 pass / 1 fail）—— 差距 8pp < 门槛 15pp：当前用 user 就先别换
  const records = [
    ...Array.from({ length: 6 }, () => rec("claude", "both", "pass")),
    ...Array.from({ length: 11 }, () => rec("claude", "user", "pass")),
    rec("claude", "user", "fail", "refusal"),
  ];
  const table = c.calibrate(records);
  assert.equal(table.byFamily.claude.bestMode, "both");
  const keep = c.applyCalibration({ family: "claude", recommendedMode: "user" }, table, { currentMode: "user" });
  assert.equal(keep.mode, "user");
  assert.ok(keep.reason.includes("防抖动"), keep.reason);

  // 差距够大（100 vs 50）时就应该换
  const wide = c.calibrate([
    ...Array.from({ length: 6 }, () => rec("claude", "both", "pass")),
    ...Array.from({ length: 3 }, () => rec("claude", "user", "pass")),
    ...Array.from({ length: 3 }, () => rec("claude", "user", "fail", "refusal")),
  ]);
  const flip = c.applyCalibration({ family: "claude", recommendedMode: "user" }, wide, { currentMode: "user" });
  assert.equal(flip.mode, "both");
  assert.ok(flip.reason.includes("覆盖规则推荐") || flip.reason.includes("本机实测"));
});

test("calibration: 预算 A/B 对照（压缩 vs 全文）", async () => {
  const c = await import("../lib/calibration.js");
  const recs = [
    { family: "claude", mode: "both", verdict: "pass", trimmed: true },
    { family: "claude", mode: "both", verdict: "pass", trimmed: true },
    { family: "claude", mode: "both", verdict: "fail", reason: "refusal", trimmed: true },
    { family: "claude", mode: "both", verdict: "pass" },
    { family: "claude", mode: "both", verdict: "pass" },
    { family: "claude", mode: "both", verdict: "pass" },
  ];
  const table = c.calibrate(recs);
  const ab = table.byFamily.claude.modes.both.ab;
  assert.equal(ab.trimmed.pass, 2);
  assert.equal(ab.trimmed.fail, 1);
  assert.equal(ab.full.pass, 3);

  const out = c.compareBudgetAB(table, "claude");
  assert.equal(out.verdict, "trim-worse", out.line);
  assert.ok(out.line.includes("压缩"), out.line);
  assert.ok(out.line.includes("关掉 injectBudgetKB"), out.line);

  // 样本不足时不给结论
  const thin = c.calibrate([{ family: "claude", mode: "user", verdict: "pass", trimmed: true }]);
  assert.equal(c.compareBudgetAB(thin, "claude").verdict, "insufficient");
  assert.ok(c.compareBudgetAB({ byFamily: {} }).line.includes("还没有样本"));
});

test("calibration: 历史只在结论变化时追加，且可读回", async () => {
  const c = await import("../lib/calibration.js");
  assert.equal(c.describeCalibrationHistory(3), "", "没有历史时应为空串");

  c.writeCalibration({ byFamily: { claude: { bestMode: "both", confidence: "measured", samples: 6, bestRate: 100 } } });
  c.writeCalibration({ byFamily: { claude: { bestMode: "both", confidence: "measured", samples: 7, bestRate: 100 } } }); // 结论没变 → 不重复记
  c.writeCalibration({ byFamily: { claude: { bestMode: "user", confidence: "measured", samples: 12, bestRate: 100 } } }); // 换了 → 追加

  const rows = c.readCalibrationHistory(5);
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.equal(rows[0].byFamily.claude.best, "user", "最新的在最前");
  assert.equal(rows[1].byFamily.claude.best, "both");
  const text = c.describeCalibrationHistory(2);
  assert.ok(text.includes("claude→user(measured,12)"), text);

  // 清空校准也要落一条历史（否则看不出「什么时候被清过」）
  c.writeCalibration({ byFamily: {} });
  assert.equal(c.readCalibrationHistory(5).length, 3);
});

test("calibration: 门槛按有效样本算（gateway 不计入资格）", async () => {
  const c = await import("../lib/calibration.js");
  // 1 pass + 5 gateway：原始 6 条，但有效样本只有 1 条 → 不许判 measured
  const thin = c.calibrate([
    rec("claude", "both", "pass"),
    ...Array.from({ length: 5 }, () => rec("claude", "both", "fail", "gateway")),
  ]);
  assert.equal(thin.byFamily.claude.modes.both.samples, 6, "原始条数照实展示");
  assert.equal(thin.byFamily.claude.modes.both.effectiveSamples, 1, "有效样本剔除 gateway");
  assert.equal(thin.byFamily.claude.confidence, "insufficient");
  assert.equal(thin.byFamily.claude.bestMode, "");

  // 补到 6 条有效样本才允许覆盖
  const enough = c.calibrate([
    ...Array.from({ length: 6 }, () => rec("claude", "both", "pass")),
    ...Array.from({ length: 5 }, () => rec("claude", "both", "fail", "gateway")),
  ]);
  assert.equal(enough.byFamily.claude.confidence, "measured");
  assert.equal(enough.byFamily.claude.bestMode, "both");
});

test("calibration: 有效命中率并列时判 tie（样本数不等也算）", async () => {
  const c2 = await import("../lib/calibration.js");
  // 两个通道都 100%，但样本数 6 vs 7 —— 仍是并列，不许判 measured（否则会在两个一样好的通道间抖）
  const table = c2.calibrate([
    ...Array.from({ length: 6 }, () => rec("claude", "both", "pass")),
    ...Array.from({ length: 7 }, () => rec("claude", "user", "pass")),
  ]);
  assert.equal(table.byFamily.claude.confidence, "tie");
  assert.equal(table.byFamily.claude.bestMode, "");
  const applied = c2.applyCalibration({ family: "claude", recommendedMode: "both" }, table, { currentMode: "both" });
  assert.equal(applied.source, "profile", "tie 时继续用规则推荐");
});

test("cleanup", () => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});
