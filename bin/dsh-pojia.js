#!/usr/bin/env node

import fs from "node:fs";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as persona from "../lib/persona.js";
import * as effectCheck from "../lib/effect-check.js";
import { verdictLines } from "../lib/verdict.js";
import { buildDoctor, detectHostVersion } from "../lib/doctor.js";
import { readProviderInfo, describeProvider } from "../lib/provider-info.js";

const args = process.argv.slice(2);

function printStatus(state, extra = {}) {
  const surface = state.surface || "web";
  // 桌面版与官方打包 web 都不改 shim：`missing` / 「未定位」只是噪音。
  const shimNA = surface === "desktop"
    || [state.shim_cmd, state.shim_ps1, state.shim_bin].every((s) => s === "n/a");
  const shimNote = surface === "desktop"
    ? "n/a（桌面版不需要改 shim）"
    : "n/a（官方打包 Web 不需要改 shim）";
  const out = [];
  out.push("dsh-pojia 状态 / Status");
  // v1.0.5：先给结论 + 下一步，再给明细（用户反馈「到底算不算成功」）。
  out.push(...verdictLines(state, { surface }));
  out.push("  宿主 / surface " + surface);
  out.push("  DSH_HOME      " + state.dsh_home);
  out.push("  模型 / provider " + describeProvider(extra.provider || readProviderInfo(state.dsh_home)));
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  // 桌面版按设计不改 shim，CLI 也跟着闭嘴，别把 missing 甩给用户当报错。
  out.push(shimNA
    ? `  shim 目录      ${shimNote}`
    : `  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push("");
  out.push(`  补丁 ${state.patches_applied}/${core.ALL_PATCHES.length} 已清洗, ${state.patches_pending} 待清洗`);
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id] || "n/a";
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(shimNA
    ? `  shim: ${shimNote}`
    : `  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  return out.join("\n");
}

function readPluginTargets() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (Array.isArray(pkg.dshTargets) && pkg.dshTargets.length) return { pkg, targets: pkg.dshTargets };
    if (pkg.dshTarget) return { pkg, targets: [pkg.dshTarget] };
    return { pkg, targets: [] };
  } catch {
    return { pkg: {}, targets: [] };
  }
}

async function runDoctor() {
  const state = await core.gatherState();
  const { pkg, targets } = readPluginTargets();
  const host = detectHostVersion(state.ai_base);
  let personaInfo = { current: "", total: 0 };
  try {
    personaInfo = { current: persona.readState().current, total: persona.listPersonas().length };
  } catch { /* 人设库还没就绪 */ }
  let injectBytes = 0;
  try { injectBytes = fs.statSync(state.override_path).size; } catch { /* 注入文件还没建 */ }
  const report = buildDoctor({
    state,
    config: {},
    armor: null, // CLI 读不到运行时开关，doctor 会标「不可用」而不是瞎猜
    persona: personaInfo,
    validation: effectCheck.report(),
    probeWarnings: effectCheck.probeWarnings(),
    provider: readProviderInfo(state.dsh_home),
    hostVersion: host.version,
    hostVersionSource: host.source,
    targets,
    pluginVersion: String(pkg.version || ""),
    injectBytes,
  });
  console.log(report.text);
  return report.exitCode;
}

async function main() {
  const mode = args.find((a) => ["--apply", "--revert", "--uninstall", "--status", "--doctor", "--edit", "--help"].includes(a));

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-pojia 用法:
  dsh-pojia --status     显示状态（第一屏就是结论 + 下一步）
  dsh-pojia --doctor     诊断：安装 / 注入 / 有效性；退出码 0 全绿 / 1 有待办 / 2 有阻断
  dsh-pojia --apply      应用全部清洗（提示词+代码+shim+override）
  dsh-pojia --revert     回滚还原
  dsh-pojia --uninstall  卸载插件（已应用则先还原）
  dsh-pojia --edit       编辑注入文件 prompt-inject.md
  dsh-pojia --help       帮助`);
    return;
  }

  if (mode === "--doctor") {
    process.exit(await runDoctor());
  }

  const state = await core.gatherState();
  console.log(printStatus(state));
  console.log("");

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      process.exit(1);
    }
    const { hosts, report } = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
      preserveClientBundles: false,
      forApply: true,
    });
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    if (hosts.length > 1) {
      console.log(`  多宿主 / multi-host: ${hosts.length} 份 @deepseek-ai 已清洗`);
    }
    console.log(inject.source === "rule"
      ? "  - 使用当前规则集，不改写提示词文件"
      : "  - 使用已有提示词文件");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else if ((state.surface || "web") !== "desktop") {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    console.log("");
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
    console.log("下一步 / next: dsh-pojia --doctor 看结论 → /pojia validate list 跑探针");
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors } = await core.revertAllHosts();
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。");
    if (result.override?.removed) console.log(`  已删除 ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。");
      process.exit(1);
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。");
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-pojia] error:", e);
  process.exit(1);
});
