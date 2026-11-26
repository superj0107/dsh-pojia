/**
 * 红队会话默认开启官方 Agent Teams 任务板。
 *
 * 官方把"用不用团队任务板"做成了**会话级开关**，不是预设级：
 *   dsh-agent-team 的 TeamService.isEnabled(caller) 读的是
 *   ctx.subagents.rootOf(caller).session 上的 `team/mode` 事件投影；
 *   `defaultEnabled` 默认 false，没人写这条事件就永远关着。
 *   四个工具（team_task_create/list/get/update）注册时带
 *   `when: ({agent}) => enabled(agent)`，关着的时候根本不进工具目录。
 *
 * 也就是说"标准模式不用就没有"这件事官方已经做对了 —— 它靠条件缺席，
 * 不是靠删代码。红队要的"默认用"，就是**在红队根会话上补写一条 team/mode**。
 *
 * 三个必须守住的边界：
 *   1. 只写**根会话**。isEnabled 只读 rootOf 的投影，给子会话写没用，
 *      而且子会话写下去会变成自己的 root 状态的噪音。
 *   2. 只写**一次**。已经存在 team/mode 事件（哪怕 enabled:false）就不再碰 ——
 *      用户手动关掉之后我们不能每次都替他打开。
 *   3. 只对**红队会话**写。别的预设一条都不写，否则就把隔离破坏了。
 */
import { isRedteamPresetId, isRedteamSession } from '../identity.js'

/** 已经检查过的 session，避免每一步都扫事件表。进程内即可，重启重扫。 */
const checked = new WeakSet()
const CHECKED_CAP = 2000
let checkedCount = 0

/** 会话事件表。两个来源都试，宿主版本不同字段不同。 */
function eventsOf(session) {
  const out = []
  try {
    if (typeof session?.snapshotEvents === 'function') {
      const got = session.snapshotEvents()
      if (Array.isArray(got)) out.push(...got)
    }
  } catch { /* 读不到历史就退回 session.events */ }
  try {
    if (Array.isArray(session?.events)) out.push(...session.events)
  } catch { /* 没有事件数组 */ }
  return out
}

/** 会话日志里是否已经有 team/mode —— 有就说明用户或我们表过态，不再插手。 */
function hasTeamModeEvent(session) {
  return eventsOf(session).some((event) => event && event.type === 'team/mode')
}

/**
 * 能不能确定这个会话"就是非红队"。
 *
 * 预设 id 可能在会话刚创建的那一瞬还没落到 header 上；把"读不到"当成
 * "非红队"会永久错过这条会话，所以这里把空值单独区分出来，允许下次再判。
 */
function presetKnown(session) {
  const header = session?.header
  if (!header) return false
  if (String(header.agentPreset || '').trim()) return true
  return eventsOf(session).some((event) => event && event.type === 'agent-preset/selected')
}

/**
 * 这个会话是不是它自己那棵协作树的根。
 *
 * 只认宿主 `rootOf()` 用到的两个信号：委派来源 `origin`、委派深度。
 * **不要看 `parentSession`** —— 宿主的"从历史续接 / 分支"也会写它，
 * 那种会话 `delegationDepth` 仍是 0，运行时它自己就是根（`rootOf(它) === 它`）。
 * 早前拿 `!header.parentSession` 当判据，把服务器上所有续接出来的红队会话
 * 全判成了子代理，`team/mode` 一条都没写进去。
 */
function isRootSession(session) {
  const header = session?.header
  if (!header) return true
  const origin = String(header.origin || '').toLowerCase()
  if (origin === 'subagent' || origin === 'teammate' || origin === 'delegate') return false
  return Number(header.delegationDepth ?? 0) <= 0
}

