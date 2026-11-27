#!/usr/bin/env node
// 跨平台跑单测：自己枚举 test/*.test.mjs 再交给 node --test。
//
// 为什么不用 `node --test test/*.test.mjs`：那个通配符要由 shell 展开。
// Windows 的 npm 走 cmd/pwsh，Node 收到的是字面量 `test/*.test.mjs`，
// 于是报 `Could not find '...\\test\\*.test.mjs'` —— 本地 Windows 与 GitHub
// windows-latest runner 都会因此假失败（真实踩过，CI 上抓到过）。
//
// 用法：node scripts/run-tests.mjs  （npm test 指向这里）
import { readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "test");

let names = [];
try {
  names = readdirSync(dir);
} catch (e) {
  console.error(`读不到测试目录 ${dir}: ${String(e?.message || e)}`);
  process.exit(1);
}

const files = names
  .filter((n) => n.endsWith(".test.mjs"))
  .sort()
  .map((n) => path.join("test", n));

if (!files.length) {
  console.error("没有找到任何 *.test.mjs，拒绝空跑通过");
  process.exit(1);
}

try {
  execFileSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
} catch (e) {
  process.exit(typeof e?.status === "number" ? e.status : 1);
}
