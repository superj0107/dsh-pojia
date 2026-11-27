# 1.1.0

协同层：插件不再「一套固定注入形态打天下」，而是跟着**宿主给的模型**走，并把「它到底干了什么」变成可看的数字。

### 中文

- **模型自适应注入（新增 `lib/model-profile.js`）**：读宿主 `agent/pre-step` 里的 `modelSelection`（权威的 provider/model，不是猜配置）→ 识别模型族（DeepSeek / Claude / GPT / Gemini / GLM / Kimi / Qwen / Llama / 未知）→ 决定注入通道（`user` / `legacy` / `both`）。每个族都写了理由，不靠手感。
- **边界很清楚**：用户显式设过通道（`/pojia armor mode …` 或配置里写了 `injectionMode`/`injectionChannel`）就「钉住」，自适应不再覆盖；关掉自适应用配置 `autoProfile: false`。
- **人设也跟着模型走**：人设文件里原本闲置的 `model: ["claude"]` 元数据现在真的生效，`personaForModel()` 按模型族挑人设，点名该族的优先于通配 `*`，当前人设仍在该层就不来回换。
- **运行时协同指标（新增 `lib/metrics.js`）**：每轮注入记一条 `inject`（模型族 / 通道 / 字节 / 是否中转 / 决策来源），另有 `fit` / `validate` / `refusal` 事件，落 `$DSH_HOME/pojia/metrics.jsonl`；512KB 自动翻滚，脏行容忍，写失败绝不影响注入。
- **doctor 新增「协同」行**：`画像 wx / GLM-5.2 → user（GLM） · 人设 pojia-armor · 疑似中转 | 7 天共 N 条：注入 X 次（均值 Y KB）· 拒答信号 A · gateway fail B`；中转域名上出现 gateway fail 时直接给换 endpoint / 换 provider 的建议。
- **status 摊开决策**：新增 `模型画像 / profile` 与 `注入通道 / channel` 两行，能同时看到「用户选择」与「实际生效」，钉住状态也标出来；`pojia_status` 工具与 `/pojia armor status` 返回同样的字段（`profile` / `decision` / `effectiveMode` / `pinnedMode`）。
- **第一梯队基线（新增 `docs/tier-one-baseline.md`）**：12 项判定标准 + 当前自评（11 ✔ / 1 △）+ 差距清单与里程碑，免得「世界第一梯队」只停留在口号。
- **在线校准闭环（新增 `lib/calibration.js`）**：规则负责冷启动，实测负责收敛。armor 每轮写一份画像快照（`armor-last.json`），`validate record` 会把「这条结果跑在哪个模型族 / 哪个通道」一起存下来；每次记录后自动重算 `calibration.json`（同一族 × 同一通道 ≥6 条样本才算数），下一次注入就用实测最优通道覆盖规则推荐（决策来源标 `calibrated`，并在 reason 里写清「本机实测 user 更优（100%，12 条）→ 覆盖规则推荐 both」）。gateway 类失败按「净失败」口径剔除，不会因为中转把某个通道冤枉死；`validate clear` 会连校准表一起清，避免用没数据支撑的「最优通道」。
- **注入预算（`lib/budget.js`，默认关）**：配置 `injectBudgetKB` 才启用。超预算时按「本轮领域」（最后一条用户消息里的关键词）挑段落，开头覆盖声明与结尾风格/锚点永远保留，只砍无关的领域细则，并在末尾留「已按预算省略 N 段」；真实内核 17.2KB → 9.6KB（省 44%）。没有领域信号不裁、收益小于 256 字节不裁（标记开销吃掉就没意义）；裁剪会改变效果，README 与 doctor 都明确要求先用 validate 做 A/B。
- **修掉一个只在 Windows CI 上暴露的假失败**：`npm test` 原来写的是 `node --test test/*.test.mjs`，通配符由 shell 展开——Windows runner 上 Node 收到字面量，报 `Could not find '...\test\*.test.mjs'`，两档 Node 全红。现在 `npm test` 指向 `scripts/run-tests.mjs`，自己枚举测试文件，三平台一致；首次 CI matrix 跑完 7 个 job 全绿（ubuntu / windows / macos × node 18/20 + 主测试 job）。
- **第四轮只读复审（只审上一轮的修复）：4 项全部修掉**
  1. 压缩标签被下一步覆盖：第二轮因为幂等不追加正文，却仍刷新快照，把 `trimmed` 改回 false → 预算 A/B 分桶失真。现在纯画像刷新会沿用同会话同模型的既有 `trimmed`，只有真发正文才更新。
  2. 会话快照并发丢更新：读-合并-写在两个宿主之间会互相覆盖，被覆盖的那一方后续记录退化成 `fallback`、被迫退出校准。现在快照写走自己的锁（10s 过期），争用就放弃本次写、下一轮再写。
  3. 配置被磁盘旧值钉死：磁盘写着 `pinnedMode:false`（只是记录当时生效值）+ 配置显式 `armorMode` 时，旧实现保留磁盘模式 → 配置不生效。现在「配置显式设置 + 磁盘明确未钉住」以配置为准。
  4. `tie` 判定还要求样本数相等：6/6 与 7/7 全通过时只认等样本数才算并列，导致等样本时判 tie、不等样本时反而判 measured。现在只要求命中率相等且都过门槛。
  另有条件性回归一并修掉：pinned + `subagentInject:false` 且宿主没给 `modelSelection` 时，会话既拿不到全局段也拿不到自建段 → 现在 system 段挂载移出 `modelSelection` 分支，只依赖运行态与子代理判定。
