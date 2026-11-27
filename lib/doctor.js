// /pojia doctor：结论导向的短诊断（≤ 一条屏），外加一段可直接贴论坛的摘要。
// 与 status 的分工：status 给全量明细（补丁逐条），doctor 只回答「好了没 / 差什么 / 下一步」。
// 纯本地：只读状态文件与配置，不发网络请求、不改任何文件。
import fs from "node:fs";
import path from "node:path";
import { EXIT_CODES, TIERS, TIER_LABEL, verdictFor } from "./verdict.js";
import { describeProvider } from "./provider-info.js";

const HOST_PACKAGES = Object.freeze([
  "dsh-agent-loop",
  "dsh-cmdline",
  "dsh-core",
  "dsh",
  "dsh-headless",
  "dsh-web-app",
]);

function mark(ok, warn = false) {
  if (ok) return "✓";
  return warn ? "!" : "✗";
}

function bytesText(n) {
  const v = Number(n) || 0;
  if (!v) return "-";
  if (v < 1024) return `${v} B`;
  return `${(v / 1024).toFixed(1)} KB`;
}

/** 宿主版本：优先 env 覆盖，其次从插件根下的宿主包 package.json 读。 */
export function detectHostVersion(aiBase, env = process.env) {
  const fromEnv = String(env?.DSH_VERSION || env?.DSH_HOST_VERSION || "").trim();
  if (fromEnv) return { version: fromEnv, source: "env" };
  const base = String(aiBase || "").trim();
  if (!base) return { version: "", source: "" };
  for (const name of HOST_PACKAGES) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(base, name, "package.json"), "utf8"));
      if (pj && pj.version) return { version: String(pj.version), source: name };
    } catch {
      /* 该包不存在，试下一个 */
    }
  }
  return { version: "", source: "" };
}

export function versionMatches(version, targets = []) {
  const v = String(version || "").trim();
  if (!v) return null; // 不知道就不猜
  const list = (Array.isArray(targets) ? targets : []).map((t) => String(t || "").trim()).filter(Boolean);
  if (!list.length) return null;
  return list.some((t) => v === t || v.startsWith(`${t}+`) || v.startsWith(`${t}-`));
}

function latestValidationRow(rows = [], current = "") {
  // 只认当前人设的记录：report() 按命中率排序，借用别人的高分结果会把
  // 「当前人设其实没验证过」说成「命中率 100%」。
  if (!current) return null;
  return rows.find((r) => r.persona === current) || null;
}

/**
 * 组装 doctor 输出。
 * input: {
 *   state,                    // core.gatherState()
 *   config = {},              // 插件配置（用 enabled）
 *   armor = null,             // { enabled, mode, channel }
 *   persona = {},             // { current, total }
 *   validation = [],          // effectCheck.report() 的行
 *   probeWarnings = [],       // 自定义探针警告
 *   provider = {},            // provider-info.readProviderInfo()
 *   hostVersion = "",         // detectHostVersion().version
 *   hostVersionSource = "",
 *   targets = [],             // package.json dshTargets
 *   pluginVersion = "",
 *   injectBytes = 0,
 *   surface = "",
 * }
 * 返回 { exitCode, text }：0 全绿 / 1 有待办 / 2 有阻断。
 */
