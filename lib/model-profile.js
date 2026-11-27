// 模型画像层：把「当前这轮到底跑在哪个 provider/model 上」变成注入决策。
//
// 为什么要这一层：注入形态（user / legacy / both）与注入正文（人设）不该由用户手动猜。
// 宿主在 `agent/pre-step` 的 payload 里已经给了 `modelSelection = { provider, model }`，
// 这是**权威值**，不是从配置文件里推断出来的——本文件只负责把它映射成决策。
//
// 设计原则：
//   1. 纯函数、无 I/O、无网络：输入 selection + 配置，输出决策，方便单测与复现。
//   2. 用户显式设置永远优先（`/pojia armor mode` 会把 runtime.pinned 置位），
//      自适应只在「用户没钉」时生效，绝不偷偷改掉用户的选择。
//   3. 每条规则都写清理由，不靠感觉调参；不确定的模型落到 unknown，行为与默认一致。
import { listPersonas, readState } from "./persona.js";

/**
 * 模型族规则表。`mode` 是「该族推荐的注入通道」：
 *   user   = 只在会话里追加一条带 source 的 user 消息（不碰 system 段）
 *   legacy = 只走 system 双层段
 *   both   = 两条都走（system 段权重高的模型用这个，避免单通道被稀释）
 * 依据：各家对 system 段与「注入上下文」的权重不同；这里给的是保守默认，
 * 真实效果仍要用 /pojia validate 在本机实测，doctor 会把 fail 归因反推回决策。
 */
export const MODEL_FAMILIES = Object.freeze({
  deepseek: {
    label: "DeepSeek",
    test: /deepseek|ds-?chat|deepseek-v\d/i,
    mode: "user",
    why: "宿主原生注入通道（user 段）读取稳定，system 段已被宿主清洗改写",
  },
  claude: {
    label: "Claude",
    test: /claude|anthropic|opus|sonnet|haiku/i,
    mode: "both",
    why: "对 system 段权重高，双通道能减少单通道被长上下文稀释",
  },
  gpt: {
    label: "GPT",
    test: /gpt|o[1-4](-|$)|chatgpt|openai/i,
    mode: "both",
    why: "system/developer 段权重高，双通道更稳",
  },
  gemini: {
    label: "Gemini",
    test: /gemini|gemma|google/i,
    mode: "both",
    why: "system instruction 与 user 段都会参与判定，双通道更稳",
  },
  glm: {
    label: "GLM",
    test: /glm|chatglm|zhipu|智谱/i,
    mode: "user",
    why: "中文长上下文里 user 段更直接，system 段容易被平台改写",
  },
  kimi: {
    label: "Kimi",
    test: /kimi|moonshot/i,
    mode: "user",
    why: "同上：先走 user 单通道，实测不行再切 both",
  },
  qwen: {
    label: "Qwen",
    test: /qwen|tongyi|通义/i,
    mode: "user",
    why: "同上",
  },
  llama: {
    label: "Llama/Mistral",
    test: /llama|mistral|mixtral|qwen2|local/i,
    mode: "user",
    why: "本地/开源权重模型对 system 段支持差异大，先用最稳的 user 通道",
  },
  unknown: {
    label: "未知模型",
    test: null,
    mode: "user",
    why: "没识别出模型族，保持默认单通道，避免无根据的双段注入",
  },
});

export const FAMILY_KEYS = Object.freeze(Object.keys(MODEL_FAMILIES));

/** 认模型族：先看 model 名，再看 provider 名（中转常用 provider 名标注厂商）。 */
export function classifyModel(selection = {}) {
  const model = String(selection.model || "").trim();
  const provider = String(selection.provider || "").trim();
  const haystack = `${model} ${provider}`;
  if (!haystack.trim()) return { family: "unknown", matchedOn: "" };
  for (const key of FAMILY_KEYS) {
    const rule = MODEL_FAMILIES[key];
    if (!rule.test) continue;
    if (model && rule.test.test(model)) return { family: key, matchedOn: "model" };
  }
  for (const key of FAMILY_KEYS) {
    const rule = MODEL_FAMILIES[key];
    if (!rule.test) continue;
    if (provider && rule.test.test(provider)) return { family: key, matchedOn: "provider" };
  }
  return { family: "unknown", matchedOn: "" };
}