- 测试加强：状态自检从 13 项加到 19 项（补压缩标签两轮、配置优先、全局段真挂上、effect 清理），假的 `effect()` 改为保存 disposer 才能真正验证卸载；另加「有效命中率并列」单测。
- **验证记录的归属自动化**：`pojia_validate` 工具现在从宿主传入的 `exec.agent` 自动取会话 id（也支持显式 `sessionId` 参数），配合命令路径 `/pojia validate record` 之后，正常使用下校准永远拿到可靠归属；只有宿主没给会话时才会落到 `attribution=fallback` 并被排除在校准之外。
- **第三轮只读复审修复（6 项，含 4 个真回归）**：
  1. **升级不再吞掉老用户的通道选择**：v1.0.x 的状态文件只有 `mode`、没有 `pinnedMode`，升级后会被自适应覆盖；现在缺失 `pinnedMode` 的旧文件按「已钉住」迁移。
  2. **`armorMode: "both"` 真的生效**：`MODE_CHANNEL` 漏了 `both`，新装写 `both` 会静默变 `user` 且带 pinned。
  3. **off → on 之后 system 段恢复**：批量摘除后 WeakMap 缓存没失效，重新开启时「已挂过」直接 return，段永久缺失。
  4. **`subagentInject:false` 不再给子代理挂 system 段**：以前先挂段再返回 skipped（both 模型的子代理会白挂）。
  5. **防抖动基准改为按会话**：以前拿插件级「最近生效通道」当基准，A 会话会被 B 会话带偏；同时 `validate` 记录必须带会话 id（命令层从 `invocation.agent` 取），**归属不可靠的记录保留但不进校准聚合**。
  6. **预算 A/B 记账顺序修正**：先判断「这一轮到底会不会真发一条」，不发就不裁剪、不记 `trim`、不打 `trimmed` 标签（否则节省字节与 A/B 分桶都会虚增，出现 trim=1 / inject=0）。
  7. **校准门槛按有效样本**：1 pass + 5 gateway 不再算 6 条样本；有效命中率并列判 `tie` 而不是 `measured`。
  8. **派生数据进同一把锁**：`validation` 记录 + 校准重算 + 清空在同一事务内完成，历史截断改 tmp+rename，避免并发下校准永久退回旧结论。
