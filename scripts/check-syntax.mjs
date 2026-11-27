#!/usr/bin/env node
// 跨平台语法检查：不依赖 bash/glob，Windows / macOS / Linux 行为一致。
// 用法：node scripts/check-syntax.mjs  → 全部通过 exit 0，任一失败列出文件名并 exit 1。
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = ["lib", "lib/redteam", "bin", "test", "scripts"];
const files = [];

for (const rel of targets) {
  const dir = path.join(root, rel);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    continue;
  }
  for (const name of names) {
    const fp = path.join(dir, name);
    try {
      if (!statSync(fp).isFile()) continue;
    } catch {
      continue;
    }
    if (/\.(m?js)$/.test(name) && !name.startsWith(".")) files.push(fp);
  }
}
files.push(path.join(root, "client.js"));

let failed = 0;
for (const fp of files) {
  try {
    execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" });
  } catch (e) {
    failed += 1;
    console.log(`SYNTAX FAIL ${path.relative(root, fp)}`);
    const out = String(e.stderr || e.stdout || e.message || "").trim();
    if (out) console.log(out.split("\n").slice(0, 6).join("\n"));
  }
}

console.log(`语法检查：${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