/** 人设的 `model: ["*"]` / `model: [claude, gpt]` 元数据第一次真正派上用场：按模型挑人设。 */
export function personaForModel(family, personas = null) {
  const list = Array.isArray(personas) ? personas : listPersonas();
  const tagsOf = (p) => (Array.isArray(p.model) ? p.model.map((t) => String(t).toLowerCase()) : ["*"]);
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
  // 「点名该族」优先于通配 "*"：否则 order 最小的内置人设会把所有模型都吃掉。
  const specific = list.filter((p) => tagsOf(p).includes(family)).sort(byOrder);
  const wildcard = list.filter((p) => tagsOf(p).includes("*") && !tagsOf(p).includes(family)).sort(byOrder);
  if (!specific.length && !wildcard.length) return null;
  let current = "";
  try {
    current = readState().current;
  } catch { /* 读不到状态就按优先级取 */ }
  // 当前人设只要还在同一层里就别来回换（用户看到的那份正文保持稳定）。
  const keep = (pool) => pool.find((p) => p.id === current) || null;
  if (specific.length) return keep(specific) || specific[0];
  return keep(wildcard) || wildcard[0];
}

/**
 * 生成模型画像：
 *   { family, label, provider, model, relay, recommendedMode, why, persona, note }
 * relay = 走非官方域名（疑似中转）时，过滤行为不可控，注入效果可能被中间层改写。
 */
export function profileFor(selection = {}, options = {}) {
  const { family, matchedOn } = classifyModel(selection);
  const rule = MODEL_FAMILIES[family] || MODEL_FAMILIES.unknown;
  const relay = Boolean(options.relay);
  const persona = options.persona === false ? null : personaForModel(family, options.personas);
  const notes = [];
  if (relay) notes.push("疑似中转：过滤/改写发生在中间层，先跑 validate 并用 gateway 归因");
  if (family === "unknown" && matchedOn === "") notes.push("没识别出模型族，按默认通道走");
  return {
    family,
    label: rule.label,
    provider: String(selection.provider || ""),
    model: String(selection.model || ""),
    relay,
    recommendedMode: rule.mode,
    why: rule.why,
    persona: persona ? { id: persona.id, name: persona.name, order: persona.order } : null,
    note: notes.join("；"),
  };
}

/**
 * 注入决策：谁说了算。
 * 优先级：用户钉住（/pojia armor mode 或配置里的显式 injectionMode）> 模型画像 > 默认。
 * 返回 { mode, source, reason }，source ∈ pinned | profile | default。
 */
export function decideInjection(profile, options = {}) {
  const pinned = options.pinned === true;
  const runtimeMode = String(options.runtimeMode || "").trim();
  if (pinned && runtimeMode) {
    return { mode: runtimeMode, source: "pinned", reason: "用户显式设置过注入通道，自适应不覆盖" };
  }
  const recommended = String(profile?.recommendedMode || "").trim();
  if (recommended) {
    return {
      mode: recommended,
      source: "profile",
      reason: `${profile.label || profile.family || "模型"} 推荐 ${recommended}（${profile.why || "按模型族默认"}）`,
    };
  }
  return { mode: runtimeMode || "user", source: "default", reason: "无画像信息，用默认通道" };
}

/** 一行展示：`claude / opus-5-5 → both（Claude 推荐 both）/ 人设 pojia-armor` */
export function describeProfile(profile) {
  if (!profile) return "未识别（还没跑过一轮，宿主没给 modelSelection）";
  const head = [profile.provider, profile.model].filter(Boolean).join(" / ") || profile.family;
  const persona = profile.persona ? ` · 人设 ${profile.persona.id}` : "";
  const relay = profile.relay ? " · 疑似中转" : "";
  return `${head} → ${profile.recommendedMode}（${profile.label}）${persona}${relay}`;
}
