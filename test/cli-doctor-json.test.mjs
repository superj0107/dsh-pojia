// CLI 契约测试：`dsh-pojia --doctor --json` 必须给脚本一个稳定结构，且退出码与 JSON 里的 exit_code 一致。
// 只读：不装插件、不改任何文件（DSH_HOME 指到临时目录）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("cli: --doctor --json 结构与退出码契约", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "pojia-cli-"));
  try {
    const run = spawnSync(process.execPath, [path.join(root, "bin", "dsh-pojia.js"), "--doctor", "--json"], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home, DSH_SURFACE: "web" },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(run.error, undefined, String(run.error || ""));
    let payload;
    try {
      payload = JSON.parse(String(run.stdout || "").replace(/^\uFEFF/, ""));
    } catch (e) {
      assert.fail(`stdout 不是合法 JSON：${String(e?.message || e)}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`);
    }
    for (const key of ["ok", "exit_code", "verdict", "surface", "plugin_version", "patches", "provider", "summary", "text"]) {
      assert.ok(key in payload, `缺字段 ${key}`);
    }
    assert.equal(typeof payload.exit_code, "number");
    assert.equal(payload.exit_code, run.status, "退出码必须与 JSON 里的 exit_code 一致");
    assert.equal(payload.ok, payload.exit_code === 0);
    assert.ok(["ready", "pending", "broken"].includes(payload.verdict.tier), String(payload.verdict.tier));
    for (const key of ["applied", "total", "pending", "skipped", "gap"]) {
      assert.equal(typeof payload.patches[key], "number", `patches.${key} 应为数字`);
    }
    assert.equal(typeof payload.provider.relay, "boolean");
    // 无宿主的空 home → 应当是「插件根缺失」的阻断态，而不是假绿
    assert.equal(payload.exit_code, 2, payload.text);
    assert.ok(String(payload.verdict.text).includes("插件根缺失"), payload.verdict.text);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
