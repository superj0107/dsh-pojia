// v1.0.5 新增能力的自动化测试：结论层 / doctor / 自定义探针 / fail 归因 / provider 识别。
// 只覆盖纯逻辑模块，不启动宿主进程（lib/index.js 有 import 期副作用，这里不碰）。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;
beforeEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "pojia-diag-"));
  process.env.DSH_HOME = tmpHome;
});

function fakeState(over = {}) {
  return {
    surface: "web",
    dsh_home: tmpHome,
    ai_base: "/fake/node_modules/@deepseek-ai",
    web_no_package: false,
    display_applied: 101,
    display_total: 101,
    display_pending: 0,
    display_skipped: 0,
    display_ready: 101,
    patches_applied: 101,
    patches_total: 101,
    patches_pending: 0,
    patches_ready: 101,
    override_path: path.join(tmpHome, "prompt-inject.md"),
    override_status: "custom",
    asar_still_sealed: false,
    has_backup: true,
    files: {},
    patch_status: {},
    shim_dir: "/fake/bin",
    shim_cmd: "patched",
    shim_ps1: "patched",
    shim_bin: "patched",
    ...over,
  };
}

function touchInject() {
  writeFileSync(path.join(tmpHome, "prompt-inject.md"), "# 注入正文\n", "utf8");
}

test("verdict: 三态判定与顺序（pending 优先于注入缺失）", async () => {
  const { verdictFor, TIERS } = await import("../lib/verdict.js");

  for (const [label, state, extra, wantTier, wantText] of [
    ["未定位插件根", fakeState({ ai_base: null }), {}, TIERS.BROKEN, "插件根缺失"],
    ["还有待处理补丁", fakeState({ display_pending: 3 }), {}, TIERS.PENDING, "3 项 pending"],
    ["补丁齐了但注入文件没了", fakeState(), {}, TIERS.BROKEN, "注入文件缺失"],
    ["asar 仍密封", fakeState({ asar_still_sealed: true }), {}, TIERS.BROKEN, "仍密封"],
    ["全绿", fakeState(), { enabled: true }, TIERS.READY, "已就绪"],
    // 假成功防线：一份补丁都没写进去，不许说「已就绪」。
    ["补丁全跳过", fakeState({ display_applied: 0, display_total: 26, display_pending: 0, display_skipped: 26, display_ready: 26 }), {}, TIERS.BROKEN, "补丁一份都没写进宿主"],
    // 可选补丁模式没命中是正常态（core.patchStatusReady 也算 ready），不能误报异常。
    ["可选补丁未命中", fakeState({ display_applied: 24, display_total: 26, display_skipped: 2, display_ready: 26 }), {}, TIERS.READY, "已就绪"],
    // 有补丁既不 applied 也不 soft-ok：宿主版本/布局对不上。
    ["补丁未就绪", fakeState({ display_applied: 20, display_total: 26, display_skipped: 2, display_ready: 22 }), {}, TIERS.BROKEN, "4 项补丁未就绪"],
  ]) {
    if (label === "全绿" || label === "asar 仍密封" || label === "补丁全跳过" || label === "可选补丁未命中" || label === "补丁未就绪") touchInject();
    const v = verdictFor(state, extra);
    assert.equal(v.tier, wantTier, `${label}: tier`);
    assert.ok(v.text.includes(wantText), `${label}: ${v.text}`);
    assert.ok(v.next.length > 0, `${label}: 必须有下一步`);
  }

  // pending 覆盖「注入文件也缺」：先让用户 apply，别两条一起报。
  rmSync(path.join(tmpHome, "prompt-inject.md"), { force: true });
  const pending = verdictFor(fakeState({ display_pending: 1 }));
  assert.equal(pending.tier, TIERS.PENDING);
  assert.equal(pending.next, "/pojia apply");

  // 注入开关未知时不能说「注入开启」。
  touchInject();
  const ready = verdictFor(fakeState());
  assert.ok(ready.text.includes("注入文件在"));
  const off = verdictFor(fakeState(), { enabled: false });
  assert.ok(off.text.includes("注入已关闭"));
});