/**
 * 幂等：红队根会话若从未表过态，补一条 `team/mode { enabled: true }`。
 *
 * **不要把「暂时不是红队」钉死。** 用户是在会话里中途切预设的：会话按
 * standard 建出来，之后才 `agent-preset/selected: redteam`。早前把那种会话
 * 记进 `checked` 之后就再也不看它，切过去也永远不写 `team/mode` ——
 * 实测的 SESSION_REMOVED 就是这么漏掉的（99 个工具里一个 team_task_* 都没有）。
 *
 * 只有两种结局可以钉死：
 *   · 已经表过态（有 team/mode 事件，或者我们刚写了一条）
 *   · 明确判定为非根（子代理永远轮不到它写，重复扫没意义）
 * 其余（非红队 / 预设未决 / 出错）都不钉，让调用方下一轮再判一次。
 *
 * @param {object} session - 目标 Session（带 append 方法）。
 * @returns {'enabled'|'skip-not-redteam'|'skip-unknown-preset'|'skip-not-root'|'skip-already'|'skip-no-session'|'error'}
 */
export function ensureRedteamTeamMode(session, check) {
  if (!session || typeof session.append !== 'function') return 'skip-no-session'
  /* 已经有 team/mode 事件（用户手动关掉也算表过态）就不再碰。这一条比
     checked 更可靠：它读的是真相，不是我们自己的缓存。 */
  if (hasTeamModeEvent(session)) {
    markChecked(session)
    return 'skip-already'
  }
  if (checked.has(session)) return 'skip-already'
  let redteam = false
  try {
    redteam = check ? check({ agent: { session } }) : isRedteamSession({ agent: { session } })
  } catch {
    redteam = false
  }
  if (!redteam) {
    /* 预设还没落到会话头上 —— 别钉死，留给下一轮再判。 */
    if (!presetKnown(session)) return 'skip-unknown-preset'
    /* 预设明确不是红队：**不钉**。用户随时可能切到红队，
       切了之后 pre-step 要还能重新判一次。 */
    return 'skip-not-redteam'
  }
  if (!isRootSession(session)) {
    markChecked(session)
    return 'skip-not-root'
  }
  markChecked(session)
  try {
    session.append('team/mode', { enabled: true })
    return 'enabled'
  } catch {
    return 'error'
  }
}

/**
 * 会话切换预设后放开一次判定。
 *
 * 宿主切预设只发 `agent-preset/selected`，**不发 `agent/created`**，
 * 所以创建时按 standard 判过的会话必须在这里被重新放行一次。
 */
export function forgetTeamModeCheck(session) {
  try { checked.delete(session) } catch { /* ignore */ }
}

/**
 * 判断这一版宿主的 Team 是不是「会话级开关」那套。
 *
 * 0.2.2-rc.2 之前是 `dsh-experimental-agent-team`：没有投影、没有 `team/mode`，
 * 四个 team 工具由 `tryMembership()` 常开（根会话天然就是 lead）。
 * rc.2 之后换成 `dsh-agent-team`：`team/mode` 投影 + `defaultEnabled:false` +
 * 工具 `when` 门控，不写事件就没有工具。
 *
 * 写错版本不会崩，但会把一条宿主不认识的 `team/mode` 塞进会话日志，
 * 而且 rc.1 根本不需要它 —— 那就别写。
 */
function hostUsesTeamGate(ctx) {
  try {
    const team = typeof ctx?.get === 'function' ? ctx.get('agentTeams') : ctx?.agentTeams
    if (team === void 0 || team === null) return true /* 读不到就按新版走，写事件是安全的那一侧 */
    /* rc.2+ 有 isEnabled（读投影）；rc.1 experimental 只有 membership/tryMembership。 */
    return typeof team.isEnabled === 'function'
  } catch {
    return true
  }
}

function markChecked(session) {
  checked.add(session)
  checkedCount += 1
  /* WeakSet 自己会回收，这里只是防同一批会话对象被反复计数。 */
  if (checkedCount > CHECKED_CAP) checkedCount = 0
}

/**
 * 挂到宿主事件上。
 *
 * 三个入口，覆盖"预设什么时候挂上"的全部时序：
 *   · `agent/created`    —— 会话头已经带 agentPreset 的常见路径（同步写）
 *   · `session/event` 上的 `agent-preset/selected`
 *                        —— 用户创建后中途切预设（宿主不发 agent/created）
 *   · `agent/pre-step`   —— 兜底，任何一步都能重判一次
 *
 * 全都 global：宿主按 `scopeTarget(agent, agent)` 派发，不带 global 挂在插件
 * 自己的 ctx 上收不到。检查本身用 isRedteamSession 兜底，非红队一律不写。
 */
