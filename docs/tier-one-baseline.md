# dsh-pojia 第一梯队基线（Tier-1 Baseline）

这份文档是「世界第一梯队水准」的可验收标尺：先定义什么叫第一梯队，再逐项给 dsh-pojia 的现状（✔ 达标 / △ 部分 / ✗ 缺）与下一步。
评分只看**证据**：能跑的命令、能贴的输出、能复现的测试；不看宣传语。

最后更新：2026-11-27（v1.1.0）

## 一、判定标准（12 项）

| # | 标准 | 为什么是第一梯队 |
|---|---|---|
| 1 | **与宿主模型层对齐**：拿宿主权威的 `provider/model`，不靠猜配置 | 注入形态选错，后面全白做 |
| 2 | **与 agent loop 对齐**：注入走宿主原生通道（pre-step / system section），不改写用户原文 | 改写用户消息会污染会话与审计 |
| 3 | **自适应且有边界**：能按模型族调整，但用户显式设置永远优先 | 「智能」不能变成「抢方向盘」 |
| 4 | **可观测**：注入次数/字节/模型/通道/失败归因都能看到 | 没有数字就没有优化 |
| 5 | **可验证**：固定探针 + 命中率 + 失败归因，而不是只看「注入成功」 | 注入 ≠ 生效 |
| 6 | **可诊断**：一条命令给出「好了没 / 差什么 / 下一步」，带退出码 | 用户不该读日志才能判断 |
| 7 | **可回滚**：revert / uninstall 干净，保留用户文件 | 上船容易下船难的工具没人敢用 |
| 8 | **失败不静默**：命令没注册、锁冲突、注入缺失都要明确报 | 静默失败是第一梯队与玩具的分水岭 |
| 9 | **并发安全**：多宿主共用 `DSH_HOME` 不丢数据 | 真实用户会同时开桌面 + web |
| 10 | **跨平台**：Windows / macOS / Linux，Node ≥18，零运行时依赖 | 分发面决定口碑 |
| 11 | **文档即产品**：30 秒自检、故障排查、概念边界（与 skill / 网关的分工） | 少一次提问 = 多一个留存 |
| 12 | **基线可回归**：单测 + 冒烟 + 真机实测脚本，改动不靠手感 | 迭代速度的上限由回归速度决定 |

## 二、现状自评