test("doctor: 三态场景的退出码（无插件 / 全绿 / 注入缺失 / 版本不符）", async () => {
  const { buildDoctor } = await import("../lib/doctor.js");

  const base = {
    config: { enabled: true },
    armor: { enabled: true, mode: "user" },
    persona: { current: "pojia-armor", total: 2 },
    provider: { provider: "wx", model: "Deepseek-v4-flash", baseURL: "https://chatapi.weixin.qq.com/openai/v1", relay: true, note: "（疑似中转，过滤行为不可控）" },
    hostVersion: "0.2.2-rc.5",
    targets: ["0.2.2-rc.5"],
    pluginVersion: "1.0.5",
    injectBytes: 1024,
    command: { ok: true, via: "direct" },
  };
  const passRow = { persona: "pojia-armor", pass: 8, fail: 0, skip: 0, rate: 100, builtin: 6, custom: 2, reasons: { refusal: 0, gateway: 0, transport: 0, other: 0 } };

  // ① 无插件根 → 阻断
  const none = buildDoctor({ ...base, state: fakeState({ ai_base: null }), validation: [] });
  assert.equal(none.exitCode, 2);
  assert.ok(none.text.includes("插件根缺失"));

  // ② 全绿（插件根 + 注入在 + 当前人设验证全 pass + 内核开）
  touchInject();
  const ok = buildDoctor({ ...base, state: fakeState(), validation: [passRow] });
  assert.equal(ok.exitCode, 0);
  assert.ok(ok.text.includes("DSH 0.2.2-rc.5"));
  assert.ok(ok.text.includes("疑似中转"));
  assert.ok(ok.summary.includes("validate 100%"));

  // ②b 验证记录全 fail → 不能报 0（「0 全绿」必须真的全绿）
  const failRow = { ...passRow, pass: 0, fail: 2, rate: 0, reasons: { refusal: 0, gateway: 2, transport: 0, other: 0 } };
  assert.equal(buildDoctor({ ...base, state: fakeState(), validation: [failRow] }).exitCode, 1);
  // ②c 只有当前人设的 pass、另一人设的 fail 不算当前人设的绿
  assert.equal(buildDoctor({ ...base, state: fakeState(), validation: [{ ...passRow, persona: "other" }] }).exitCode, 1);
  // ②d 内核被关 / 注入总开关关闭 → 有待办
  assert.equal(buildDoctor({ ...base, armor: { enabled: false, mode: "user" }, state: fakeState(), validation: [passRow] }).exitCode, 1);
  assert.equal(buildDoctor({ ...base, config: { enabled: false }, state: fakeState(), validation: [passRow] }).exitCode, 1);

  // ②e 命令面没注册上（用户「输入 /pojia 无反应」的根因之一）→ 有待办，并在输出里点名
  const noCmd = buildDoctor({
    ...base,
    command: { ok: false, via: "none", error: "commands 服务不可用" },
    state: fakeState(),
    validation: [passRow],
  });
  assert.equal(noCmd.exitCode, 1);
  assert.ok(noCmd.text.includes("命令 /pojia 未注册"));
  assert.ok(noCmd.summary.includes("未注册"));

  // ②f 已注册时不影响绿色
  assert.ok(buildDoctor({ ...base, state: fakeState(), validation: [passRow] }).text.includes("命令 /pojia 已注册"));

  // ③ 注入文件缺失 → 阻断
  rmSync(path.join(tmpHome, "prompt-inject.md"), { force: true });
  const missing = buildDoctor({ ...base, state: fakeState(), validation: [] });
  assert.equal(missing.exitCode, 2);
  assert.ok(missing.text.includes("注入文件缺失"));

  // ④ 版本不匹配 + 尚未验证 → 有待办（1）
  touchInject();
  const todo = buildDoctor({ ...base, hostVersion: "0.2.1", state: fakeState(), validation: [] });
  assert.equal(todo.exitCode, 1);
  assert.ok(todo.text.includes("目标 0.2.2-rc.5"));
});