export function installTeamMode(ctx, config = {}) {
  if (config.redteamTeamMode === false) return () => {}
  if (typeof ctx?.on !== 'function') return () => {}
  /* rc.1 的 experimental team 本来就常开，一条都不用写。 */
  if (!hostUsesTeamGate(ctx)) return () => {}

  const offs = []
  const decided = new WeakSet()

  const handle = (agent, check) => {
    const session = agent?.session
    if (!session) return 'skip-no-session'
    try { return ensureRedteamTeamMode(session, check) } catch { return 'error' }
  }

  try {
    offs.push(ctx.on('agent/created', ({ agent }) => {
      /* 子会话不写（isRootSession 也会挡），这里先挡一次省掉事件扫描。 */
      if (!isRootSession(agent?.session)) return
      /* 同步写，不走微任务：宿主是在 announce 的 serial 派发里发这条事件，
         我们自己也是 await 链上的一环。同步 append 才能保证它在 createAgent
         返回之前落到日志里 —— 第一轮第一步的 tools.resolve 才会看见 team_task_*。
         官方 defaultEnabled 也是在这个事件里直接 setEnabled 的，同一时序。
         listener 抛错会让 serial 注册失败，所以整段包在 try 里。 */
      try { handle(agent) } catch { /* ignore */ }
    }, { global: true, prepend: true }))
  } catch { /* 老宿主无 agent/created */ }

  /*
   * 用户在会话里切预设：宿主只 append `agent-preset/selected`，
   * **不发 `agent/created`，也没有专门的 cordis 钩子**（写入点在
   * dsh-agent-preset-registry 的 `select()` 里，直接调 `session.append`）。
   * 唯一能观察到的入口就是通用的 `session/event`。
   *
   * 不在这里同步写：`session.append` 的处理链里再 append 会被宿主拒绝。
   * 推到微任务，赶在玩家下一句发出去之前落地就够 —— 切完预设人还要打字。
   */
  try {
    offs.push(ctx.on('session/event', (session, event) => {
      try {
        if (event?.type !== 'agent-preset/selected') return
        const data = event.data || {}
        const preset = data.agentPreset ?? data.preset ?? data.name
        /* 切到非红队也要放行：用户可能红队→标准→再切回来。 */
        forgetTeamModeCheck(session)
        decided.delete(session)
        if (!isRedteamPresetId(preset)) return
        if (!isRootSession(session)) return
        /* 事件已经回答了"现在是不是红队"，不要再让 ensureRedteamTeamMode
           回头读会话头重判一次 —— 会话头停在创建时的 `standard`，
           重判会把刚刚切过来的这条会话判成非红队。 */
        queueMicrotask(() => {
          try { handle({ session }, () => true) } catch { /* ignore */ }
        })
      } catch { /* 观察者不能抛 */ }
    }, { global: true }))
  } catch { /* 老宿主无 session/event */ }

  try {
    offs.push(ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      /* 不再限定 step === 1：切预设发生在哪一步都可能。真正的幂等由
         ensureRedteamTeamMode 里的 `hasTeamModeEvent` 兜住 —— 写过就不再写，
         所以这里每步扫一次事件表的代价可以接受（一张会话通常几十条事件）。 */
      const session = agent?.session
      if (session && !decided.has(session)) {
        const outcome = handle(agent)
        /* 只有"知道该不该开"的结论才钉死这一步；预设未决 / 出错下一轮再看。 */
        if (outcome === 'enabled' || outcome === 'skip-already' || outcome === 'skip-not-root') decided.add(session)
      }
      return typeof next === 'function' ? next() : undefined
    }, { global: true, prepend: true }))
  } catch { /* 老宿主无 agent/pre-step */ }

  return () => {
    for (const off of offs) {
      try { off() } catch { /* 已释放 */ }
    }
  }
}
