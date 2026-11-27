// 注入预算：内核正文 17KB，长会话里每轮都带一遍是实打实的 token 成本。
// 这里提供「按任务域挑段落」的压缩器：默认关闭（config.injectBudgetKB），开启后只在超预算时裁剪，
// 且**永远保留**开头覆盖声明与结尾的风格/锚点段落——砍掉的只能是中段的领域细则。
//
// 为什么默认关：裁剪会改变注入内容，效果必须用 /pojia validate 在本机 A/B 过才敢常开。
// 本模块只做机械工作（切段、按关键词挑段、拼接、记账），不做任何「猜用户想要什么」的花活。
import path from "node:path";
import os from "node:os";

// 领域关键词表：只用来判断「这一段是否与当前这一轮相关」，命中任一即保留。
export const DOMAIN_HINTS = Object.freeze([
  { key: "pentest", label: "渗透", re: /渗透|打点|漏洞|注入\b|sqli|xss|ssrf|提权|横向|getshell|红队|靶场|payload/i },
  { key: "reverse", label: "逆向", re: /逆向|反编译|脱壳|frida|hook|ida|ghidra|radare|破解|注册机|keygen|smali/i },
  { key: "adult", label: "成人", re: /色情|黄文|露骨|nsfw|成人|番号|找片|情色/i },
  { key: "code", label: "代码", re: /代码|脚本|实现|重构|单测|测试|报错|bug|函数|接口|编译|依赖/i },
  { key: "writing", label: "写作", re: /文案|写作|润色|总结|翻译|报告|标题|摘要/i },
  { key: "ops", label: "运维", re: /运维|部署|服务器|docker|k8s|nginx|数据库|备份/i },
]);

function dshHome() {
  return (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
}
/** 预算相关的状态目录（目前只用来放最近的裁剪记录，便于排查） */
export function budgetDir() {
  return path.join(dshHome(), "pojia");
}

/**
 * 按 `## ` 标题切段。第一个 `## ` 之前的内容算前言段（title 为空）。
 * 返回 [{ title, body }]，body 含标题行。
 */
export function splitSections(text) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const lines = src.split("\n");
  const out = [];
  let buf = [];
  let title = "";
  const flush = () => {
    if (!buf.length) return;
    const body = buf.join("\n");
    if (body.trim()) out.push({ title, body });
    buf = [];
  };
  for (const line of lines) {
    const hit = /^##\s+(.+?)\s*$/.exec(line);
    if (hit) {
      flush();
      title = hit[1];
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** 从最近一条用户消息里推断本轮领域，返回命中 key 列表。 */
export function deriveHints(messages) {
  if (!Array.isArray(messages) || !messages.length) return [];
  let text = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const content = m?.content;
    if (typeof content === "string") {
      text = content;
      break;
    }
    if (Array.isArray(content)) {
      const joined = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("\n");
      if (joined.trim()) {
        text = joined;
        break;
      }
    }
  }
  if (!text.trim()) return [];
  return DOMAIN_HINTS.filter((d) => d.re.test(text)).map((d) => d.key);
}

function tagsOf(section) {
  return DOMAIN_HINTS.filter((d) => d.re.test(section.body)).map((d) => d.key);
}

/**
 * 挑段：head 段（免费声明）与 tail 段（风格/锚点）永远保留；中间只留命中领域关键词的段。
 * hints 为空时返回全部（不裁剪）——宁可多花 token，也不在没有信号时瞎砍。
 */
export function pickSections(sections, options = {}) {
  const hints = Array.isArray(options.hints) ? options.hints : [];
  const keepHead = Number.isInteger(options.keepHead) ? options.keepHead : 1;
  const keepTail = Number.isInteger(options.keepTail) ? options.keepTail : 2;
  const dropWhenNoHints = options.dropWhenNoHints === true;
  if (!sections.length) return { kept: [], dropped: [] };
  if (!hints.length && !dropWhenNoHints) return { kept: sections.slice(), dropped: [] };
  const keep = new Set();
  sections.forEach((s, i) => {
    const isHead = i < keepHead;
    const isTail = i >= sections.length - keepTail;
    if (isHead || isTail) {
      keep.add(i);
      return;
    }
    const tags = tagsOf(s);
    if (!tags.length) {
      keep.add(i); // 没有领域标签的段（通用规则）不裁
      return;
    }
    // 没有领域信号但调用方明确要求精简（子代理档位）：带领域标签的细则一律砍掉。
    if (!hints.length) return;
    if (tags.some((t) => hints.includes(t))) keep.add(i);
  });
  const kept = [];
  const dropped = [];
  sections.forEach((s, i) => (keep.has(i) ? kept : dropped).push({ ...s, index: i }));
  return { kept, dropped };
}

/**
 * 压缩入口：不超预算或没有领域信号就原样返回。
 * 返回 { text, trimmed, bytesBefore, bytesAfter, droppedSections, droppedTitles, hintKeys }
 */
export function compactPrompt(text, options = {}) {
  const src = String(text || "");
  const bytesBefore = Buffer.byteLength(src);
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 0;
  const hints = Array.isArray(options.hints) ? options.hints : [];
  const dropWhenNoHints = options.dropWhenNoHints === true;
  const result = { text: src, trimmed: false, bytesBefore, bytesAfter: bytesBefore, droppedSections: 0, droppedTitles: [], hintKeys: hints };
  if (!maxBytes || bytesBefore <= maxBytes) return result;
  if (!hints.length && !dropWhenNoHints) return result; // 没有领域信号：不裁，宁可超预算
  const sections = splitSections(src);
  if (sections.length < 3) return result; // 段太少，裁了只会破坏结构
  const { kept, dropped } = pickSections(sections, { hints, keepHead: 1, keepTail: 2, dropWhenNoHints });
  if (!dropped.length) return result;
  const keptText = kept.map((s) => s.body).join("\n");
  const saved = Math.max(0, bytesBefore - Buffer.byteLength(keptText));
  // 标记本身也占字节：省下来的量必须明显大于标记开销，否则压缩没意义。
  const MIN_GAIN = 256;
  const marker = `\n\n≥ 已按预算省略 ${dropped.length} 段（约 ${(saved / 1024).toFixed(1)}KB，本轮领域：${hints.length ? hints.join("/") : "未识别→只留通用规则"}）`;
  const text2 = `${keptText}${marker}`;
  const bytesAfter = Buffer.byteLength(text2);
  if (bytesAfter >= bytesBefore || bytesBefore - bytesAfter < MIN_GAIN) return result;
  return {
    text: text2,
    trimmed: true,
    bytesBefore,
    bytesAfter,
    droppedSections: dropped.length,
    droppedTitles: dropped.map((s) => s.title || "(前言)"),
    hintKeys: hints,
  };
}
