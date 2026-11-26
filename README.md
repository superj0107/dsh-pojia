# dsh-pojia — DeepSeek Harness 破甲融合包

把两层破甲能力合成一个插件，**所有功能统一收进 `/pojia` 命令**：

| 层 | 来源 | 作用 |
|---|---|---|
| 宿主清洗层 | dsh-purge-safe (CallMeGuLab) | 改宿主套件：提示词默认值、审批/沙箱闸门、系统提示渲染、埋点等 64 项补丁；清洗面板 + 演练台 |
| 破甲内核层 | 富江破甲 (Minglink) | 会话层注入内核：user/legacy/both 三种通道，运行时开关，拒绝对抗与会话投影评分 |

两层通道互补（system 层 + user 层），一个插件同时拆宿主的闸门和模型那头的拒绝。

> 免费开源、非商业。遵守 CC BY-NC-SA 4.0；双上游署名见 [NOTICE](./NOTICE)。

## 安装

面向 **DSH 0.2.2-rc.5**（桌面 + Web）。

```sh
# 桌面 profile（本机实际使用的那个）
dsh plugin --profile desktop add /absolute/path/to/dsh-pojia
# 或 Web
dsh plugin --profile web add /absolute/path/to/dsh-pojia
```

完全退出并重新打开宿主。首次使用在会话标题旁的 **dsh-pojia** 面板点「应用」（Clean → Apply）；成功后宿主自动重启一次。

## 统一命令 `/pojia`

原来的 `/purge`、`/rules`、`/skills`、`/rewind`、`/fujiang` **全部收进** `/pojia`，旧命令不再单独注册。

```
/pojia status                 查看状态（清洗进度 + 破甲内核开关/模式）
/pojia apply                  应用全部宿主补丁
/pojia revert                 回滚补丁（保留 prompt-inject.md）
/pojia uninstall              卸载
/pojia edit                   编辑注入文件

/pojia armor status           破甲内核状态
/pojia armor on               开启内核
/pojia armor off [soft|hard|new]  关闭内核（hard 会往当前会话写作废声明）
/pojia armor mode user|legacy|both 切换注入通道

/pojia persona list                       列出人设
/pojia persona use <id>                   切换人设（下一轮注入生效）
/pojia persona show                       查看当前人设
/pojia persona import <id> [正文]          导入/新建人设
/pojia persona delete <id>                删除用户人设

/pojia validate list [kind]               列出探针任务（拿去会话里跑）
/pojia validate record <id> <pass|fail|skip> [备注]  记录一条结果
/pojia validate report                    查看各人设命中率
/pojia validate clear                     清空验证记录

/pojia rules list | use <id> | create <id> | delete <id> | reset
/pojia skills list | import <路径> | create <id> | delete <id>
/pojia rewind [once|round]    撤回上一步 / 上一轮
/pojia help                   帮助
```

## 统一工具

| 工具 | 用途 |
|---|---|
| `pojia_status` | 融合包状态（补丁 + 内核） |
| `pojia_apply` / `pojia_revert` | 应用 / 回滚补丁 |
| `pojia_armor` | 破甲内核开关与模式（action=status/on/off/mode） |
| `pojia_profile` | 内核版本、注入槽位、能力清单 |
| `pojia_persona` | 人设库（action=list/use/show/import/delete） |
| `pojia_validate` | 有效性验证（action=list/record/report/clear） |

HTTP 路由面板沿用内部路径 `/dsh-purge-safe/*`（用户不可见，保持稳定）。

## 两层怎么配合

- **宿主层**把 Approval/Never、沙箱拒写、系统提示身份、外部内容 untrusted 拦截等默认行为改掉，让工具执行不再被宿主拦。
- **内核层**在会话里注入破甲提示词（user 通道默认追加、不改写用户原文，幂等；legacy 走 system 双段），压低模型侧的拒绝率。

关掉内核：`/pojia armor off` 不影响宿主补丁；回滚宿主：`/pojia revert` 不影响内核开关。两者独立。

## 可切换人设库

破甲内核注入的正文来自当前人设，默认内置 `pojia-armor`（富江内核）。用户可以在 `$DSH_HOME/pojia/personas/*.md` 放带 frontmatter 的人设文件（`id` / `name` / `description` / `model` / `order`），用 `/pojia persona use <id>` 切换，**下一轮注入即生效**。格式参考 agent-purge 的人设文件，但本包不依赖其代码。切换人设只换提示词正文，不改宿主补丁和内核开关。

设计意图：提示词有效期跟模型版本走，不同模型适合不同人设；把人设做成可插拔数据，而不是把别家的人设库整包搬进来。

## 有效性验证

仅有"注入成功"不等于"破甲有效"。`/pojia validate list` 给出一组固定探针（拒绝类 / 边界类 / 正常类），你在会话里实际跑后用 `record <id> <pass|fail|skip>` 记录，`report` 按人设汇总命中率（`skip` 不计入分母）。这样可以直接比较"当前模型 + 当前人设"的实际效果，而不是只看日志里的 `injectBytes`。

验证记录存在 `$DSH_HOME/pojia/validation.json`。

## 注入文件

`prompt-inject.md`（`$DSH_HOME`）是用户文件，`revert`/`uninstall` 都保留。破甲内核自己的开关状态存在 `$DSH_HOME/dsh-pojia-armor.state.json`（与旧富江的 `fujiang-armor.state.json` 隔离）。

## 目录

```
lib/              宿主补丁引擎（源自 purge-safe）
lib/armor.js      破甲内核（源自富江，改造为可复用模块）
armor/            破甲提示词 + 富江许可原文
lib/redteam/      演练台（源自 purge-safe）
client.js         统一面板
presets/ skills/  预设与技能
```

## 许可与署名

整体 **CC BY-NC-SA 4.0**（[LICENSE](./LICENSE)）。包含：
- dsh-purge-safe — Apache 2.0（[LICENSE-APACHE.txt](./LICENSE-APACHE.txt)）
- 富江破甲 / Minglink — CC BY-NC-SA 4.0 + 附加条款（[armor/FUJIANG-LICENSE.txt](./armor/FUJIANG-LICENSE.txt)）

再分发必须保留全部三方署名、许可原文并注明修改；**严禁商业使用**。全家福见 [NOTICE](./NOTICE)。

原上游文档保留作参考：[README-upstream-purge-safe.md](./README-upstream-purge-safe.md)。
