# 协同层架构（Co-op Layer）

这份文档回答一个问题：**dsh-pojia 凭什么说它「和底层模型、agent 协同」** —— 而不是又一层叠加的提示词。
给维护者看：每一条决策的数据从哪来、由谁做、边界在哪、怎么验。

最后更新：2026-11-27（v1.1.0）

## 一、数据流（一轮对话里发生什么）

```
宿主 agent/pre-step payload
  ├─ modelSelection { provider, model }   ← 权威值，不猜配置文件
  ├─ agent { session, ctx.systemPrompt }  ← 会话级挂载点
  └─ messages                              ← 本轮真实用户文本（用于领域推断）

        │
        ├─① 模型画像  lib/model-profile.js
        │     classifyModel → family（deepseek/claude/gpt/gemini/glm/kimi/qwen/llama/unknown）
        │     personaForModel → 该族的人设（点名族优先于 *，当前人设同层不换）
        │
        ├─② 在线校准  lib/calibration.js
        │     读 calibration.json（由 validate 记录聚合而来）
        │     同族 × 同通道 ≥6 条样本 → 实测最优通道；≥15pp 才换（防抖动）
        │
        ├─③ 决策  decideInjection()
        │     pinned（用户手设）＞ calibrated（本机实测）＞ profile（规则）＞ default
        │
        ├─④ 注入
        │     user  通道：往 pre-step 的 messages 追加一条带 source 的注入消息
        │     system 通道：agent.ctx.systemPrompt.section()（会话级；钉住时才是全局）
        │     预算（可选）：lib/budget.js 按本轮领域挑段，头尾必留
        │
        └─⑤ 观测  lib/metrics.js
              inject / fit / trim / refusal / validate → $DSH_HOME/pojia/metrics.jsonl
```

第二轮之后：`validate record` 会把「这一轮跑在哪个族/通道/是否压缩」一起写进 `validation.json` →
`calibration.json` 重算 → 下一轮决策变化。**这就是闭环**。

## 二、模块职责

| 文件 | 职责 | 边界 |
|---|---|---|
| `lib/model-profile.js` | 模型族识别、人设匹配、决策优先级 | 纯函数，无 I/O（人设列表除外） |
| `lib/calibration.js` | 画像快照、校准表读写、聚合、防抖动、预算 A/B | 只碰 `$DSH_HOME/pojia/*.json` |
| `lib/metrics.js` | 事件记录（JSONL）、汇总、翻滚 | 写失败一律吞掉，绝不影响注入 |
| `lib/budget.js` | 切段、领域推断、按预算挑段 | 纯函数；默认关 |
| `lib/armor.js` | 会话内注入、system 段生命周期、开关 | 负责「注入」本身与 per-agent 挂载 |
| `lib/verdict.js` / `lib/doctor.js` | 结论与诊断（status / doctor / CLI / 工具共用） | 只读 |
| `lib/provider-info.js` | 读 settings 的 provider/baseURL（含 relay 判定） | 只读配置文件与环境变量 |

## 三、不变量（改代码前先读）

1. **用户显式设置永远优先**：`/pojia armor mode …` 或配置里写 `armorMode`/`injectionMode` → `pinnedMode=true`，自适应与校准都不得覆盖。
2. **system 段默认会话级**：自适应路径必须用 `agent.ctx.systemPrompt.section()`；只有用户钉住通道时才用全局挂载（否则两个会话会串味，这是踩过的坑）。
3. **决策必须有理由**：每次决策产出 `{ mode, source, reason }`，source ∈ pinned / calibrated / profile / default，理由进 status、doctor、面板、`fit` 指标。
4. **观测绝不阻碍主流程**：metrics / 校准 / 快照全部 try/catch；写失败就当没发生。
5. **样本不足不猜**：校准 <6 条用规则；A/B 任一侧 <3 条不给结论；预算没有领域信号时不裁（子代理档位除外，它显式选择「只留通用规则」）。
6. **不动注入正文的语义**：预算裁剪只按段落整块取舍，不改写、不插值、不重排措辞。

## 四、指标事件表

| kind | 何时写 | 关键字段 |
|---|---|---|
| `inject` | 每轮（含被跳过的，标 `skipped`） | family / mode / source / bytes / sub / fresh / relay |
| `fit` | 生效通道发生变化时 | family / mode / source / reason |
| `trim` | 预算裁剪生效时 | bytesBefore / bytesAfter / saved / dropped / domains / sub |
| `refusal` | 每轮结束判定为拒绝/折中时（与自动补跑解耦） | family / mode / verdict / words / seq |
| `validate` | 手工记录探针结果时 | probeId / verdict / reason / persona / family / mode / trimmed |

`metrics.summarize()` 的口径：`injectCount` 只数真正注入的（不含 skipped），`byKind.inject` 是事件数，`avgInjectBytes` 只对真正注入取均值。

## 五、失败模式与对策

| 现象 | 根因 | 对策（已有） |
|---|---|---|
| `/pojia` 敲了没反应 | 命令面没注册 / profile 不是这个 | `commandRegState` + doctor「命令 /pojia」行 + 迟绑定重试 |
| 结论说「已就绪」但补丁没写进去 | 展示汇总把 skipped 算成 ready | `verdict.gap` 取 strict（`patches_ready`）与展示的最大值；`applied===0` 单独判异常 |
| 两个会话互相影响 | system 段全局挂载 | 改为 per-agent 挂载（`agent.ctx.systemPrompt`） |
| 换了通道反而更差 | 薄差距抖动 | ≥15pp 才换 + `validate clear` 连校准一起清 |
| 校准用的数据不真实 | validate 记录不带族/通道 | 快照 `armor-last.json` + record 时补齐 family/mode/trimmed |
| 预算省了 token 但效果掉了 | 裁剪改内容 | 默认关 + A/B 对照 + doctor 给「关掉 injectBudgetKB」的结论 |

## 六、怎么验

```bash
npm run gate    # 语法 + 48 单测 + 30 协同 + 14 子代理，三平台一致
node bin/dsh-pojia.js --doctor --json    # 机器可读诊断（CI/脚本用）
```

真机自检：`/pojia status` 前五行应依次出现 `结论 / verdict`、`模型 / provider`、`模型画像 / profile`、`注入通道 / channel`、`校准 / calibration`。