- **校准历史（可审计）**：每次「最优通道决策」发生变化就追加一条到 `$DSH_HOME/pojia/calibration-history.jsonl`（样本数从 6 涨到 7 不算变化，只记决策变化），最多留 200 条；`/pojia metrics` 与 `dsh-pojia --metrics` 会显示最近 3 条，例如「11-27 11:10 claude→user(measured,12)」。这样「为什么这周走了 both / 后来又换回 user」有据可查。
- **工具输出结构化**：`pojia_status` 除文本外还返回 `verdict` / `verdict_text` / `next` / `patches_applied|total|pending` / `profile` / `channel` / `pinned` / `dsh_home` / `metrics{inject,avg_bytes,refusal,gateway_fails,retries,trim_saved_bytes,subagent_turns}`；`pojia_doctor` 增加 `summary`。agent 可以直接读这些字段，不用正则解析中文。
- **指标口径四入口补齐 + 契约测试**：`status` / `pojia_status` / `dsh-pojia --status` 也显示「运行时指标」行（之前只有 doctor、面板和 `/pojia metrics` 有）。新增 `test/metrics-contract.test.mjs`：解析 `metrics.js` 文档里列出的事件类型，断言**每一类都必须有 `metrics.record(...)` 调用点**，并验证每类都能进 `byKind`/`total`、空态与写失败都不炸——三轮里查出三个死指标（refusal / retry / validate），这条测试就是防止第四个出现。
- **第三个死指标：`validate` 事件从来没有写入者** —— 于是 `gatewayFails` 恒为 0，v1.0.5 承诺的「中转域名 + gateway fail → 建议换 endpoint」永远不会触发。现在每次 `validate record` 都会落一条 `validate` 指标（probeId / verdict / reason / persona / 家族 / 通道 / 是否压缩），doctor 的 gateway 建议与 metrics 报表从此是真数据。至此文档里承诺的五类事件（inject / fit / trim / refusal / retry / validate）全部有写入者。
- **自愈指标复活（第二个死指标）**：`retry` 事件在文档里写了却从来没被调用——自动重试、拒答补跑、自动续跑都不留痕。现在三条路径都记 `retry`（带 `reason=request-error|refusal|continue`、尝试次数、会话、错误码），`metrics` 报表多了「自愈 / retry」行，doctor 的协同行会显示「自动重试 N（refusal×2…）」。为什么重要：补跑次数是 token 成本与「模型到底稳不稳」的直接证据。
- **打包默认配置补齐协同层开关**：`cordis.patch.yml` 里直接给出 `autoProfile` / `subagentInject` / `injectBudgetKB` / `subagentBudgetKB` 四个键与注释，装完想调不用再翻文档。
- **`/pojia metrics` 与 `dsh-pojia --metrics`**：一份多行报表（事件总数 / 注入次数与均值字节 / 模型族分布与通道 / 预算压缩省了多少 / 拒答信号与 gateway fail / 校准与预算 A/B 结论 / 最近一条时间），和面板、`doctor` 完全同源。
- **修掉拒答误判（真毛病）**：长会话里只要回复**引用**内核里的拒答标记（比如把 `我不写` 写进代码块举例），就被算成一次「拒答信号」——实测一晚上刷出 45 条假信号，指标直接不能看。现在判定前先剥掉代码块与行内代码，只在正文里命中才算；自动补跑也用同一口径，不会为了引用而白补跑一轮。
- **面板加「预算 A/B」行**：开了注入预算时，卡片直接显示「压缩 67%（3 条） vs 全文 100%（3 条） → 压缩更差」这类结论。
- **检查脚本升级为诊断**：「点我检查是否生效」不再只打状态明细，直接跑 `--doctor` 并打印退出码（0 全绿 / 1 有待办 / 2 有阻断）；安装脚本收尾也改成提示 `/pojia doctor`。新增 `test/installer-encoding.test.mjs` 守住三条编码契约：`install.ps1` 必须带 UTF-8 BOM（PowerShell 5.1 中文依赖它）、`*.bat` 必须纯 ASCII、`*.sh`/`*.command` 不能有 BOM。
- **`--doctor --json` 机器可读诊断**：输出 `exit_code` / `verdict{tier,text,next}` / `patches{applied,total,pending,skipped,gap}` / `provider` / `summary`，脚本与 CI 不用再正则匹配中文；`npm run gate` 一条命令跑完语法 + 48 单测 + 30 协同 + 14 子代理。另有 [`docs/coop-layer.md`](./docs/coop-layer.md) 写清协同层数据流、决策优先级、六条不变量、指标口径与失败模式对照表。
- **`npm run gate` 一条命令跑全门禁**：`scripts/gate.mjs` 自己枚举测试文件（不依赖 shell 通配符，Windows cmd 不会假失败），依次跑语法检查、全部单测、协同自检、子代理自检并汇总。Windows(Node 24) 与 Linux/Node 18.19.1（WSL2 Ubuntu）都实测 4/4 通过；CI 仍保留分步日志 + 三平台 matrix。
- **拒答信号指标复活（修一个死指标）**：`metrics.summarize().refusalSignals` 之前永远是 0 —— 没有任何代码写 `refusal` 事件。现在每轮结束都会做一次拒答判定并记一条 `refusal`（带模型族/通道/评分结论/命中词），自动补跑关着也照记；同一会话同一 `seq` 去重。这样的意义是：`validate` 是**抽样**命中率，这一条是**每一轮**的真实拒答率，doctor 的「拒答信号 N」终于是活数据。
- **子代理精简档位（`subagentBudgetKB`）**：给子代理单独一个更小的预算（KB），>0 时子代理只拿「通用规则 + 开头覆盖声明 + 结尾风格」的精简内核，主代理仍用全文；没有领域信号时也会按「只留通用规则」精简（子代理不需要整套领域细则）。实测：内核 17.2KB → 子代理 2.1KB，省 15KB；指标里 `trim` 事件带 `sub:true`。
- **预算 A/B 基线**：`validate` 记录现在会带上「这一轮用的是压缩版还是全文内核」（`trimmed`），校准表按「族 × 通道 × 压缩/全文」攒对照样本；每侧 ≥3 条后 doctor 直接给结论，例如「claude/both：压缩 67%（3 条） vs 全文 100%（3 条） → 压缩更差，建议先关掉 injectBudgetKB」。只给建议、不擅自改配置。
- **面板出现协同卡片**：设置页「清洗」章新增一块只读卡片 —— 模型画像（provider/model → 推荐通道）、注入通道（实际生效 + 是否钉住）、校准（本机实测最优通道）、运行时指标（注入次数 / 均值字节 / 子代理轮次 / 预算压缩省下的字节 / gateway fail）。数据源与 `status`、`doctor`、工具完全同源（`/dsh-purge-safe/status` 的 `armor` + `metrics` 字段）；新增 `test/client-contract.test.mjs`（4 项）守住「四类信息 + 中英双语 + CSS 进包 + 只读无按钮」。
- **子代理注入可关（`subagentInject`）**：默认仍注入（子代理也要内核），但指标会按 `sub:true` 单独统计「子代理轮次」；设成 `false` 后子代理会话不挂段、不追消息，只记一条 `skipped=subagent-inject-off` 指标，主代理不受影响。判据复用 `identity.js` 的 `isChildAgentContext`（只看委派来源/深度，不看 `parentSession`——这是之前踩过的坑）。
- **指标更完整**：`summarize()` 增加 `subagentTurns` 与 `trim`（压缩次数 / 省下字节 / 丢弃段数），doctor 的「协同」行会直接显示「子代理轮次 N」「预算压缩 M 次（省 X KB）」。
- **会话级 system 段（修掉一个真实串味问题）**：自适应路径上的 system 段改为按 `agent.ctx.systemPrompt` 挂载（宿主的 agent 级 section 只影响该会话），只有用户**手动钉住**通道时才走全局挂载。这样同一个进程里 A 会话跑 Claude（both）、B 会话跑 DeepSeek（user）时两条会话互不影响；关内核或改钉通道会立刻摘掉各会话挂过的段。
- **防抖动**：实测赢家必须比当前通道领先 ≥15 个百分点才换，否则保持现状并在 `decision.reason` 写「防抖动」，避免薄差距来回切。
- 新增 `test/profile.test.mjs`（7 项）：模型族识别、画像与 relay 提示、人设按 model 匹配、决策优先级、指标汇总/脏行/翻滚、doctor 协同行。
- 新增 `test/calibration.test.mjs`（7 项）：样本门槛、覆盖语义、净失败口径、老记录跳过、快照/校准表读写容错、记录后自动刷新。
- **CI 升级为跨平台基线**：新增 `os × node` matrix（ubuntu / windows / macos × node 18 / 20）；`scripts/check-syntax.mjs` 做跨平台语法检查（不依赖 bash），`scripts/e2e-coop.mjs` 用最小宿主夹具跑 19 项协同断言（命令/工具注册、注入、画像决策、校准闭环、指标落盘、钉住优先），两者都进 CI。

