// dsh-pojia 可切换人设库。
// 人设文件是一个 markdown：YAML frontmatter（元数据）+ 正文（真正注入的提示词）。
// 默认内置破甲内核人设；当前选择在 $DSH_HOME/pojia/persona-state.json。
// 设计参考 agent-purge 的人设文件格式与 some-magic 的分类思路，但不依赖其代码。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync as fsUnlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BUILTIN_PERSONA = { id: "pojia-armor", name: "破甲内核", description: "内置破甲内核（源自富江破甲）", order: 0 };

function dshHome() {
  return (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
}
export function personaDir() {
  return path.join(dshHome(), "pojia", "personas");
}
function statePath() {
  return path.join(dshHome(), "pojia", "persona-state.json");
}
function builtinPrompt() {
  return readFileSync(new URL("../armor/fujiang.md", import.meta.url), "utf8");
}

// 只解析我们用到的简单 frontmatter：key: value 或 key: ["a", "b"]。
// 不引第三方 yaml 依赖，容错：解析失败当无元数据，正文仍能注入。
function parseFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    meta[m[1]] = value;
  }
  return { meta, body: match[2] };
}

export function validId(id) {
  return typeof id === "string" && /^[a-z0-9_-]{1,64}$/.test(id);
}

export function listPersonas() {
  const out = [{ ...BUILTIN_PERSONA, source: "builtin", size: Buffer.byteLength(builtinPrompt()) }];
  const dir = personaDir();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      const text = readFileSync(path.join(dir, name), "utf8");
      const { meta, body } = parseFrontmatter(text);
      out.push({
        id: validId(meta.id) ? meta.id : name.replace(/\.md$/, ""),
        name: meta.name || name.replace(/\.md$/, ""),
        description: meta.description || "",
        harness: Array.isArray(meta.harness) ? meta.harness : ["*"],
        model: Array.isArray(meta.model) ? meta.model : ["*"],
        order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 50,
        source: "user",
        size: Buffer.byteLength(body),
      });
    } catch { /* 坏文件跳过，不影响列表 */ }
  }
  return out.sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function readState() {
  try {
    const j = JSON.parse(readFileSync(statePath(), "utf8"));
    return { current: validId(j.current) ? j.current : BUILTIN_PERSONA.id };
  } catch {
    return { current: BUILTIN_PERSONA.id };
  }
}

function writeState(current) {
  const file = statePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ current }, null, 2), "utf8");
  renameSync(tmp, file);
}

function personaFilePath(id) {
  return path.join(personaDir(), `${id}.md`);
}

// 返回当前人设的正文（注入用）。找不到所选人设时回退内置，不抛错。
export function currentPrompt() {
  const state = readState();
  if (state.current === BUILTIN_PERSONA.id) return builtinPrompt();
  try {
    const text = readFileSync(personaFilePath(state.current), "utf8");
    return parseFrontmatter(text).body || builtinPrompt();
  } catch {
    return builtinPrompt();
  }
}

export function usePersona(id) {
  if (!validId(id)) return { ok: false, error: "人设 id 只能含小写字母/数字/下划线/连字符" };
  const list = listPersonas();
  if (id !== BUILTIN_PERSONA.id && !list.some((p) => p.id === id && p.source === "user")) {
    return { ok: false, error: `未找到人设 ${id}` };
  }
  writeState(id);
  return { ok: true, current: id };
}

export function importPersona(id, content, meta = {}) {
  if (!validId(id)) return { ok: false, error: "人设 id 只能含小写字母/数字/下划线/连字符" };
  const body = String(content || "").trim();
  if (!body) return { ok: false, error: "人设正文不能为空" };
  const dir = personaDir();
  mkdirSync(dir, { recursive: true });
  const front = [
    "---",
    `id: ${id}`,
    `name: ${String(meta.name || id).replace(/[:\[\]]/g, " ")}`,
    `description: ${String(meta.description || "").replace(/[:\[\]]/g, " ")}`,
    "harness: [\"*\"]",
    "model: [\"*\"]",
    `order: ${Number.isFinite(Number(meta.order)) ? Number(meta.order) : 50}`,
    "---",
    "",
  ].join("\n");
  const file = personaFilePath(id);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, front + body + "\n", "utf8");
  renameSync(tmp, file);
  return { ok: true, id, size: Buffer.byteLength(body) };
}

export function deletePersona(id) {
  if (!validId(id) || id === BUILTIN_PERSONA.id) return { ok: false, error: "内置人设不可删除" };
  const file = personaFilePath(id);
  if (!existsSync(file)) return { ok: false, error: `未找到人设 ${id}` };
  fsUnlinkSync(file);
  if (readState().current === id) writeState(BUILTIN_PERSONA.id);
  return { ok: true, id };
}

export function personaHelp() {
  return [
    "/pojia persona list          列出人设",
    "/pojia persona use <id>      切换人设",
    "/pojia persona show          查看当前人设",
    "/pojia persona import <id> [正文]  导入/新建人设（正文也可由工具传入）",
    "/pojia persona delete <id>   删除用户人设",
  ].join("\n");
}
