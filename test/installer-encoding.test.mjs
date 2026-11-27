// 安装脚本的编码契约：这几条一旦破了，用户双击安装就直接坏，而且在 Linux CI 上看不出来。
//
// 背景（真踩过）：
//   · install.ps1 含中文，Windows PowerShell 5.1 只有看到 **UTF-8 BOM** 才会按 UTF-8 读；
//     丢了 BOM 会按 ANSI(GBK) 读 → 中文乱码、字符串被截断、解析报错。用编辑器改过这个文件后必须补回 BOM。
//   · *.bat 必须是纯 ASCII：历史上 chcp 65001 下含中文的 echo 行会被 cmd 拆开当命令执行。
//   · bootm 脚本（.sh / .command）**不能**有 BOM：BOM 会被当成 shebang 的一部分，bash 直接不认。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const startsWithBom = (buf) => buf.length >= 3 && buf[0] === BOM[0] && buf[1] === BOM[1] && buf[2] === BOM[2];

test("安装脚本编码：install.ps1 必须带 UTF-8 BOM（PowerShell 5.1 中文依赖它）", () => {
  const buf = readFileSync(path.join(root, "install.ps1"));
  assert.ok(startsWithBom(buf), "install.ps1 丢了 BOM —— Windows PowerShell 5.1 会把中文按 ANSI 读坏");
  const text = buf.toString("utf8");
  assert.ok(text.includes("安装完成"), "BOM 之后中文应能按 UTF-8 正常读出");
});

test("安装脚本编码：*.bat 必须纯 ASCII（chcp 65001 下中文 echo 会被 cmd 拆开）", () => {
  const bats = readdirSync(root).filter((n) => n.endsWith(".bat"));
  assert.ok(bats.length >= 3, `应至少有 3 个 .bat，实际 ${bats.length}`);
  for (const name of bats) {
    const buf = readFileSync(path.join(root, name));
    const offenders = [];
    for (let i = 0; i < buf.length; i += 1) if (buf[i] > 0x7f) offenders.push(i);
    assert.equal(offenders.length, 0, `${name} 含非 ASCII 字节（首个偏移 ${offenders[0]}）`);
  }
});

test("安装脚本编码：*.sh / *.command 不能有 BOM，且首行是 shebang", () => {
  const scripts = ["install.sh", "uninstall.sh", ...readdirSync(root).filter((n) => n.endsWith(".command"))];
  assert.ok(scripts.length >= 2);
  for (const name of scripts) {
    const buf = readFileSync(path.join(root, name));
    assert.equal(startsWithBom(buf), false, `${name} 带了 BOM，bash 会把 shebang 读坏`);
    const first = buf.toString("utf8").split("\n")[0];
    assert.ok(first.startsWith("#!"), `${name} 首行应是 shebang，实际 ${JSON.stringify(first.slice(0, 40))}`);
  }
});