### English

- **Model-adaptive injection (`lib/model-profile.js`)**: reads the host's authoritative `modelSelection` from `agent/pre-step`, classifies the model family (DeepSeek / Claude / GPT / Gemini / GLM / Kimi / Qwen / Llama / unknown) and picks the injection channel (`user` / `legacy` / `both`) with a written rationale per family.
- **Explicit user intent wins**: once a channel is set through `/pojia armor mode` (or `injectionMode` / `injectionChannel` in config) it is pinned and auto-adaptation stops overriding it; `autoProfile: false` disables adaptation entirely.
- **Personas follow the model**: the previously unused `model: ["claude"]` persona metadata now drives selection via `personaForModel()`; family-specific personas beat the `*` wildcard and the current persona is kept while it stays eligible.
- **Runtime metrics (`lib/metrics.js`)**: every injected turn appends an `inject` event (family / channel / bytes / relay / decision source) plus `fit` / `validate` / `refusal` events into `$DSH_HOME/pojia/metrics.jsonl`; 512KB rotation, dirty-line tolerant, never able to break injection.
- **doctor gained a `协同` line** with the profile, the injected-turn count, average bytes, refusal signals and gateway failures, plus a concrete suggestion when gateway failures happen on a relayed endpoint.
- **status shows both decisions**: new `模型画像 / profile` and `注入通道 / channel` lines distinguish the user's choice from the effective channel and mark the pinned state; the `pojia_status` tool and `/pojia armor status` expose the same fields.
- **Tier-1 baseline (`docs/tier-one-baseline.md`)**: twelve criteria, a 10 ✔ / 2 △ self-assessment and the milestone list, so "world-class" is measurable instead of a slogan.
- **Online calibration loop (`lib/calibration.js`)**: rules cold-start, measurements converge. armor writes a profile snapshot (`armor-last.json`) every turn, `validate record` stores which family/channel each result ran on, and every record recomputes `calibration.json` (a family × channel needs ≥6 samples to count). The next injection then uses the measured best channel over the rule recommendation, marked `calibrated` with the reason spelled out ("measured user better (100%, 12 records) → overrides both"). Gateway failures are discounted as net failures so a relay cannot kill a channel; `validate clear` wipes the calibration too.
- **Injection budget (`lib/budget.js`, off by default)**: enable with `injectBudgetKB`. Over budget, sections are picked by the current turn's domain (keywords in the last user message); the opening override section and the closing style/anchor sections are always kept, only unrelated domain detail is dropped, and a "trimmed N sections" note is appended — 17.2KB → 9.6KB (44% saved) on the real kernel. No domain signal means no trimming, and gains below 256 bytes are skipped; README and doctor both insist on an A/B with `validate` before turning it on permanently.
- **Fixed a fake failure that only showed up on the Windows CI runner**: `npm test` used to be `node --test test/*.test.mjs`, whose glob is expanded by the shell — on the Windows runner Node received the literal pattern and both Node versions went red with `Could not find '...\test\*.test.mjs'`. `npm test` now points at `scripts/run-tests.mjs`, which enumerates the files itself; the first CI matrix run finished with all 7 jobs green (ubuntu / windows / macos × node 18/20 plus the main test job).
- **Fourth read-only review (scoped to the previous fixes): all 4 items fixed**
  1. The trimmed flag was overwritten on the following turn: the second turn is idempotent and sends nothing, yet the snapshot was refreshed and `trimmed` fell back to false, corrupting the budget A/B buckets. A profile-only refresh now carries the existing `trimmed` over; only a real send updates it.
  2. Session snapshots lost updates under concurrency: read-merge-write between two hosts overwrote each other, demoting the loser's records to `fallback` and dropping them from calibration. Snapshot writes now take their own lock (10s stale) and give up this round instead of clobbering.
  3. Explicit config was pinned by a stale disk value: a disk `pinnedMode:false` (just a record of the effective value) beat an explicit `armorMode`. When the config sets a mode and the disk says "not pinned", the config now wins.
  4. `tie` still required equal sample counts: 6/6 vs 7/7 all-pass reported `measured` for unequal counts. It now only requires equal rates above the threshold.
  One conditional regression also fixed: pinned + `subagentInject:false` with no `modelSelection` left the agent with neither global nor per-session sections; section mounting moved out of the `modelSelection` branch.
