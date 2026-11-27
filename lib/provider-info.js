// 当前模型 provider / baseURL 的本地读取（v1.0.5 T5）。
// 只读本地配置文件与环境变量：不发网络请求、不引入依赖、不解析完整 YAML。
// 目的：用户反馈「有的模型提供商会过滤拦截」——要能一眼看出自己是不是走中转。
// 解析口径：只看 `agent-default-model:` 与 `llm-pi-ai: providers:` 两个块里的
// **直接子键**，flow mapping（`wx: {baseURL: ...}`）与 alias 一律视为未识别，不瞎猜。
import fs from "node:fs";
import path from "node:path";

// 官方直连域名白名单。不在这里的一律标「疑似中转，过滤行为不可控」。
const OFFICIAL_DOMAINS = Object.freeze([
  "deepseek.com",
  "openai.com",
  "anthropic.com",
  "googleapis.com",
  "azure.com",
  "azure.cn",
  "microsoft.com",
  "x.ai",
]);

const ENV_KEYS = Object.freeze([
  "DSH_BASE_URL",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_BASE_URL",
]);

// 这些键名不能当普通属性名写进对象（`__proto__` 会改成原型链赋值）。
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function readText(fp) {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}

function unquote(v) {
  const s = String(v || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).trim();
  return s;
}

/** 引号感知地剪掉行尾注释；URL 里的 `#fragment` 保留。 */
export function stripYamlComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote === '"' && c === "\\") {
      i += 1;
      continue;
    }
    if (quote === "'" && c === "'" && line[i + 1] === "'") {
      i += 1;
      continue;
    }
    if (quote && c === quote) {
      quote = "";
      continue;
    }
    if (!quote && (c === '"' || c === "'")) {
      // 只在「值的开头」认为进入引号：`key: "…"` 或 `: "…"`
      if (/(?:^|:)\s*$/.test(line.slice(0, i)) || /^\s*$/.test(line.slice(0, i))) quote = c;
      continue;
    }
    if (!quote && c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function yamlLines(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => stripYamlComment(line));
}

/**
 * 轻量 YAML 扫描（只认我们要的几个键）：
 *   agent-default-model: { provider, model }
 *   llm-pi-ai: providers: { <name>: { baseURL } }
 * 返回 { provider, model, providers }，providers 用 null 原型，避免原型污染。
 */
export function parseSettingsLite(text) {
  const lines = yamlLines(text);
  const out = { provider: "", model: "", providers: Object.create(null) };

  // ① agent-default-model 的直接子键
  let root = "";
  let rootChildIndent = -1;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const m = line.match(/^([A-Za-z0-9_.-]+):\s*$/);
      root = m ? m[1] : "";
      rootChildIndent = -1;
      continue;
    }
    if (root !== "agent-default-model") continue;
    if (rootChildIndent < 0) rootChildIndent = indent;
    if (indent !== rootChildIndent) continue;
    const p = line.match(/^\s*provider:\s*(.+?)\s*$/);
    if (p) out.provider = unquote(p[1]);
    const m = line.match(/^\s*model:\s*(.+?)\s*$/);
    if (m) out.model = unquote(m[1]);
  }

  // ② llm-pi-ai: → providers: → <name>: → baseURL（只看直接子键）
  root = "";
  rootChildIndent = -1;
  let inProviders = false;
  let providersIndent = -1;
  let nameIndent = -1;
  let fieldIndent = -1;
  let current = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const m = line.match(/^([A-Za-z0-9_.-]+):\s*$/);
      root = m ? m[1] : "";
      rootChildIndent = -1;
      inProviders = false;
      current = "";
      continue;
    }
    if (root !== "llm-pi-ai") continue;
    if (rootChildIndent < 0) rootChildIndent = indent;
    if (!inProviders) {
      if (indent === rootChildIndent && /^\s*providers:\s*$/.test(line)) {
        inProviders = true;
        providersIndent = indent;
        nameIndent = -1;
        fieldIndent = -1;
        current = "";
      }
      continue;
    }
    if (indent <= providersIndent) {
      inProviders = false;
      current = "";
      continue;
    }
    const nameHit = line.match(/^\s*([A-Za-z0-9_.-]+):\s*$/);
    if (nameHit && (nameIndent < 0 || indent <= nameIndent)) {
      nameIndent = indent;
      fieldIndent = -1;
      current = UNSAFE_KEYS.has(nameHit[1]) ? "" : nameHit[1];
      if (current && !out.providers[current]) out.providers[current] = { baseURL: "" };
      continue;
    }
    if (!current) continue;
    if (fieldIndent < 0) fieldIndent = indent;
    if (indent !== fieldIndent) continue;
    const baseHit = line.match(/^\s*baseURL:\s*(.+?)\s*$/);
    if (baseHit) out.providers[current].baseURL = unquote(baseHit[1]);
  }

  return out;
}

