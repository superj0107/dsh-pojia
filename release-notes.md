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