- Tests strengthened: the state self-check went from 13 to 19 assertions (two-turn trimmed carry-over, config precedence, real global mount, effect cleanup), the fake `effect()` now keeps disposers so teardown is actually covered, plus a unit test for equal effective rates.
- **Validation records now attribute themselves**: the `pojia_validate` tool takes the session id from the host's `exec.agent` (an explicit `sessionId` argument still wins), so together with `/pojia validate record` calibration always sees reliable attribution in normal use; only when the host provides no session does a record fall back to `attribution=fallback` and get excluded from calibration.
- **Third read-only review fixes (six items, four of them real regressions)**:
  1. **Upgrades no longer discard an existing channel choice**: v1.0.x state files only carry `mode` (no `pinnedMode`) and were treated as unpinned, so adaptation overwrote the user's choice; such legacy files now migrate as pinned.
  2. **`armorMode: "both"` actually works**: `MODE_CHANNEL` was missing `both`, so a fresh config silently became `user` (with pinned).
  3. **system sections come back after off → on**: bulk unmount left the WeakMap cache stale, so re-enabling hit "already mounted" and the section stayed missing.
  4. **`subagentInject:false` no longer mounts system sections for subagents**: the section was mounted before the skip-return, wasting a mount for both-model subagents.
  5. **Anti-flapping is per session**: it used the plugin-level "last effective channel", so session A could be dragged by session B; `validate` records now carry the session id from `invocation.agent`, and records with unreliable attribution are kept but excluded from calibration.
  6. **Budget A/B accounting order fixed**: decide first whether this turn actually sends a message — no send means no trimming, no `trim` event, no `trimmed` tag (otherwise saved bytes and the A/B buckets inflate, e.g. trim=1 / inject=0).
  7. **Calibration threshold uses effective samples**: 1 pass + 5 gateway no longer counts as six samples, and equal effective hit rates report `tie` instead of `measured`.
  8. **Derived data shares the same lock**: validation write, calibration recompute and clear now happen in one transaction, and history truncation uses tmp+rename.
