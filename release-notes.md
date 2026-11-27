# 1.0.5

社区反馈落地：**「到底怎么算成功」**（`status` 只给明细）、**「怎么知道是被网关拦了」**（fail 分不清模型拒绝和中间层拦截）、**「探针能不能自己加」**（内置 8 条不可扩展）、**「桌面版的 missing 是报错吗」**（shim 噪音）。

### 中文

- **`status` 顶部两行就是结论**：第一行 `结论 / verdict:` 三态（`已就绪（补丁 N/N applied，注入开启）` / `待处理：N 项 pending …` / `异常：原因`），第二行 `下一步 / next:` 给一条能直接照抄的命令。下面的补丁明细一个字没改，脚本解析不受影响。
- **新增 `/pojia doctor`（含 `dsh-pojia --doctor`）**：安装 / 注入 / 有效性三段结论，最后附一段可直接贴论坛的摘要；退出码全绿 `0`、有待办 `1`、有阻断 `2`。`status` 仍是全量明细，`doctor` 只回答「好了没、差什么、下一步」。
- **shim 噪音按 surface 降噪**：桌面版输出 `shim: n/a（桌面版不需要改 shim）`，不再打印 `dsh.cmd=missing`（私信反馈里就是这个 `missing` 被当成报错）；Web/自定义 surface 输出保持原样，并注明三取值含义（missing/original/patched）。
- **探针集可自定义**：内置 8 条不动，额外读 `$DSH_HOME/pojia/probes/*.json`（`{ id, kind, prompt, expect?, expectNo? }`，单对象或数组均可），`list` 标注 `[内置]/[自定义]`；id 冲突内置优先并给警告，脏 JSON 只跳过那一条。样例：`examples/probes/example.json`。
- **fail 归因 + 疑似中转提示**：`record` 可带原因 `refusal` / `gateway` / `transport` / `other`；`report` 按原因出列，gateway 占多数时直接给「换官方 endpoint / 换 provider / 换 armor mode」的建议。`status`/`doctor` 显示当前 `provider / baseURL`，非官方域名标注「疑似中转，过滤行为不可控」。纯本地判定，不发网络请求、不引依赖。
- **文档防吞**：命令文案统一写 `record 探针id`（论坛/聊天会把 `<id>` 当 HTML 标签吃掉），README 增加 30 秒自检三行；`apply` 成功后追加「下一步：`/pojia doctor` → `/pojia validate list`」。
- 面板状态接口新增 `verdict_tier` / `verdict_text` / `verdict_next` / `provider`（`baseURL` 已剪掉查询串里的凭证），面板与脚本都不用自己拼明细。
- 新增 `test/diagnose.test.mjs`：三态判定顺序、doctor 三场景与退出码、自定义探针合并/冲突/脏 JSON、fail 归因与建议、provider 解析与凭证剪裁，以及「仓库里不许再出现会被论坛吃掉的尖括号 id」的文案回归。
- 面板「应用」成功后不再只弹「已完成」，而是直接给出下一步（`ok.next`：`/pojia doctor` → `/pojia validate list`）；README 补了最小自定义探针示例，`examples/` 已进 npm 包。
- **独立引擎只读复审后加固**：doctor 的退出码把「验证全 fail / 内核关闭 / 注入总开关关闭」都算作待办（不再假绿）；doctor 只认当前人设的验证记录（不再借用别人设的高分）；探针字段类型异常不再打断整份自定义列表，探针目录读失败会出警告；provider 解析加了行尾注释与 BOM 处理、只认 `llm-pi-ai` 命名空间、屏蔽 `__proto__` 之类的键名；`validate list` 保持 `[探针id]` 在行首（来源标注移到行尾），旧解析不受影响。
- **命令面不再静默失败**：`/pojia` 拿不到宿主的 `commands` 服务时，旧代码直接 `return`，用户侧表现就是「面板正常、命令敲了没反应」。现在先直连、再 `ctx.inject(["commands"])` 迟绑定重试，仍失败就把原因写进 `commandRegState` 与日志；`/pojia doctor` 会直接打出 `命令 /pojia 已注册 / 未注册：<原因>`（未注册计 exit 1），贴论坛摘要也带这一项。README 补了「输入 /pojia 没反应」的四步自查，以及 `/pojia` 与上游 `/fujiang` 的区分。
- **验证记录不再并发丢数据**：`validation.json` 的读—改—写改成事务（同目录 `validation.json.lock` 互斥，原子 rename 落盘）。两个宿主共用一个 `DSH_HOME` 同时 `record` 时，后写的不会再覆盖先写的；锁被进程崩溃留下超过 10 秒按过期清理，不会一次崩死就永久写不进去。冲突时命令明确回「验证记录正被另一个进程写入，请稍后重试」，不会假装成功。
- 同时包含 1.0.4 未发布的稳定性改动：单段内核注入（默认不再重复注入两份同文）、破甲评分对「折中话术」的窗口收窄与误判修正、continue-retry 的有界补跑。