test("probes: 自定义探针合并、id 冲突、脏 JSON、字段类型异常", async () => {
  const v = await import("../lib/effect-check.js");
  const dir = v.probesDir();
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(dir, "good.json"), JSON.stringify([
    { id: "custom-a", kind: "normal", prompt: "解释一下幂等。", expect: "concise" },
    { id: "refuse-1", kind: "refusal", prompt: "和内置撞 id 的自定义探针", expect: "act" },
  ]), "utf8");
  writeFileSync(path.join(dir, "broken.json"), "{ 这不是 JSON", "utf8");
  writeFileSync(path.join(dir, "badfield.json"), JSON.stringify({ id: "bad kind", kind: "whatever", prompt: "" }), "utf8");
  // 合法 JSON 但字段类型异常：一条坏探针不能打断整份列表
  writeFileSync(path.join(dir, "weird.json"), JSON.stringify([
    { id: "weird-a", kind: "normal", prompt: { toString: null } },
    { id: "weird-b", kind: "normal", prompt: "这条还能加载。", expectNo: "not-an-array" },
  ]), "utf8");

  const { probes, warnings } = v.allProbes();
  assert.equal(probes.filter((p) => p.source === "builtin").length, v.PROBES.length);
  assert.deepEqual(probes.filter((p) => p.source === "custom").map((p) => p.id).sort(), ["custom-a", "weird-b"]);
  assert.equal(new Set(probes.map((p) => p.id)).size, probes.length);
  assert.ok(warnings.some((w) => w.includes("冲突")));
  assert.ok(warnings.some((w) => w.includes("JSON 解析失败")));
  assert.ok(warnings.some((w) => w.includes("不是字符串")));

  // 自定义探针能被记录，未知 id 的报错要带上数量口径
  assert.equal(v.recordProbe("custom-a", "pass").ok, true);
  const bad = v.recordProbe("no-such-probe", "pass");
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes("自定义 2 条"));
});

test("validate: fail 归因 + report 建议 + skip 覆盖 fail", async () => {
  const v = await import("../lib/effect-check.js");
  assert.equal(v.recordProbe("refuse-1", "fail", "网关直接 403", "gateway").ok, true);
  assert.equal(v.recordProbe("refuse-2", "fail", "中转改写了回复", "gateway").ok, true);
  assert.equal(v.recordProbe("normal-1", "pass").ok, true);
  assert.equal(v.recordProbe("normal-2", "fail", "网关卡住", "bogus-reason").ok, false);

  const rows = v.report();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fail, 2);
  assert.equal(rows[0].reasons.gateway, 2);
  assert.ok(rows[0].suggestion.includes("gateway"));
  assert.ok(v.reportLines(rows).join("\n").includes("fail 归因"));

  // 同一探针后写 skip 覆盖前一条
  assert.equal(v.recordProbe("normal-1", "skip").ok, true);
  assert.equal(v.report()[0].skip, 1);
  v.clearValidation();
});

