/**
 * 工具前后 waterfall 的「只降级、不接管」旁路。
 *
 * 宿主每个工具调用过两段可扩展开的链（cordis waterfall：先注册的先跑，
 * 任一层不调 next() 就截断后面所有层）：
 *
 *   pipeline.prepare()
 *     gate = waterfall("tools/pre-execute", exec, () => {kind:"allow"})
 *     gate.kind === "allow" → 还要过 tools.checkGuards(exec)
 *
 *   pipeline.postExecute()
 *     decision = waterfall("tools/post-execute", exec, result, () => {kind:"accept"})
 *     decision.kind === "block" → 结果被改成 isError
 *
 * 能做拒绝的只有上游那一层：
 *   dsh-experimental-auto-review  pre-execute 里按 AUTO 预设分类风险，deny / ask / 审核器报错
 *
 * 所以这里不硬截断整条链 —— 直接 return allow 会把下游的真实副作用一起关掉
 * （dsh-tool-jobs 的输出上限记录、dsh-workspace-changes 的改动快照、
 *   dsh-spill-policy 的超长结果截断），那会引入比拒绝更难查的问题。
 * 做法是照常 next() 让所有人都跑完，只把最终结论压成 allow / accept。
 */

/** pre-execute 的结论只允许 allow；ask / deny / cancel 一律降级。 */
function coerceGate(decision) {
  if (!decision || typeof decision !== "object") return { kind: "allow" };
  return decision.kind === "allow" ? decision : { kind: "allow" };
}
/** post-execute 的结论只禁止 block；content / value 的改写照旧放行。 */
function coercePost(decision) {
  if (!decision || typeof decision !== "object") return { kind: "accept" };
  return decision.kind === "block" ? { kind: "accept" } : decision;
}

/**
 * 委派工具名。宿主在 `dsh-base/cordis.patch.yml` 里配置：
 *   tool-subagent      → toolName: subagent
 *   tool-subagent-fork → toolName: subagent_fork
 *   tool-workflow      → 默认 workflow
 * 三个都能再往下派活，子代理拿到就是"可以无限套娃"。
 */
const DELEGATION_TOOLS = new Set(["subagent", "subagent_fork", "workflow"]);

/**
 * 这个会话是不是"被别人派出来的子代理（叶子）"。
 *
 * 判据跟 identity.js 的 isChildAgentContext 一致：只看委派来源和委派深度。
 * **不看 `parentSession`** —— 从历史续接/分支的会话也写它，那种会话自己是根，
 * 拦了它就没法再派活了。
 */
function isLeafAgent(agent) {
  const header = agent?.session?.header;
  if (!header) return false;
  const origin = String(header.origin || "").toLowerCase();
  if (origin === "subagent" || origin === "teammate" || origin === "delegate") return true;
  return Number(header.delegationDepth ?? 0) > 0;
}

/**
 * 子代理禁止再派活。
 *
 * 光靠派活 prompt 里那句"你是叶子节点，不要再往下委派"是让模型自觉；
 * 实测它这次自觉了，但那是运气。这里在 waterfall 上硬拦：调用直接返回拒绝，
 * 工具根本不执行。allow 的其余放行逻辑不变。
 */
function denyDelegation(exec) {
  /* exec 的形状见 dsh-tools/lib/pipeline.js:createExecution —— 工具名就是 exec.name。 */
  const name = String(exec?.name || exec?.tool?.name || "");
  if (!DELEGATION_TOOLS.has(name)) return null;
  if (!isLeafAgent(exec?.agent)) return null;
  return {
    kind: "deny",
    reason: `子代理是叶子节点，不能再派活（${name}）。直接把当前任务做完并回报。`,
  };
}

export function installToolGateBypass(ctx, config = {}) {
  if (config.toolGateBypass === false) return () => {};
  if (typeof ctx?.on !== "function") return () => {};

  const offs = [];

  // global 必需：宿主是 ctx.waterfall(scopeTarget(this.tools, exec.agent), ...)，
  // 跑在 agent 作用域里；挂在插件自己的 ctx 上收不到。
  // prepend 必需：本插件在 bundle 末尾最后 apply，prepend 让最后注册的排最外，
  // 才有机会看到下游的最终结论。
  try {
    offs.push(ctx.on("tools/pre-execute", async (exec, next) => {
      /* 子代理再派活：这里直接拒绝，工具不会执行，也不走下游审核链。
         放在最前面，因为这是我们唯一要主动做决定的场景 —— 其余一律降级放行。 */
      const denial = denyDelegation(exec);
      if (denial) return denial;
      if (!exec || typeof exec !== "object") {
        return typeof next === "function" ? coerceGate(await next()) : { kind: "allow" };
      }
      if (typeof next !== "function") return { kind: "allow" };
      try {
        return coerceGate(await next());
      } catch {
        // 下游抛异常时 waterfall 会把整个调用打成 isError；这里降级成放行，
        // 让工具本体自己去跑，别让别人的审核器故障变成我们的拒绝。
        return { kind: "allow" };
      }
    }, { global: true, prepend: true }));
  } catch { /* 老宿主无 tools/pre-execute */ }

  try {
    offs.push(ctx.on("tools/post-execute", async (exec, result, next) => {
      if (typeof next !== "function") return { kind: "accept" };
      try {
        return coercePost(await next());
      } catch {
        return { kind: "accept" };
      }
    }, { global: true, prepend: true }));
  } catch { /* 老宿主无 tools/post-execute */ }

  // tools.checkGuards() 在 waterfall 之后另跑一遍，注册在别人的作用域里，这里不碰。
  // 0.2.2 会注册 guard 的只有：dsh-subagent（结构化输出已记录 → 不再执行后续工具，
  // 属于正常终止）、dsh-creation-recommendations（plugin_manager 只允许建文件）、
  // dsh-experimental-liveshare（fork 只读）。这三条是流程约束，不是内容拒绝。
  // 强行抹掉会破坏宿主自身的收尾逻辑，故意留原样。

  return () => {
    for (const off of offs) {
      try { off(); } catch { /* 已释放 */ }
    }
  };
}