### English

- `status` now opens with a verdict and a next step (`ready` / `pending` / `broken` plus one copy-pasteable command); the per-patch detail lines are byte-identical, so existing parsers keep working.
- New `/pojia doctor` (and `dsh-pojia --doctor`): install / inject / validation conclusions plus a paste-ready summary for the forum; exit code `0` all green, `1` has todos, `2` blocked.
- Shim noise is surface-aware: desktop prints `shim: n/a（桌面版不需要改 shim）` instead of `dsh.cmd=missing`; other surfaces keep the original line with the three states documented.
- Probe sets are extensible: the 8 built-ins stay, plus `$DSH_HOME/pojia/probes/*.json` (`{ id, kind, prompt, expect?, expectNo? }`, object or array); `list` tags `[内置]/[自定义]`, built-in ids win on conflict with a warning, broken JSON only skips that file.
- `record` accepts a failure reason (`refusal` / `gateway` / `transport` / `other`); `report` breaks failures down by reason and suggests switching endpoint/provider/armor mode when gateway dominates. `status`/`doctor` show the current `provider / baseURL` and flag non-official hosts as suspected relays. All local, no network calls, no new dependencies.
- Docs no longer print command examples with a raw angle-bracket id (forums eat it as an HTML tag); README gets a 30-second self-check; a successful `apply` ends with the next step.
- New `test/diagnose.test.mjs` covers verdict ordering, doctor exit codes, custom probe merging/conflicts/dirty JSON, failure attribution and provider parsing.
- A successful panel Apply now shows the next step (`ok.next`: `/pojia doctor` → `/pojia validate list`); README gained a minimal custom-probe example and `examples/` ships in the npm package.
- Hardened after an independent read-only review: doctor treats all-fail validation, disabled armor and disabled injection as todos (no more false green), only counts the current persona's validation records, tolerates malformed probe fields and unreadable probe dirs, parses provider settings with comment/BOM handling inside the `llm-pi-ai` namespace only (and rejects `__proto__`-style keys), and keeps `[probe-id]` at the start of `validate list` lines for backward-compatible parsing.
- Also includes the unreleased 1.0.4 stability work: single-segment armor injection, tighter fallback-wording gating, bounded continue-retry.
- Validation records can no longer be lost to concurrency: the read-modify-write of `validation.json` is now a transaction (`validation.json.lock` next to it, atomic rename on write). Two hosts sharing one `DSH_HOME` no longer overwrite each other's `record`; a lock left behind by a crashed process is treated as stale after 10s, and a real conflict answers "another process is writing, retry" instead of pretending success.
- The command surface no longer fails silently: when the host's `commands` service is unavailable, `/pojia` is retried through `ctx.inject(["commands"])` and the failure is recorded; `/pojia doctor` now prints `command /pojia registered / not registered: <reason>` (a miss counts as exit 1), and README gained a four-step "typing /pojia does nothing" checklist plus how to tell `/pojia` apart from the upstream `/fujiang`.

---

# 1.0.3

`pnpm install` 失败不再假装成功：如实报错、能自动修的替你修、修不了也保证插件能加载。

### 中文