- **Calibration history (auditable)**: every time the "best channel" decision changes, a row is appended to `$DSH_HOME/pojia/calibration-history.jsonl` (a sample count going from 6 to 7 is not a change; only decision changes count), capped at 200 rows. `/pojia metrics` and `dsh-pojia --metrics` show the latest three, e.g. "11-27 11:10 claude→user(measured,12)" — so "why did it use both this week, then switch back" has an answer.
- **Structured tool output**: besides text, `pojia_status` returns `verdict` / `verdict_text` / `next` / `patches_applied|total|pending` / `profile` / `channel` / `pinned` / `dsh_home` / `metrics{inject,avg_bytes,refusal,gateway_fails,retries,trim_saved_bytes,subagent_turns}`, and `pojia_doctor` gained `summary`. Agents can read those fields instead of regex-parsing Chinese.
- **Metric parity across all four entry points, plus a contract test**: `status`, `pojia_status` and `dsh-pojia --status` now show the runtime-metrics line too (previously only doctor, the panel and `/pojia metrics` had it). New `test/metrics-contract.test.mjs` parses the event kinds documented in `metrics.js` and asserts every kind has a `metrics.record(...)` call site, that each kind lands in `byKind`/`total`, and that empty state and write failures never throw — three dead metrics (refusal / retry / validate) were found across three rounds, and this test exists to stop a fourth.
- **A third dead metric: nothing ever wrote `validate` events** — so `gatewayFails` stayed 0 and the "relayed endpoint with gateway failures → switch endpoint" advice promised in v1.0.5 could never fire. Every `validate record` now emits a `validate` metric (probeId / verdict / reason / persona / family / channel / trimmed), so the doctor advice and the metrics report carry real data. With that, all documented event kinds (inject / fit / trim / refusal / retry / validate) have writers.
- **Self-healing metrics are alive again (the second dead metric)**: `retry` was documented but never recorded — transport retries, refusal replays and auto-continue left no trace. All three paths now emit `retry` events (`reason=request-error|refusal|continue`, attempt, session, error code); the `metrics` report gained a "retry" line and doctor's co-op line shows "auto-retry N (refusal×2 …)". Why it matters: replay counts are the direct evidence of token cost and how stable the model actually is.
- **The bundled default config now exposes the co-op switches**: `cordis.patch.yml` documents `autoProfile` / `subagentInject` / `injectBudgetKB` / `subagentBudgetKB` inline, so tuning after install no longer needs a doc lookup.
- **`/pojia metrics` and `dsh-pojia --metrics`**: one multi-line report (total events / injections and average bytes / model-family and channel distribution / bytes saved by budgeting / refusal signals and gateway failures / calibration and budget A/B verdicts / last event time), sharing its source with the panel and `doctor`.
- **Fixed a real refusal false-positive**: in long sessions, merely *quoting* a kernel refusal marker inside a code block (e.g. showing `我不写` as an example) counted as a refusal signal — one evening produced 45 bogus signals, making the metric useless. Code fences and inline code are now stripped before scoring, and the auto-retry path uses the same rule so it never retries because of a quotation.
- **Panel gained a "Budget A/B" row**: with budgeting enabled the card shows the verdict directly ("trimmed 67% (3) vs full 100% (3) → trimming hurts").
- **Check script became a diagnosis**: "点我检查是否生效" no longer prints status details only; it runs `--doctor` and prints the exit code (0 green / 1 todos / 2 blocked), and the installers' closing hint points at `/pojia doctor`. New `test/installer-encoding.test.mjs` guards three encoding contracts: `install.ps1` must keep its UTF-8 BOM (PowerShell 5.1 needs it for Chinese), `*.bat` must stay pure ASCII, `*.sh`/`*.command` must have no BOM.
- **`--doctor --json` for machines**: emits `exit_code` / `verdict{tier,text,next}` / `patches{applied,total,pending,skipped,gap}` / `provider` / `summary` so scripts and CI stop regex-matching Chinese text; `npm run gate` runs syntax + 48 unit tests + 30 co-op checks + 14 subagent checks in one command. [`docs/coop-layer.md`](./docs/coop-layer.md) documents the data flow, decision priority, six invariants, metric semantics and a failure-mode table.
- **`npm run gate` runs the whole gate in one command**: `scripts/gate.mjs` enumerates the test files itself (no shell glob dependence, so Windows cmd cannot produce a fake failure), then runs syntax, all unit tests, the co-op self-check and the subagent self-check and prints a summary. Verified 4/4 on Windows (Node 24) and on Linux/Node 18.19.1 (WSL2 Ubuntu); CI keeps the per-step logs plus the three-platform matrix.
- **Refusal signal metric is alive again (it was dead)**: `metrics.summarize().refusalSignals` used to stay 0 because nothing ever wrote a `refusal` event. Every finished turn is now scored and recorded (`refusal` with family / channel / verdict / matched words) even when auto-retry is off, de-duplicated per session+seq. `validate` gives a sampled hit-rate; this gives the real per-turn refusal rate, so doctor's "refusal signals N" finally means something.
- **Compact tier for subagents (`subagentBudgetKB`)**: a separate, smaller budget (KB) for subagent sessions; when set, subagents receive only the generic rules plus the opening override and the closing style section while the root agent keeps the full kernel. With no domain signal it still trims to "generic rules only", because subagents rarely need the whole domain appendix. Measured: kernel 17.2KB → subagent 2.1KB (15KB saved), and the `trim` metric is tagged `sub:true`.
- **Budget A/B baseline**: `validate` records now carry whether that turn used the trimmed or the full kernel, so the calibration table builds a trimmed-vs-full comparison per family × channel; once each side has ≥3 samples doctor states the verdict (e.g. "claude/both: trimmed 67% (3) vs full 100% (3) → trimming hurts, turn injectBudgetKB off"). Advice only — the config is never changed silently.
- **The panel now has a co-op card**: the Clean chapter shows a read-only card with the model profile (provider/model → recommended channel), the effective injection channel (plus pinned state), the calibration result (measured best channel) and runtime metrics (injections / average bytes / subagent turns / bytes saved by budgeting / gateway failures). It reads the same `/dsh-purge-safe/status` payload as `status`, `doctor` and the tools; `test/client-contract.test.mjs` (4 checks) guards the four rows, both locales, the bundled CSS and the read-only nature.
- **Subagent injection switch (`subagentInject`)**: subagents are still injected by default (they need the kernel too) and metrics count them separately as `sub:true` "subagent turns"; setting it to `false` makes subagent sessions skip sections and messages entirely, recording one `skipped=subagent-inject-off` event, without affecting the root agent. Detection reuses `isChildAgentContext` (delegation origin/depth only, never `parentSession`).
- **Richer metrics**: `summarize()` now reports `subagentTurns` and `trim` (count / bytes saved / dropped sections), and doctor's co-op line shows "subagent turns N" and "budget trimmed M times (saved X KB)".
- **Per-session system sections (fixes a real cross-session leak)**: on the adaptive path the system section is now registered through `agent.ctx.systemPrompt`, which the host scopes to that agent; the global registration is only used when the user explicitly pins a channel. Two sessions in one process (Claude → both, DeepSeek → user) therefore no longer affect each other, and turning the kernel off or pinning a channel immediately unmounts every per-session section.
- **Anti-flapping**: a measured winner must lead the current channel by ≥15 percentage points before switching, otherwise the current channel stays and `decision.reason` says so.
- New `test/profile.test.mjs` (7 tests) covers classification, profile/relay notes, persona matching, decision priority, metrics aggregation/rotation and the doctor co-op line.
- New `test/budget.test.mjs` (6 tests) covers section splitting, domain inference, head/tail preservation, no-signal and small-gain refusals.
- New `test/calibration.test.mjs` (7 tests) covers thresholds, override semantics, net-failure scoring, legacy-record skipping, snapshot/table I/O resilience and the auto-refresh on record.
- **CI is now a cross-platform baseline**: new `os × node` matrix (ubuntu / windows / macos × node 18 / 20); `scripts/check-syntax.mjs` checks syntax without bash and `scripts/e2e-coop.mjs` runs 14 co-op assertions against a minimal host fixture (command/tool registration, injection, profile decision, metrics persistence, pinning), both wired into CI.

