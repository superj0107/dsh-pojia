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