| # | 标准 | 现状 | 证据 |
|---|---|---|---|
| 1 | 与模型层对齐 | ✔ | `agent/pre-step` 的 `modelSelection` → `lib/model-profile.js` 分类 → 通道决策（v1.1.0） |
| 2 | 与 agent loop 对齐 | ✔ | user 通道走 `agent/pre-step` 追加带 `source` 的注入消息；system 通道走 `systemPrompt.section`；从不改用户原文 |
| 3 | 自适应有边界 | ✔ | `decideInjection()` 优先级 pinned > profile > default；`/pojia armor mode` 置 `pinnedMode` |
| 4 | 可观测 | ✔ | `lib/metrics.js` → `$DSH_HOME/pojia/metrics.jsonl`（注入/决策/校准/压缩/子代理/**每轮拒答判定**）；doctor「协同」行 + gateway fail 建议 |
| 5 | 可验证 | ✔ | 内置 8 条探针 + 自定义 + 命中率 + refusal/gateway/transport 归因 |
| 6 | 可诊断 | ✔ | `/pojia doctor` 四段结论 + 摘要 + 退出码 0/1/2 |
| 7 | 可回滚 | ✔ | `revert` / `uninstall` 保留 `prompt-inject.md`；`--revert` 有冒烟 |
| 8 | 失败不静默 | ✔ | 命令面注册失败会进 `commandRegState` 并在 doctor 打印；锁冲突/注入缺失都报错 |
| 9 | 并发安全 | ✔ | `validation.json` 事务（owner 校验 + 原子 rename + 严格读） |
| 10 | 跨平台 | △ | 代码路径覆盖 Windows/macOS/Linux；CI 已加 `os × node(18/20)` matrix（首次运行需 push 验证，未跑过不算 ✔） |
| 11 | 文档即产品 | ✔ | README 30 秒自检 + 故障排查（`/pojia` 无反应四步、与 REA/CFW 的边界） |
| 12 | 基线可回归 | ✔ | `npm test` 27 项 + `scripts/check-syntax.mjs`（跨平台语法检查）+ `scripts/e2e-coop.mjs`（协同链路 14 项断言）+ CI 三个 bash 冒烟 |

综合：11 ✔ / 1 △ / 0 ✗（△ 项是「CI matrix 已配好但还没在真机跑过一次」）。

## 三、差距与里程碑

### M3（已落地，等一次 CI 验证）
1. **跨平台基线**：CI 加 `os × node` matrix（ubuntu / windows / macos × node 18 / 20），跑语法检查、`npm test` 与两个自检脚本。
2. **协同端到端脚本** `scripts/e2e-coop.mjs`：最小 Cordis ctx 拉起插件 → 断言命令/工具注册、pre-step 注入、画像决策、会话级 system 段、校准闭环、预算压缩、钉住让位（30 项断言，已进 CI）。
3. **跨平台语法检查** `scripts/check-syntax.mjs`：不依赖 bash/glob，三平台行为一致（94 个文件）。

### M4（已落地）
4. **指标回流决策**：✅ doctor 把「gateway fail 多 + 中转」「注入均值偏大」变成具体建议；`fit`/`calibrated`/`trim` 事件记录决策与裁剪。
5. **注入预算控制**：✅ `lib/budget.js` + 配置 `injectBudgetKB`（**默认关**）。按本轮领域挑段，头段（覆盖声明）与尾两段（风格/锚点）永远保留；真实内核 17.2KB → 9.6KB；无领域信号不裁；收益 <256 字节不裁。
6. **模型画像在线校准**：✅ `lib/calibration.js` —— validate 记录带「族 × 通道」，≥6 条样本后实测最优通道覆盖规则；gateway 按净失败口径剔除；防抖动：赢家领先 ≥15pp 才换；`validate clear` 连校准表一起清。
7. **四入口口径统一**：✅ verdict / profile / 校准 / metrics 同时出现在 `status` 文本、`/pojia doctor`、`pojia_status`/`pojia_doctor` 工具与 `/dsh-purge-safe/status` 载荷。

### M5（已落地）
8. **多会话隔离**：✅ 自适应路径的 system 段按 `agent.ctx.systemPrompt` 挂载（会话级），全局挂载只用于用户钉住通道；e2e 用两个不同模型的会话验证互不串味（Claude 挂 1 段、DeepSeek 挂 0 段、全局计数 0）。
9. **子代理语义**：✅ `subagentInject` 开关（默认注入）+ 指标 `sub:true` 单独统计子代理轮次；关掉时子代理不挂段不追消息且只记一条 skipped 指标；`scripts/e2e-subagent.mjs` 9 项断言进 CI。

### M6（本轮全部落地）
10. **预算 A/B 基线**（下一轮）：用 `trim` 事件 + validate 记录做「压缩 vs 全文」对照，够样本再考虑把 `injectBudgetKB` 变成推荐默认。
11. **面板呈现协同层**：✅ 设置页「清洗」章新增只读协同卡片（画像 / 生效通道 / 校准 / 指标），CSS 走 `lib/glass-skin.css` 源文件 + `build:client` 进包，`test/client-contract.test.mjs` 4 项守住四类信息、中英文案、CSS 进包与「只读无按钮」。
12. **子代理精简档位**：✅ 配置 `subagentBudgetKB`（KB）。>0 时子代理只拿「通用规则 + 头尾」的精简内核（无领域信号也精简），主代理保持全文；实测 17.2KB → 2.1KB，`e2e-subagent.mjs` 14 项断言覆盖（含 `trim` 事件 `sub:true`、省下字节数）。

## 四、怎么验（给下一位维护者）

```bash
cd dsh-pojia
npm test                        # 41 项单测：判定 / 诊断 / 探针 / 锁 / 画像 / 指标 / 校准 / 预算
node scripts/e2e-coop.mjs       # 30 项：画像 → 注入 → 会话级 system 段 → 校准 → 预算 → 钉住
node scripts/e2e-subagent.mjs   # 9 项：子代理注入开关
node scripts/check-syntax.mjs   # 跨平台语法检查
node bin/dsh-pojia.js --doctor; echo $?    # 退出码 0 全绿 / 1 有待办 / 2 有阻断
node scripts/build-client.mjs && git diff --stat client.js   # 面板构建幂等
```

真机验证：装好后在会话里跑 `/pojia status`，第一屏应出现 `结论 / verdict`、`模型 / provider`、`模型画像 / profile`、`注入通道 / channel`、`校准 / calibration` 五类信息；跑一轮对话后 `/pojia doctor` 的「协同」行应出现注入次数、均值字节、子代理轮次与预算压缩统计。