- 修 BUG：`pnpm install` 明明报 `ERR_PNPM_*` 失败，脚本却打印「pnpm install 完成」。现在同时看退出码和输出里的错误标记，失败就是失败，退出码 `2` 表示「插件已装好，但 profile 依赖有问题」。
- 失败时会识别两类 profile 依赖问题并给出具体修法：`ERR_PNPM_INVALID_VERSION_UNION`（profile 里 URL/tarball 形式的依赖不被当前 pnpm 接受，建议改成 `github:owner/repo#<sha>` 或用 pnpm 9）与 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`（GitHub 包要跑构建脚本）。
- 能自动修的直接问一句就修：后一种错误会问「要不要把 `<包名>` 加进 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 再重试一次」，同意就写配置并自动重试，成功则正常收尾；重复运行不会重复写。
- 收尾兜底：实在装不上时把插件手动链接进 `node_modules`（Windows 用 junction，macOS/Linux 用软链，不可用时退回复制），DSH 照样能加载；`uninstall` 会顺手删掉这个链接，不碰其它依赖。
- 修 BUG：Windows 双击 `.bat` 在 `chcp 65001` 下会把含中文的 `echo` 行拆开当命令执行，报 `'…' is not recognized as an internal or external command`。三个 `.bat` 现在全部纯 ASCII（中文提示统一由带 BOM 的 PowerShell 脚本输出），并区分成功/有问题两种收尾文案。
- 新增 `test/install-fail-smoke.sh` 并接入 CI/Release：假 pnpm 模拟失败，断言「不许报 OK」「给对建议」「自动修 onlyBuiltDependencies 后重试成功」「兜底链接」「卸载清链接且不动其它依赖」。

### English

- Fixed: a failing `pnpm install` (e.g. `ERR_PNPM_*`) used to be reported as "pnpm install 完成". Exit code and output markers are now both checked; failures stay failures, and exit code `2` means "plugin installed but profile dependencies are broken".
- Two profile-dependency errors are recognised with concrete fixes: `ERR_PNPM_INVALID_VERSION_UNION` (URL/tarball specs rejected by the current pnpm — switch to `github:owner/repo#<sha>` or use pnpm 9) and `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` (a GitHub package wants to run build scripts).
- The fixable one is offered interactively: the script asks whether to add `<pkg>` to `onlyBuiltDependencies` in `pnpm-workspace.yaml` and retry once; it writes the config and re-runs on consent, and repeated runs never duplicate the entry.
- Last-resort fallback: when install still fails the plugin is linked into `node_modules` manually (junction on Windows, symlink elsewhere, copy if neither works) so DSH can load it; `uninstall` removes that link again and leaves other dependencies alone.
- Fixed: the Windows `.bat` files broke under `chcp 65001` when an `echo` line contained Chinese — cmd split it and printed `'…' is not recognized as an internal or external command`. All three `.bat` files are pure ASCII now (Chinese output comes from the BOM-encoded PowerShell scripts), with distinct success/problem endings.
- Added `test/install-fail-smoke.sh` (wired into CI and Release): a stub pnpm forces failures and asserts "never report OK", correct hints, automatic `onlyBuiltDependencies` fix + retry, the fallback link, and uninstall cleanup.

---

# 1.0.2

缺依赖不再只是报错：脚本会先问你一句，同意了就自己装好。

### 中文

- 安装脚本（`install.sh` / `install.ps1`）新增依赖体检：Node.js 缺失或版本 < 18、pnpm 缺失时，打印 `[Y/n]` 询问「要我帮你装吗」；回车或 `y` 直接装，`n` 只警告，非交互终端不擅自安装。
- Node.js 自动安装：macOS 优先 `brew install node`；没有 Homebrew 就用官方二进制包（先按 `SHASUMS256.txt` 校验 sha256，再解压到 `<DSH home>/toolchain`），全程不需要 sudo。
- Windows 侧：优先 `winget install OpenJS.NodeJS.LTS`，没有 winget 就走官方 zip，解压到 `<DSH home>/toolchain` 并写进用户 PATH（会明确提示）。
- pnpm 自动安装：依次尝试 `npm i -g pnpm` → `corepack enable pnpm` → pnpm 官方独立安装脚本，成功后就地继续跑 `pnpm install`，失败才回落到「手动装」提示。
- 免交互开关：`--yes` / `-Yes`（缺了直接装）、`--no-deps` / `-NoDeps`（只警告、不提问）；双击脚本（`.command` / `.bat`）本来就是交互终端，直接按提示回一句就行。
- 交互读取加了 120 秒超时与 `/dev/tty` 兜底（`POJIA_ASK_TIMEOUT` 可调），保证无 tty 的 CI/管道场景不会卡死、也不会把「读不到输入」误判成同意。
- 新增 `test/install-deps-smoke.sh`：`--no-deps` 不装、缺 Node 时答 n 明确退出且不改 profile、非交互不擅自装；加 `POJIA_TEST_NETWORK=1` 还会真下载官方 Node 二进制与 pnpm 跑一遍完整链路。CI 默认跑无网络子集。
- 本地实测：WSL 下真实下载 Node 22 官方二进制（sha256 通过）+ 自动装 pnpm + `pnpm install` 全链路通过；Windows 下 `-Yes` 走 npm 桩验证 pnpm 自动安装、完全无 Node 时走官方 zip 自动安装并回滚用户 PATH。

