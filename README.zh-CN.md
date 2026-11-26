# dsh-pojia（简体中文）

把两层破甲能力合成一个 DeepSeek Harness 插件：**宿主清洗层**（源自 dsh-purge-safe）+ **破甲内核层**（源自富江破甲 / Minglink）。所有功能统一收进 `/pojia` 命令。

> 免费开源、非商业。整体 CC BY-NC-SA 4.0；三方署名见 [NOTICE](./NOTICE)。

## 安装

面向 **DSH 0.2.2-rc.5**（桌面 + Web）。

一键脚本（解压 `dsh-pojia-<版本>-installer.zip` 后）：

```sh
bash install.sh                 # macOS / Linux / WSL
bash install.sh --uninstall     # 卸载
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```

或手动用 `dsh plugin`：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-pojia
# 或
dsh plugin --profile web add /absolute/path/to/dsh-pojia
```

完全退出并重新打开宿主。会话标题旁点 **dsh-pojia** → 清洗 → 应用；成功后宿主自动重启一次。

## 统一命令 `/pojia`

原来的 `/purge`、`/rules`、`/skills`、`/rewind`、`/fujiang` **全部收进** `/pojia`，旧命令不再单独注册。

```
/pojia status                 查看状态（清洗进度 + 破甲内核）
/pojia apply                  应用全部宿主补丁
/pojia revert                 回滚补丁（保留 prompt-inject.md）
/pojia uninstall              卸载
/pojia edit                   编辑注入文件

/pojia armor status           破甲内核状态
/pojia armor on               开启内核
/pojia armor off [soft|hard|new]  关闭内核
/pojia armor mode user|legacy|both 切换注入通道

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
| `pojia_armor` | 破甲内核开关（status/on/off/mode） |
| `pojia_profile` | 内核版本、注入槽位、能力清单 |

## 两层怎么配合

- **宿主层**改掉 Approval/Never、沙箱拒写、系统提示身份、外部内容 untrusted 拦截等默认行为，让工具执行不再被宿主拦。
- **内核层**在会话里注入破甲提示词（user 通道默认追加、不改写用户原文，幂等；legacy 走 system 双段），压低模型侧拒绝率。

关内核（`/pojia armor off`）不影响宿主补丁；回滚宿主（`/pojia revert`）不影响内核开关。两者独立。

## 注入文件

`prompt-inject.md`（`$DSH_HOME`）是用户文件，`revert`/`uninstall` 都保留。内核开关状态在 `$DSH_HOME/dsh-pojia-armor.state.json`（与旧富江状态隔离）。

## 许可与署名

整体 **CC BY-NC-SA 4.0**（[LICENSE](./LICENSE)）。包含：
- dsh-purge-safe — Apache 2.0（[LICENSE-APACHE.txt](./LICENSE-APACHE.txt)）
- 富江破甲 / Minglink — CC BY-NC-SA 4.0 + 附加条款（[armor/FUJIANG-LICENSE.txt](./armor/FUJIANG-LICENSE.txt)）

再分发须保留全部三方署名与许可、注明修改，**严禁商业使用**。详见 [NOTICE](./NOTICE)。上游文档保留：[README-upstream-purge-safe.md](./README-upstream-purge-safe.md)。