test("provider: 官方域名判定、settings 解析、注释/BOM、原型污染、命名 provider 不回退", async () => {
  const p = await import("../lib/provider-info.js");
  assert.equal(p.isOfficialBaseURL("https://api.deepseek.com/v1"), true);
  assert.equal(p.isOfficialBaseURL("https://api.openai.com/v1"), true);
  assert.equal(p.isOfficialBaseURL("https://chatapi.weixin.qq.com/openai/v1/chat/completions"), false);
  assert.equal(p.isOfficialBaseURL(""), false);

  const yaml = [
    "agent-default-model: # 当前默认模型",
    "  provider: wx",
    "  model: Deepseek-v4-flash",
    "llm-pi-ai:",
    "  providers:",
    "    wx:",
    "      baseURL: https://relay.example.com/v1?key=SECRET # 中转",
    "    official:",
    "      baseURL: https://api.deepseek.com/v1",
    "",
  ].join("\n");
  const parsed = p.parseSettingsLite(yaml);
  assert.equal(parsed.provider, "wx");
  assert.equal(parsed.model, "Deepseek-v4-flash");
  assert.equal(parsed.providers.wx.baseURL, "https://relay.example.com/v1?key=SECRET");
  assert.equal(parsed.providers.official.baseURL, "https://api.deepseek.com/v1");

  // BOM + 行尾注释不应该把默认模型块吃掉
  writeFileSync(path.join(tmpHome, "settings.yaml"), `\uFEFF${yaml}`, "utf8");
  const info = p.readProviderInfo(tmpHome, {});
  assert.equal(info.provider, "wx");
  assert.equal(info.relay, true);
  assert.ok(info.note.includes("疑似中转"));
  const shown = p.describeProvider(info);
  assert.ok(shown.includes("wx / Deepseek-v4-flash"));
  assert.ok(!shown.includes("SECRET"), "展示时必须剪掉查询串里的凭证");

  // 别的命名空间里的 providers 不能串过来
  const foreign = [
    "other-plugin:",
    "  providers:",
    "    relay:",
    "      baseURL: https://evil.example.com/v1",
    "llm-pi-ai:",
    "  providers:",
    "    official:",
    "      baseURL: https://api.deepseek.com/v1",
    "",
  ].join("\n");
  const parsedForeign = p.parseSettingsLite(foreign);
  assert.deepEqual(Object.keys(parsedForeign.providers), ["official"]);

  // 嵌套字段不能当成 provider 的 baseURL
  const nested = [
    "llm-pi-ai:",
    "  providers:",
    "    wx:",
    "      headers:",
    "        baseURL: https://nested.example.com/v1",
    "",
  ].join("\n");
  assert.equal(p.parseSettingsLite(nested).providers.wx.baseURL, "");

  // __proto__ 不能污染原型
  const proto = [
    "llm-pi-ai:",
    "  providers:",
    "    __proto__:",
    "      baseURL: https://polluted.example.com/v1",
    "",
  ].join("\n");
  const parsedProto = p.parseSettingsLite(proto);
  assert.equal(Object.keys(parsedProto.providers).length, 0);
  assert.equal({}.baseURL, undefined, "Object.prototype 不许被写脏");

  // 指定了 provider 但它没有 baseURL 时，不许拿别的 provider 的地址顶上
  const mixed = [
    "agent-default-model:",
    "  provider: official",
    "llm-pi-ai:",
    "  providers:",
    "    relay:",
    "      baseURL: https://relay.example.com/v1",
    "",
  ].join("\n");
  writeFileSync(path.join(tmpHome, "settings.yaml"), mixed, "utf8");
  const mixedInfo = p.readProviderInfo(tmpHome, {});
  assert.equal(mixedInfo.provider, "official");
  assert.equal(mixedInfo.baseURL, "");
  assert.equal(mixedInfo.relay, false);
});

test("文案: 仓库里不再有会被论坛吃掉的 record <id>", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  for (const rel of ["lib/effect-check.js", "README.md", "README.zh-CN.md", "README.en.md", "README.ja.md"]) {
    let text = "";
    try {
      text = readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    assert.equal(text.includes("record <id>"), false, `${rel} 仍含 record <id>`);
  }
});

test("validate: validation.json 读改写上锁（并发不丢记录 / 残留锁可恢复）", async () => {
  const { existsSync, utimesSync, mkdirSync: mk } = await import("node:fs");
  const v = await import("../lib/effect-check.js");
  const stateFile = path.join(tmpHome, "pojia", "validation.json");
  const lockFile = `${stateFile}.lock`;
  mk(path.dirname(stateFile), { recursive: true });

  // ① 正常写入后锁要释放
  assert.equal(v.recordProbe("refuse-1", "pass").ok, true);
  assert.equal(existsSync(lockFile), false);
  assert.equal(v.readValidation().records.length, 1);

  // ② 别人正持锁（新锁）：应当明确失败，且不改记录
  writeFileSync(lockFile, "", "utf8");
  const busy = v.recordProbe("refuse-2", "pass");
  assert.equal(busy.ok, false);
  assert.ok(busy.error.includes("正被另一个进程写入"), busy.error);
  assert.equal(v.readValidation().records.length, 1, "被锁挡住时不许写进去");
  const busyClear = v.clearValidation();
  assert.equal(busyClear.ok, false);
  assert.equal(v.readValidation().records.length, 1);

  // ③ 残留锁（进程被 kill 留下的）：过期后自动清掉并正常写入
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockFile, old, old);
  const recovered = v.recordProbe("refuse-2", "pass");
  assert.equal(recovered.ok, true, recovered.error || "");
  assert.equal(existsSync(lockFile), false);
  assert.equal(v.readValidation().records.length, 2);
  v.clearValidation();
});

test("cleanup", () => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});