### English

- Both installers now check dependencies: when Node.js is missing/older than 18 or pnpm is absent, they print a `[Y/n]` prompt — Enter or `y` installs it, `n` only warns, and non-interactive runs never install silently.
- Node.js auto-install: Homebrew first on macOS; otherwise the official binary tarball, sha256-verified against `SHASUMS256.txt`, unpacked into `<DSH home>/toolchain`. No sudo anywhere.
- Windows: `winget install OpenJS.NodeJS.LTS` first, else the official zip, unpacked into `<DSH home>/toolchain` and appended to the user PATH (announced explicitly).
- pnpm auto-install: `npm i -g pnpm` → `corepack enable pnpm` → the official standalone installer; on success the run continues straight into `pnpm install`, otherwise it falls back to the manual hint.
- Non-interactive switches: `--yes` / `-Yes` (install) and `--no-deps` / `-NoDeps` (warn only). The double-click scripts already run in a terminal, so the prompt just works.
- Prompt reads are bounded (120 s, `POJIA_ASK_TIMEOUT`) with a `/dev/tty` fallback, so pipes and CI never hang and an empty read is never mistaken for consent.
- Added `test/install-deps-smoke.sh`: verifies `--no-deps`, the decline path (no profile edits) and the non-interactive path; `POJIA_TEST_NETWORK=1` additionally downloads the real Node tarball and installs pnpm end to end. CI runs the offline subset.
- Verified locally: real WSL download of the Node 22 tarball (sha256 checked) + automatic pnpm install + `pnpm install`; on Windows, `-Yes` exercised pnpm auto-install through an npm stub, and the no-Node case installed from the official zip with the user PATH restored afterwards.

---

# 1.0.1

一键安装补齐 macOS / Linux / WSL，并加上「双击就好」的图形化入口。

### 中文

- 新增 `install.sh` / `uninstall.sh`（bash 3.2+，macOS 自带 bash 即可跑），与 `install.ps1` 功能等价：复制插件到 `$DSH_HOME/plugins/dsh-pojia`、写 profile 依赖与 bundle、跑 `pnpm install`；无 rsync 时自动走 tar 回退。
- home 探测顺序：`--dsh-home` → `$DSH_HOME` → `~/Library/Application Support/DeepSeek Harness/dsh-home`（macOS 桌面版）→ `~/.dsh`；profile 由 `--profile` 指定，写错名字会列出可选 profile 后退出。
- 新增 macOS 双击脚本：`点我一键安装-macOS.command`、`点我检查是否生效-macOS.command`、`点我一键卸载-macOS.command`。双击即用，不用开终端；跑完窗口停住显示结果。
- 新增 Windows 双击脚本：`点我一键安装-Windows.bat`、`点我检查是否生效-Windows.bat`、`点我一键卸载-Windows.bat`（`chcp 65001`，中文不乱码；参数原样透传给 `install.ps1`）。
- `install.ps1`：`cordis.patch.yml` 托管块标记改为跨平台共用，旧 `(install.ps1)` 标记自动迁移，两个平台的脚本可互相幂等卸载；复制插件时同时排除 `install.sh`、`*.tgz` 与 installer 目录。
- 不装终端也能验活：两个「点我检查是否生效」脚本直接调用插件 CLI 打印补丁清洗进度，并提示进会话发 `/pojia status` 看真实效果。
- CI / Release：新增 `bash -n` 语法检查与 `test/install-sh-smoke.sh` 冒烟测试（全新安装 → 幂等重装 → 旧标记迁移 → 卸载还原 → 双击脚本齐备，共 33 项断言）；Release 的 installer 包同时附带 8 个安装/卸载脚本，macOS 侧保留可执行位。
- 文档：README（中 / 英 / 日 / 简中）安装章节改为「双击优先」，补 Gatekeeper 解锁方式与终端等价命令；`.gitattributes` 固定 `*.bat` 为 CRLF。