/** baseURL 里可能带 key/token 查询串，展示前先剪掉凭证与查询。 */
export function sanitizeBaseURL(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    const auth = u.username || u.password ? "***@" : "";
    return `${u.protocol}//${auth}${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return s.replace(/\/\/[^/@]+@/, "//***@").split("?")[0];
  }
}

export function isOfficialBaseURL(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  let host = "";
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    const m = s.match(/^[a-z]+:\/\/([^/:?#]+)/i);
    host = (m ? m[1] : s.split("/")[0]).toLowerCase().replace(/:\d+$/, "");
  }
  if (!host) return false;
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function settingsCandidates(dshHome) {
  const home = String(dshHome || "").trim();
  if (!home) return [];
  return [
    path.join(home, "settings.yaml"),
    path.join(home, "settings.yml"),
    path.join(home, "config.yaml"),
    path.join(home, "config.yml"),
    path.join(home, "settings.yaml.imported"),
    path.join(home, "settings-legacy.yaml"),
  ];
}

/**
 * 返回 { provider, model, baseURL, source, relay, note }。
 * 全部读不到时 baseURL 为空串，调用方按「未识别」展示，不做臆测。
 * 注意：默认 provider 存在但没写 baseURL 时，不回退去用「唯一那个别的 provider」
 * 的地址——那会把别人的中转域名挂到当前 provider 头上，误报链路。
 */
export function readProviderInfo(dshHome = "", env = process.env) {
  const out = { provider: "", model: "", baseURL: "", source: "", relay: false, note: "" };

  for (const fp of settingsCandidates(dshHome)) {
    const text = readText(fp);
    if (!text) continue;
    const parsed = parseSettingsLite(text);
    const named = parsed.provider && parsed.providers[parsed.provider]
      ? parsed.providers[parsed.provider].baseURL
      : "";
    const all = Object.values(parsed.providers).map((p) => p.baseURL).filter(Boolean);
    // 只在「没指定 provider」时才允许唯一 URL 兜底。
    const baseURL = named || (!parsed.provider && all.length === 1 ? all[0] : "");
    if (!baseURL && !parsed.provider) continue;
    out.provider = parsed.provider || "";
    out.model = parsed.model || "";
    out.baseURL = baseURL || "";
    out.source = fp;
    break;
  }

  if (!out.baseURL) {
    for (const key of ENV_KEYS) {
      const v = String(env?.[key] || "").trim();
      if (v) {
        out.baseURL = v;
        out.source = `env:${key}`;
        break;
      }
    }
  }

  out.relay = Boolean(out.baseURL) && !isOfficialBaseURL(out.baseURL);
  out.note = out.relay ? "（疑似中转，过滤行为不可控）" : "";
  return out;
}

/** 一行展示：`wx / Deepseek-v4-flash @ https://host （疑似中转，过滤行为不可控）` */
export function describeProvider(info = {}) {
  const baseURL = sanitizeBaseURL(info.baseURL || "");
  if (!baseURL) {
    return "未识别（读不到 settings 里的 baseURL；可用 DSH_BASE_URL 覆盖或看面板模型设置）";
  }
  const owner = [info.provider, info.model].filter(Boolean).join(" / ");
  const note = info.note ? ` ${info.note}` : "";
  return `${owner ? `${owner} @ ` : ""}${baseURL}${note}`;
}
