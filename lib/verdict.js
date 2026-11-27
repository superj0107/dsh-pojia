// dsh-pojia 结论层（verdict）：status / doctor / CLI 共用同一套三态判定。
// 用户反馈（L 站 #5 #6 + 私信）：status 只给明细，看不出「到底算成功没有」。
// 这里只读本地状态：不发网络请求、不写任何文件、不改补丁。
import fs from "node:fs";

export const TIERS = Object.freeze({
  READY: "ready",
  PENDING: "pending",
  BROKEN: "broken",
});

export const TIER_LABEL = Object.freeze({
  ready: "已就绪",
  pending: "待处理",
  broken: "异常",
});

// 退出码口径（doctor / CLI 共用）：全绿 0，有待办 1，有阻断 2。
export const EXIT_CODES = Object.freeze({ OK: 0, TODO: 1, BLOCKED: 2 });

function exists(fp) {
  if (!fp || typeof fp !== "string") return false;
  try {
    return fs.existsSync(fp);
  } catch {
    return false;
  }
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 三态判定。state 来自 core.gatherState()；extra 是覆盖/补充项：
 *   extra.enabled        注入总开关（config.enabled）；未知时传 undefined
 *   extra.overrideExists 覆盖「注入文件是否在」的探测（测试用）
 *   extra.surface        覆盖 surface
 *
 * 「就绪」口径与宿主层对齐：core.patchStatusReady() 把 applied / already / off /
 * skipped / missing_file（当前版本不需要或组件未装）都算可接受，这里用它的汇总
 * （display_ready）判断，避免把「可选补丁模式没命中」误报成异常。
 * 唯一加强的一条：一份补丁都没真正写进去（applied === 0）时绝不说「已就绪」，
 * 否则会出现「0/26 applied 却说成功」的假成功。
 */
export function verdictFor(state = {}, extra = {}) {
  const surface = String(state.surface || extra.surface || "");
  const applied = count(state.display_applied ?? state.patches_applied);
  const total = count(state.display_total ?? state.patches_total);
  const pending = count(state.display_pending ?? state.patches_pending);
  const skipped = count(state.display_skipped ?? state.patches_skipped);
  const ready = count(state.display_ready ?? state.patches_ready ?? (applied + skipped));
  const injectFile = state.override_path || "";
  const injectThere = extra.overrideExists === undefined ? exists(injectFile) : Boolean(extra.overrideExists);
  const base = { applied, total, pending, skipped, ready, surface };

  // 1) 插件根都没有，后面全是空转。
  if (!state.ai_base) {
    const why = state.web_no_package
      ? "web 跑在官方 app.asar 里，还没解开"
      : "没定位到宿主的 @deepseek-ai 目录";
    return {
      ...base,
      tier: TIERS.BROKEN,
      text: `异常：插件根缺失（${why}）`,
      next: "点面板「应用」让它解开/定位宿主；还不行就跑 /pojia doctor 看诊断，或用一键安装脚本重装",
    };
  }

  // 2) 还有待处理补丁：先清洗，再谈别的。
  if (pending > 0) {
    return {
      ...base,
      tier: TIERS.PENDING,
      text: `待处理：${pending} 项 pending，请执行 /pojia apply 后完全重启宿主`,
      next: "/pojia apply",
    };
  }

  // 3) 有补丁既不 applied 也不「当前版本不需要」（hard 未命中）：宿主版本/布局对不上。
  if (total > 0 && ready < total) {
    return {
      ...base,
      tier: TIERS.BROKEN,
      text: `异常：${total - ready} 项补丁未就绪（替换模式在宿主里没命中，多半是宿主版本对不上）`,
      next: "/pojia doctor 看是哪几项；确认宿主版本与 dshTarget 一致后再 /pojia apply",
    };
  }

  // 4) 假成功防线：可接受的「跳过」再多，也不能一份补丁都没写进去。
  if (total > 0 && applied === 0) {
    return {
      ...base,
      tier: TIERS.BROKEN,
      text: `异常：0/${total} applied —— ${skipped} 项全部跳过，补丁一份都没写进宿主`,
      next: "/pojia doctor 看明细：宿主文件对不上时属于版本不匹配，别当成功",
    };
  }

  // 5) 补丁都到位了，但注入文件被删了：等于没注入。
  if (!injectThere) {
    return {
      ...base,
      tier: TIERS.BROKEN,
      text: `异常：注入文件缺失（${injectFile || "$DSH_HOME/prompt-inject.md"}）`,
      next: "/pojia edit（会生成默认注入文件），然后完全重启宿主",
    };
  }

  // 6) 补丁写进了解开目录，但当前进程还在读 app.asar：必须完全退出重开。
  if (state.asar_still_sealed && applied > 0) {
    return {
      ...base,
      tier: TIERS.BROKEN,
      text: "异常：app.asar 仍密封 —— 补丁写在解开目录，当前进程读不到",
      next: "完全退出宿主（不是刷新页面、不是关窗口）后重新打开",
    };
  }

  let injectText;
  if (typeof extra.enabled === "boolean") injectText = extra.enabled ? "注入开启" : "注入已关闭（config.enabled=false）";
  else injectText = "注入文件在";

  return {
    ...base,
    tier: TIERS.READY,
    text: `已就绪（补丁 ${applied}/${total} applied，${injectText}）`,
    next: "/pojia validate list（拿探针去会话里实跑，再用 validate record 记结果）",
  };
}

/** status 顶部固定两行：结论 + 下一步。 */
export function verdictLines(state = {}, extra = {}) {
  const v = verdictFor(state, extra);
  return [`结论 / verdict: ${v.text}`, `下一步 / next: ${v.next}`];
}

export function isReady(state = {}, extra = {}) {
  return verdictFor(state, extra).tier === TIERS.READY;
}
