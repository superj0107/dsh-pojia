# 免责声明与使用边界 / Disclaimer & Scope of Use

> 使用 dsh-pojia 即表示你已阅读、理解并接受以下全部条款。若不同意，请勿使用、分发或基于本作品再开发。

## 1. 性质与用途

dsh-pojia 是一个**本地、非商业、仅供学习与研究**的 DeepSeek Harness 插件，作用是调整本机宿主与模型的提示词/行为默认值。它不是安全产品，也不提供任何对第三方系统的攻击能力。

本项目**不分发、不鼓励、不支持**任何用于攻击、入侵、窃取数据或规避安全审查的载荷。项目内的 redteam 技能与探针仅用于**你有权管理的本机、离线靶场，或已获书面授权的演练环境**。

## 2. 合法与授权使用

使用者必须：

- 仅在**自己有权管理**的主机、账号与数据上使用；
- 对任何第三方系统、网络、账号进行操作前，取得所有者**明确书面授权**；
- 遵守所在地法律法规（包括但不限于网络安全、数据安全、个人信息保护相关法律）以及所用模型服务商、宿主软件的服务条款；
- 自行判断使用本工具产生的输出是否适合其场景，并对重要操作保留人工审核。

**严禁**将本项目用于：未经授权的系统访问、攻击、数据窃取、破坏、黑灰产牟利，或任何违法违规活动。

## 3. 非商业约束

本项目整体采用 **CC BY-NC-SA 4.0**，明确**禁止任何商业使用**，包括但不限于：

- 售卖、付费下载、倒卖、捆绑销售；
- 付费代部署、收费咨询或营利性培训；
- 任何形式的付费门槛或商业化再分发；
- 隐瞒来源、去除署名或违反相同方式共享条款。

违反上述条款者，其对本作品的使用与分发授权**自动且不可撤销地终止**，须立即停止使用并销毁所有副本与衍生版本。

## 4. 风险自担 / 不担保

软件按 **"原样"（AS IS）** 提供，作者与贡献者不作任何明示或默示保证，包括但不限于：对特定用途的适用性、准确性、完整性、安全性、不侵权。

提示词改写可能改变模型行为、移除宿主原有的安全说明或触发非预期结果；补丁可能与未来版本宿主不兼容，导致功能异常。**使用者须自行备份配置、在隔离环境测试，并自行承担一切使用后果**（包括数据丢失、服务中断、账号风险或法律责任）。在法律允许的最大范围内，作者与贡献者不承担任何直接、间接、附带或后果性责任。

## 5. 数据与隐私

本工具默认在本机运行，配置和人设保存在本地目录。但启用后，提示词会随宿主请求发送到你配置的模型服务；更新检查、安装宿主可能访问网络。**请勿在人设或提示词中放入密钥、个人信息或机密数据**。本工具不提供完整的网络隔离或数据防泄漏保障。

## 6. 第三方独立性

本项目整合自 dsh-purge-safe（Copyright 2026 CallMeGuLab，Apache-2.0）与富江破甲 / dsh-infinite-gen-4（Copyright 2026 Minglink，CC BY-NC-SA 4.0 及附加条款），并与 DeepSeek、模型服务商及其关联主体**无任何隶属、授权、合作或背书关系**。文中所有第三方名称与标识归各自权利人所有。完整署名与许可见 [NOTICE](./NOTICE)。

## 7. 中文以外版本

The English translation of this disclaimer is provided below for reference; in case of conflict, the Chinese version shall prevail.

---

## 1. Nature and Purpose

dsh-pojia is a **local, non-commercial tool for learning and research only**. It adjusts prompt and behavior defaults of a locally installed DeepSeek Harness. It is not a security product and provides no capability to attack third-party systems. This project does not distribute or encourage any payload for intrusion, data theft, or security-control evasion. The bundled redteam skills and probes are intended only for systems you are authorized to manage, offline labs, or engagements with written authorization.

## 2. Lawful and Authorized Use

Use only on systems, accounts, and data you are authorized to manage. Obtain explicit written authorization before touching any third-party system. Comply with applicable laws (including cybersecurity, data security, and personal information protection laws) and the terms of service of your model and host providers. **Any unauthorized access, attack, data theft, sabotage, or illegal activity is strictly prohibited.**

## 3. Non-Commercial

Licensed under **CC BY-NC-SA 4.0, non-commercial only**. Selling, paid deployment, paid consulting/training, paywalls, resale, or redistribution without attribution are strictly prohibited. Violation automatically and irrevocably terminates your license.

## 4. AS IS / No Warranty

The software is provided **AS IS**, without warranties of any kind. Prompt rewriting may alter model behavior or remove host safety instructions; patches may break on future host versions. You must back up configurations, test in isolation, and bear all consequences. To the maximum extent permitted by law, the authors and contributors are not liable for any direct, indirect, incidental, or consequential damages.

## 5. Data and Privacy

The tool runs locally and stores configuration on disk. However, prompts are sent to your configured model service with requests, and updates/installation may access the network. **Do not put credentials, personal information, or secrets into personas or prompts.** No full network isolation or DLP is provided.

## 6. Third Parties

This work is derived from dsh-purge-safe (Copyright 2026 CallMeGuLab, Apache-2.0) and Fujiang armor / dsh-infinite-gen-4 (Copyright 2026 Minglink, CC BY-NC-SA 4.0 + extra terms). It is **not affiliated with, endorsed by, or sponsored by** DeepSeek or any model provider. See [NOTICE](./NOTICE) for full attribution.
