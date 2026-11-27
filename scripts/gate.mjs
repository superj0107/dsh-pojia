#!/usr/bin/env node
// 一条命令跑完整个门禁：语法检查 → 单测 → 协同自检 → 子代理自检。
//
// 为什么不用 `node --test test/*.test.mjs`：那个通配符由 shell 展开，
// Windows 的 cmd.exe 不展开，会变成「找不到文件」的假失败。
// 这里自己枚举文件，三个平台行为一致（Node 18 / 20 都行）。
//
// 用法：node scripts/gate.mjs  （或 npm run gate）
// 退出码：全绿 0；任一步失败 1（每一步都会跑完，不会半途而废）。
import { readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

function run(label, args) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    execFileSync(node, args, { cwd: root, stdio: "inherit" });
    return { label, ok: true };
  } catch {
    return { label, ok: false };
  }
}

const testFiles = readdirSync(path.join(root, "test"))
  .filter((n) => n.endsWith(".test.mjs"))
  .sort()
  .map((n) => path.join("test", n));

const steps = [];
steps.push(run("语法检查 / syntax", [path.join("scripts", "check-syntax.mjs")]));
steps.push(run(`单测 / unit (${testFiles.length} 个文件)`, [path.join("scripts", "run-tests.mjs")]));
steps.push(run("协同自检 / co-op", [path.join("scripts", "e2e-coop.mjs")]));
steps.push(run("子代理自检 / subagent", [path.join("scripts", "e2e-subagent.mjs")]));

process.stdout.write("\n=== 门禁汇总 / gate summary ===\n");
for (const s of steps) process.stdout.write(`${s.ok ? "ok  " : "FAIL"} ${s.label}\n`);
const failed = steps.filter((s) => !s.ok);
process.stdout.write(`\n${steps.length - failed.length}/${steps.length} 步通过\n`);
process.exit(failed.length ? 1 : 0);