export function buildDoctor(input = {}) {
  const state = input.state || {};
  const config = input.config || {};
  const armor = input.armor || null;
  const persona = input.persona || {};
  const rows = Array.isArray(input.validation) ? input.validation : [];
  const warnings = Array.isArray(input.probeWarnings) ? input.probeWarnings : [];
  const provider = input.provider || {};
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const surface = state.surface || input.surface || "web";

  const injectThere = (() => {
    try {
      return Boolean(state.override_path) && fs.existsSync(state.override_path);
    } catch {
      return false;
    }
  })();
  const verdict = verdictFor(state, { enabled: config.enabled, surface, overrideExists: injectThere });
  const row = latestValidationRow(rows, persona.current);

  const applied = verdict.applied;
  const total = verdict.total;
  const pending = verdict.pending;
  const skipped = verdict.skipped;
  const ready = verdict.ready;
  // 「装好了」= 插件根在 + 没有待处理 + 没有任何未就绪项（strict 口径，含 hostCleanGate）+ 至少写进去过一份。
  const installOk = Boolean(state.ai_base)
    && pending === 0
    && verdict.gap === 0
    && (total === 0 || applied > 0);
  const sealed = Boolean(state.asar_still_sealed) && applied > 0;
  const hostMatch = versionMatches(input.hostVersion, targets);

  const injectOk = injectThere && config.enabled !== false;
  const armorOn = armor ? armor.enabled !== false : null;
  // null = CLI 等进程不加载命令面（不适用），false = 明确没注册上。
  const commandOk = input.command ? input.command.ok === true : null;

  const validateOk = Boolean(row) && (row.fail || 0) === 0 && (row.pass || 0) > 0;

  const lines = [];
  lines.push("dsh-pojia doctor · 诊断（结论导向；补丁逐条明细看 /pojia status）");

  // 1) 安装
  lines.push(`1) 安装 / install ${mark(installOk)}`);
  const hostBits = [];
  hostBits.push(`宿主 ${surface}`);
  if (input.hostVersion) hostBits.push(`DSH ${input.hostVersion}${hostMatch === false ? `（目标 ${targets.join("/")}，不一致）` : hostMatch ? "（目标命中）" : ""}`);
  else hostBits.push(`DSH 版本未识别（目标 ${targets.join("/") || "未声明"}；可设 DSH_VERSION 覆盖）`);
  if (input.pluginVersion) hostBits.push(`插件 ${input.pluginVersion}`);
  lines.push(`   · ${hostBits.join(" · ")}`);
  lines.push(
    `   · 插件根 ${state.ai_base || "缺失"} · 补丁 ${applied}/${total} applied · 待处理 ${pending}`
      + `${skipped > 0 ? ` · 跳过 ${skipped}` : ""}`
      + ` · app.asar ${sealed ? "仍密封（补丁写在解开目录，需完全重启）" : "未密封/不适用"}`,
  );

  // 2) 注入
  lines.push(`2) 注入 / inject ${mark(injectOk && armorOn !== false && commandOk !== false, injectOk && (armorOn === false || commandOk === false))}`);
  lines.push(
    `   · prompt-inject.md ${bytesText(input.injectBytes)} · override=${state.override_status || "-"}`
      + ` · armor ${armor ? `${armorOn ? "on" : "off"}（mode=${armor.mode || "-"}）` : "不可用"}`,
  );
  // 命令面：用户「输入 /pojia 后什么都没发生」时，这一行直接给出结论。
  if (input.command) {
    lines.push(
      commandOk
        ? `   · 命令 /pojia 已注册（${input.command.via || "direct"}）`
        : `   · 命令 /pojia 未注册：${input.command.error || "commands 服务不可用"}（输入 /pojia 不会回任何东西）`,
    );
  } else {
    lines.push("   · 命令 /pojia 本进程不适用（CLI 不加载命令面）");
  }
  lines.push(`   · 人设 ${persona.current || "-"}${persona.total ? `（共 ${persona.total} 个可选）` : ""}`);
  lines.push(`   · 模型 ${describeProvider(provider)}`);

  // 3) 有效性
  const validateMark = row ? mark(validateOk, !validateOk) : mark(false, true);
  lines.push(`3) 有效性 / validate ${validateMark}`);
  if (row) {
    const why = Object.entries(row.reasons || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    lines.push(
      `   · 命中率 ${row.rate === null ? "-" : `${row.rate}%`}（pass=${row.pass} fail=${row.fail} skip=${row.skip}）`
        + ` · 内置 ${row.builtin ?? "-"} / 自定义 ${row.custom ?? "-"}`,
    );
    if (why) lines.push(`   · fail 归因：${why}${row.suggestion ? ` · 建议：${row.suggestion}` : ""}`);
  } else {
    lines.push("   · 尚未验证：/pojia validate list 拿探针去跑，再用 validate record 记结果（只看 injectBytes 不算成功）");
  }
  if (warnings.length) lines.push(`   · 自定义探针有 ${warnings.length} 条警告：${warnings[0]}${warnings.length > 1 ? " 等" : ""}`);

  // 结论
  lines.push(`结论 / verdict: ${verdict.text}`);
  lines.push(`下一步 / next: ${verdict.next}`);

  // 退出码必须反映「0 = 全绿」：验证全 fail / 注入被关 / 内核被关 都不算绿。
  let exitCode = EXIT_CODES.OK;
  if (verdict.tier === TIERS.BROKEN) exitCode = EXIT_CODES.BLOCKED;
  else if (
    verdict.tier === TIERS.PENDING
    || !injectOk
    || armorOn === false
    || commandOk === false
    || !validateOk
    || warnings.length
    || hostMatch === false
  ) exitCode = EXIT_CODES.TODO;
  lines.push(`退出码 / exit: ${exitCode}（0 全绿 / 1 有待办 / 2 有阻断；CLI: dsh-pojia --doctor）`);

  const summary = [
    `dsh-pojia ${input.pluginVersion || ""}`.trim(),
    surface,
    input.hostVersion ? `DSH ${input.hostVersion}` : "DSH 版本未识别",
    `${applied}/${total} applied`,
    armor ? `armor ${armorOn ? "on" : "off"}/${armor.mode || "-"}` : "armor 不可用",
    input.command ? (commandOk ? "命令 /pojia ok" : "命令 /pojia 未注册") : "",
    `人设 ${persona.current || "-"}`,
    row ? `validate ${row.rate === null ? "-" : `${row.rate}%`}（pass=${row.pass} fail=${row.fail} skip=${row.skip}）` : "validate 尚未验证",
    `verdict ${TIER_LABEL[verdict.tier] || verdict.tier}`,
  ].filter(Boolean).join(" · ");
  lines.push(`— 可直接贴论坛 / paste-ready —\n${summary}`);

  return { exitCode, text: lines.join("\n"), verdict, summary };
}
