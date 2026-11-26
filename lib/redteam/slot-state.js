/**
 * 并发名额的"挂起"状态：执行智能体回报 `waiting` / `blocked`（在等人给 key / VPS / 范围）时
 * 主动让出名额，主会话再派新活时不会被"空等的智能体"堵死。
 *
 * 为什么单独一个文件：工具层（tools.js）写、面板层（ui.js）读，
 * 两边共用一个 Map 才不会出现"工具说还有名额、面板说满了"。
 * 这里只放状态与读写，不含任何 host 依赖，任何一侧都能安全 import。
 */

/** 根会话 id → Set<子会话 id> */
const parked = new Map()

/** 上限保护：长开进程里子会话 id 会一直涨。 */
const PARKED_CAP = 500

function capMap(m, cap) {
  const origSet = m.set.bind(m)
  m.set = (k, v) => {
    if (!m.has(k) && m.size >= cap) {
      const first = m.keys().next().value
      if (first !== undefined) m.delete(first)
    }
    return origSet(k, v)
  }
}
capMap(parked, PARKED_CAP)

export function parkAgent(rootId, childId) {
  if (rootId === undefined || childId === undefined) return false
  if (!parked.has(rootId)) parked.set(rootId, new Set())
  parked.get(rootId).add(String(childId))
  return true
}

export function unparkAgent(rootId, childId) {
  const set = parked.get(rootId)
  if (set === undefined) return false
  const dropped = set.delete(String(childId))
  if (set.size === 0) parked.delete(rootId)
  return dropped
}

export function isParked(rootId, childId) {
  const set = parked.get(rootId)
  return set !== undefined && set.has(String(childId))
}