---

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
- **验证记录不再并发丢数据**：`validation.json` 的读—改—写改成事务（同目录 `validation.json.lock` 互斥，原子 rename 落盘）。两个宿主共用一个 `DSH_HOME` 同时 `record` 时，后写的不会再覆盖先写的；锁里带 owner（pid/host/token），只回收「本机 + 属主进程已退出 + 超时」的残留锁，跨机共享目录绝不抢别人的锁，释放时也只删自己的锁。冲突时命令明确回「验证记录正被另一个进程写入，请稍后重试」，不会假装成功。记录文件损坏时直接报错并保留原文件，不会把历史记录清空重写。
- **第二轮复审加固**：未就绪判定改用 strict 口径（`strictFiles` / `hostCleanGate` 这类必需补丁没命中会报「异常」而不是「已就绪」）；`validate clear` 失败不再假报成功；provider 解析认带引号的同级键、环境变量按 vendor 与 provider 匹配；取 `commands` 服务抛异常时仍会继续迟绑定重试；`--doctor` 不再用 `process.exit()` 硬砍输出。
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
- Hardened after a second read-only review round: readiness now uses the strict per-patch tally (a required `strictFiles`/`hostCleanGate` patch that no longer matches reports "异常" instead of "已就绪"), `validate clear` propagates failures, provider parsing handles quoted sibling keys and matches vendor env vars to the configured provider, a throwing `commands` lookup still falls through to late binding, and `--doctor` no longer truncates its output with `process.exit()`.
- Also includes the unreleased 1.0.4 stability work: single-segment armor injection, tighter fallback-wording gating, bounded continue-retry.
- Validation records can no longer be lost to concurrency: the read-modify-write of `validation.json` is now a transaction (`validation.json.lock` next to it, atomic rename on write). The lock records its owner (pid/host/token); only a lock whose host matches, whose owner process is gone and which has timed out is reclaimed, so a lock on a shared network home is never stolen, and release only removes our own lock. A real conflict answers "another process is writing, retry" instead of pretending success, and a corrupted records file is reported and left untouched instead of being overwritten with an empty history.
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