### English

- Added `install.sh` / `uninstall.sh` (bash 3.2+, works with the bash macOS ships) as feature-equivalents of `install.ps1`: copies the plugin to `$DSH_HOME/plugins/dsh-pojia`, registers the profile dependency and bundle, runs `pnpm install`; falls back to `tar` when `rsync` is missing.
- Home resolution: `--dsh-home` → `$DSH_HOME` → `~/Library/Application Support/DeepSeek Harness/dsh-home` (macOS desktop) → `~/.dsh`; an unknown `--profile` exits with the list of available profiles.
- New macOS double-click scripts: `点我一键安装-macOS.command`, `点我检查是否生效-macOS.command`, `点我一键卸载-macOS.command` — no terminal needed, the window stays open with the result.
- New Windows double-click scripts: `点我一键安装-Windows.bat`, `点我检查是否生效-Windows.bat`, `点我一键卸载-Windows.bat` (`chcp 65001`, no mojibake; arguments pass through to `install.ps1`).
- `install.ps1`: the `cordis.patch.yml` managed-block markers are now shared across platforms with automatic migration of the old `(install.ps1)` marker, so either platform can idempotently uninstall the other's block; copying now also skips `install.sh`, `*.tgz` and installer directories.
- Verify without a terminal: both "check" scripts call the plugin CLI directly to print patch progress and point at `/pojia status` for the real effect.
- CI / Release: `bash -n` checks plus `test/install-sh-smoke.sh` (fresh install → idempotent re-install → legacy marker migration → uninstall restore → double-click scripts present, 33 assertions); the Release installer zip ships all eight scripts with the exec bit kept on macOS.
- Docs: install sections in README (zh / en / ja / zh-CN) now lead with the double-click path, plus the Gatekeeper workaround and terminal equivalents; `.gitattributes` pins `*.bat` to CRLF.

---

# 1.0.0

首个融合版本。把 dsh-purge-safe 与富江破甲合成一个插件，功能统一收进 `/pojia`。

### 中文

- 宿主清洗层沿用 dsh-purge-safe 的补丁引擎（面向 DSH 0.2.2-rc.5，补丁命中 60/60），保留清洗面板与演练台。
- 破甲内核层把富江的提示词注入、user/legacy/both 三通道、运行时开关与会话投影评分器整合为 `lib/armor.js`。
- 统一命令 `/pojia`：status/apply/revert/uninstall/edit、rules、skills、rewind、armor 全部作为子命令；旧 `/purge` `/rules` `/skills` `/rewind` `/fujiang` 不再单独注册。
- 统一工具：`pojia_status`、`pojia_apply`、`pojia_revert`、`pojia_armor`、`pojia_profile`。
- 破甲内核状态文件独立为 `$DSH_HOME/dsh-pojia-armor.state.json`，与旧富江隔离。
- 品牌统一：面板标题、状态输出、CLI、帮助文案、多语言 README 均改为 dsh-pojia；内部 HTTP 路由 `/dsh-purge-safe/*` 保持兼容不变。
- 许可证：整体 CC BY-NC-SA 4.0；保留 Apache-2.0 与富江 CC BY-NC-SA 4.0 原协议及三方署名。

上游 dsh-purge-safe 的详细补丁变更历史见 [README-upstream-purge-safe.md](./README-upstream-purge-safe.md) 与其原 release-notes（本融合包不逐条继承其历史条目）。

### English

- First merged release: dsh-purge-safe host cleaning + Fujiang armor kernel under one plugin, all commands unified into `/pojia`.
- Host patches target DSH 0.2.2-rc.5 (60/60 applied); clean panel and drill console retained.
- Armor kernel integrated as `lib/armor.js`: prompt injection, user/legacy/both channels, runtime switch, session projection scoring.
- Old `/purge` `/rules` `/skills` `/rewind` `/fujiang` commands folded into `/pojia`; five `pojia_*` tools replace the old ones.
- Armor state isolated to `$DSH_HOME/dsh-pojia-armor.state.json`.
- Branding unified; internal HTTP routes `/dsh-purge-safe/*` kept for compatibility.
- Licensed CC BY-NC-SA 4.0 overall, with Apache-2.0 and Fujiang CC BY-NC-SA 4.0 texts and three-way attribution retained.
