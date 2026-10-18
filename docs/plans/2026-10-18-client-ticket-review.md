# 双客户端基线：to-tickets 合并版与发布记录

日期：2026-10-18（Asia/Shanghai）。状态：**PUBLISHED_AND_VERIFIED；9 张新增票 #76–#84、25 张既有票修订及原生依赖已发布并回读。** 完成时间：2026-10-18 11:20:05 +08:00。

来源为[已发布总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)、[开发蓝图](2026-10-17-product-direction-and-iteration-plan.md)和[组级任务稿](2026-10-18-client-baseline-work-items.md)。本稿只记录具体拆分、依赖和发布差异；产品方向沿 Q1–Q12，不重开设计质询，不另建总规格。完整标题、逐条验收、正文及原生依赖模板见[机器提案](2026-10-18-client-ticket-proposal.json)。本次 to-tickets 不修改或关闭父规格 #19。本稿为第 2 版：按用户合并建议，将首次提案的 14 张新增票合并为 9 张，原需求和验收范围保持；用户随后明确“按9张发布吧”，本稿记录该获批版本及实际发布结果。

## 1. 当前核对与拆分依据

- 初稿与本次合并修订的 HEAD 均为 `458a2588f1da92595447cc912a3b25918be69def`；初稿入口冻结 1,752 个 Git 可见现存文件，本次合并入口为 1,754 个，包含随后新增的两份工单草稿。既有修改继续保留。
- 2026-10-18 10:32:16（Asia/Shanghai）取得全部 57 张 Issue 的完整正文、22 条评论和 73 条原生前置；16 CLOSED / 41 OPEN。#19 无评论，其正文与已发布规格一致，SHA-256 为 `77bc9bdf6dd381aa08d84f41c940e6890a8481885111a530be5ab8593ebdf098`。
- 全部标题/正文/评论检索新 Pi、CLIENT、GCLIENT、MATERIAL 标识仅命中 #19；随后逐项对照已有职责。#66–#74 已有部分 CLI/MCP/模型/产物能力，新增票补独立设置、共享范围及接续缺口，不把原票重建或重开。
- 产品账号使用保护目前含 Host 单实例计数；MCP 配置已有跨实例 revision；CLI 能设置部分 MCP/模型绑定，但认证仍有 Host 依赖。共同会话锁已有基础，允许根聚合、历史账号绑定消费和双端配套组合准入仍有缺口。以上为静态核对，非新增运行 PASS。
- 初稿把账号、模型和会话能力拆为 10 张 CLIENT 票；本版按同一用户动作及共同实现/验收边界合并为 6 张。每张保留原来的验收段，完整满足才关闭；原组级 ID、需求和 Gate 不变。
- Pi 保留适配票，候选制作与同候选两端回归合为一票，GP130-01/02/03 仍分别留证。没有已证实必须先做的全仓机械重构；必要的小范围提炼随最先使用它的完整行为交付。

- 合并修订时于 2026-10-18 11:00:22（Asia/Shanghai）重新读取全部 57 张工单及 73 条原生前置；正文与元数据相对初稿无漂移。合并前后全部 62 条具体新票验收项逐项映射，仅调整合并造成的跨票措辞，公共证据要求继续适用。

| 原拟议票 | 合并后 | 合并理由 |
| --- | --- | --- |
| PI130-02 + PI130-03 | PI130-02 | 同一候选的制作与交付验证共同组成一个可使用结果，复用现有回归入口；保留两个 Gate 的独立证据。 |
| CLIENT-01A + CLIENT-01B | CLIENT-01A | API Key 与 OAuth 共用产品账号身份、秘密管理、选择及活动使用协调，作为同一账号设置任务的两条路径。 |
| CLIENT-02B + CLIENT-02C | CLIENT-02B | 两类模型调用和账本已有基础，本批共同补共享绑定与无 Host 的 CLI 使用，保留分类和产物各自负例。 |
| CLIENT-03A + CLIENT-03B | CLIENT-03A | 发现历史与判断能否接续在一次用户操作中衔接，同票守住账号和版本准入，避免出现不完整的接续入口。 |
| CLIENT-04A + CLIENT-04B | CLIENT-04A | 正常交接和异常恢复共享执行所有权状态及测试夹具，作为同一会话交接能力的成功和失败路径。 |

PI130-01、CLIENT-01C、CLIENT-02A、MATERIAL-01 保持独立，分别承担接口适配、MCP 认证与调用、共同配置基础和材料路线比较。被合并的本地 ID 仅保留在映射和验收段来源中，不再单独发布。

同一张票内可按验收段分提交、保存中间证据，不再为这些紧密相关的段另建工单。账号票需同时通过 API Key/OAuth，模型票需同时通过分类/生图，会话交接票需同时通过正常/异常路径；不会因减少票数而减少关闭条件。合并会使下游等待对应整票完成：例如共享配置等待完整账号设置，会话发现与准入作为一票在共同配置就绪后验收；项目整理 #39/#40 仍可独立推进。

## 2. 已发布工单（按发布依赖顺序）

以下本地 ID 已映射到实际 GitHub 工单 #76–#84，均为 OPEN / ready-for-agent。每票包含完整交付、成功及相关失败路径、实际入口证据和关闭条件；ready-for-agent 不替代前置核对。

1. **[在精确新版 Pi 上贯通两端编程与受控能力](https://github.com/Ricardo121380/only-my-pi/issues/76)** — PI130-01

   **Blocked by：** 无。

   **交付：** CLI 与图形端使用精确目标 Pi 完成当前编程工作，保留必要产品约束，并以实际接口证据解释保留或简化的封装。

   **验收：** GP130-01；C/P。

2. **[交付并验收同一新版 Pi 私有候选](https://github.com/Ricardo121380/only-my-pi/issues/77)** — PI130-02

   **Blocked by：** [PI130-01 / #76](https://github.com/Ricardo121380/only-my-pi/issues/76)。

   **交付：** 用户从同一新版 Pi 私有候选启动 CLI 和 WebUI，候选内依赖、扩展、补丁及声明可核验，并从两个真实入口完成当前已实现的编程流程。

   **验收：** GP130-02、GP130-03；C/P/B。

3. **[在 CLI 独立完成产品账号设置与登录](https://github.com/Ricardo121380/only-my-pi/issues/78)** — CLIENT-01A

   **Blocked by：** [#75](https://github.com/Ricardo121380/only-my-pi/issues/75)（已完成）。

   **交付：** 用户只通过 CLI 新增 API Key 产品账号或完成 OAuth 登录，列出并显式选择账号后完成真实 Pi 编程调用；取消、撤销及多进程账号使用可正确协调，GUI 随后读取同一身份与状态。

   **验收：** GCLIENT-01 的账号基础、GCLIENT-01 的账号 OAuth；C/P/B。

4. **[在 CLI 独立配置认证 MCP 并受控调用](https://github.com/Ricardo121380/only-my-pi/issues/79)** — CLIENT-01C

   **Blocked by：** [CLIENT-01A / #78](https://github.com/Ricardo121380/only-my-pi/issues/78)。

   **交付：** 用户只通过 CLI 完成所选 stdio/HTTP MCP 设置、凭据或 OAuth 认证、启用及实际工具调用，GUI 随后能读取相同配置与状态。

   **验收：** GCLIENT-01 的工具认证、GCLIENT-06 的 MCP/codemode；C/P/B。

5. **[两端共用产品设置并在下一任务实际加载](https://github.com/Ricardo121380/only-my-pi/issues/80)** — CLIENT-02A

   **Blocked by：** [CLIENT-01A / #78](https://github.com/Ricardo121380/only-my-pi/issues/78)。

   **交付：** 用户在 CLI 或 GUI 修改产品默认、项目覆盖及声明参数，另一端看到同一版本，并由下一次真实任务加载相同工具/技能配置。

   **验收：** GCLIENT-02 的共同合同、衔接 G5-01/02；C/P/B。

6. **[两端共用模型绑定并在 CLI 完成分类与生图](https://github.com/Ricardo121380/only-my-pi/issues/81)** — CLIENT-02B

   **Blocked by：** [CLIENT-02A / #80](https://github.com/Ricardo121380/only-my-pi/issues/80)。

   **交付：** 用户在任一端设置分类和生图的产品账号/模型绑定，在无 OMP GUI/Host 的 CLI 中分别授权并完成分类、生成与保存；两端能够查看相同调用归属、恢复产物并完成显式导出。

   **验收：** GCLIENT-06 的分类、GCLIENT-02 的分类绑定、GCLIENT-06 的生图与产物、GCLIENT-02 的生图绑定；C/P/B。

7. **[双向发现会话并核验接续账号与版本](https://github.com/Ricardo121380/only-my-pi/issues/82)** — CLIENT-03A

   **Blocked by：** [#63](https://github.com/Ricardo121380/only-my-pi/issues/63)（已完成）；[CLIENT-02A / #80](https://github.com/Ricardo121380/only-my-pi/issues/80)。

   **交付：** CLI 与图形端在同一已登记项目找到并查看相同历史，接续前核对原账号和配套运行组合；合法停止历史可接续，缺少绑定时明确选择，未验证组合只读。

   **验收：** GCLIENT-03 的发现与只读历史、GCLIENT-03 的执行准入；C/P/B。

8. **[完成双向会话交接及异常恢复](https://github.com/Ricardo121380/only-my-pi/issues/83)** — CLIENT-04A

   **Blocked by：** [CLIENT-03A / #82](https://github.com/Ricardo121380/only-my-pi/issues/82)。

   **交付：** 用户停止一个入口后从另一个入口继续同一会话；正常竞争以及崩溃、撤权、丢回执后的恢复都只允许一端执行，保留项目单写、跨项目并行与未知结果。

   **验收：** GCLIENT-04 的正常交接与竞争、GCLIENT-04 的异常恢复；C/P/B。

9. **[实测比较保留全部格式的材料依赖路线](https://github.com/Ricardo121380/only-my-pi/issues/84)** — MATERIAL-01

   **Blocked by：** 无。

   **交付：** 用户得到可比较的实测结果，判断裁减现有图片链非必需构建分支或采用替代图片实现是否可行，完整文档与安装要求继续保留。

   **验收：** 比较交付，不产生产品 Gate PASS；研究/有界 C/P/I 实验按实际范围记录。

## 3. 既有工单的具体修订

以下 25 张票已完成正文修订，沿用原编号、标题、状态、评论和既有验收，只追加本次范围或定向替换冲突措辞。已关闭的 #20/#22/#62–#75 及其失败记录保持；#21 不重跑、不关闭，#23 的原材料前置保持。

| 工单 | 正文变化 | 原生依赖变化 |
| --- | --- | --- |
| [#26](https://github.com/Ricardo121380/only-my-pi/issues/26) | 使用选定精确 Pi 候选，默认增加新版私有候选前置；原材料和资源义务保持。 | 新增 PI130-02 |
| [#28](https://github.com/Ricardo121380/only-my-pi/issues/28) | 安装身份按选定组合，默认增加新版基础运行前置；G2 完整出口不变。 | 新增 PI130-01 |
| [#29](https://github.com/Ricardo121380/only-my-pi/issues/29) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#30](https://github.com/Ricardo121380/only-my-pi/issues/30) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#31](https://github.com/Ricardo121380/only-my-pi/issues/31) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#32](https://github.com/Ricardo121380/only-my-pi/issues/32) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#33](https://github.com/Ricardo121380/only-my-pi/issues/33) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#34](https://github.com/Ricardo121380/only-my-pi/issues/34) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#35](https://github.com/Ricardo121380/only-my-pi/issues/35) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#36](https://github.com/Ricardo121380/only-my-pi/issues/36) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#37](https://github.com/Ricardo121380/only-my-pi/issues/37) | 补齐该材料切片的真实 CLI 入口及共同快照验收，原前置保持。 | 保留原边 |
| [#38](https://github.com/Ricardo121380/only-my-pi/issues/38) | 补齐该材料切片的真实 CLI 入口及共同快照验收，增加完整交接恢复前置。 | 新增 CLIENT-04A |
| [#39](https://github.com/Ricardo121380/only-my-pi/issues/39) | 解除对完整 U2/#38 的开工依赖；本票实现整理元数据，最终 U3 仍经 #43/#44 汇合 U2。 | 移除 #38 |
| [#40](https://github.com/Ricardo121380/only-my-pi/issues/40) | 解除对完整 U2/#38 的开工依赖；本票实现整理元数据，最终 U3 仍经 #43/#44 汇合 U2。 | 移除 #38 |
| [#43](https://github.com/Ricardo121380/only-my-pi/issues/43) | 显式增加 #38，保持原 #39/#40/#74；修正 U2 已完成的提前措辞。 | 新增 #38 |
| [#44](https://github.com/Ricardo121380/only-my-pi/issues/44) | 保持原前置；在完整 U3 旅程汇合双端身份及材料，不重复实现共同目录。 | 保留原边 |
| [#50](https://github.com/Ricardo121380/only-my-pi/issues/50) | 共享产品配置来源语义，新增 CLIENT-02A 前置；保留完整资源目录 UI。 | 新增 CLIENT-02A |
| [#51](https://github.com/Ricardo121380/only-my-pi/issues/51) | 把原 GUI 专属范围改为产品共享，复用共同配置并完成全部资源页面与加载反馈。 | 保留原边 |
| [#52](https://github.com/Ricardo121380/only-my-pi/issues/52) | 将 Schema 编辑/失败恢复接入共同产品配置，保留完整 GUI 表单要求。 | 保留原边 |
| [#56](https://github.com/Ricardo121380/only-my-pi/issues/56) | 完整 U5 旅程改为共享产品默认，区分产品 CLI 设置和外部原配置。 | 保留原边 |
| [#57](https://github.com/Ricardo121380/only-my-pi/issues/57) | 汇合三个新增共享能力末端及同候选 Pi 回归；账号两种认证经共同前置收齐，保留 #56/#75。 | 新增 PI130-02、CLIENT-01C、CLIENT-02B、CLIENT-04A |
| [#58](https://github.com/Ricardo121380/only-my-pi/issues/58) | 保留性能阈值与样本要求，补新增双端任务和配置/历史规模。 | 保留原边 |
| [#59](https://github.com/Ricardo121380/only-my-pi/issues/59) | 实际 Full 包含共享配置和双端接续；版本以选定精确候选为准。 | 保留原边 |
| [#60](https://github.com/Ricardo121380/only-my-pi/issues/60) | 真实服务场景纳入独立 CLI/共享能力，保留具体授权、预算及失败首停。 | 保留原边 |
| [#61](https://github.com/Ricardo121380/only-my-pi/issues/61) | 同候选汇总完整 WebUI 与新增核心能力，全部出口后才进入桌面。 | 保留原边 |

#39/#40 可独立开工的依据是已有项目目录、稳定身份和只读历史入口不经过 parser；新增整理元数据由两票各自完整实现并验收，尚未被宣称已完成。本次依赖变更已**先补 #43←#38，再移除 #39/#40←#38**，确保分支/完整 U3 始终等待完整材料条件。#41/#42 的原边保持，#44 仍经 #43 汇合 #38。

#50/#51/#52/#56 共用 CLIENT-02A 的配置合同，仍交付原完整目录、表单、加载反馈和预览旅程；新增最小设置入口不取消它们的工作。#57 收齐 MCP、分类/生图、交接恢复三个分支末端；完整账号设置通过这些分支的共同前置收齐。合并仅减少重复的直接依赖，不能遗漏 OAuth、分类、生图或异常恢复中的任何验收段。

## 4. Pi 候选与 Q6 的两条有效路径

默认先完成 PI130-01→PI130-02（含原 GP130-02/03 两个验收段），再进入共享能力；这是建议执行顺序。共享客户端票的真实基础前置是已完成的 #75/#63 及各自新增能力，不把 Pi 升级写成所有独立工作的永久硬前置。开工仍冻结具体运行组合、已有证据和受影响补证范围。

初稿核对时，规划目标 1.3.0 与当时的[官方 npm latest](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest)一致；本次发布合并后的工单，实际实施前重新核对并冻结来源。默认最终候选选择新版时，增加三条精确运行前置：#26←PI130-02、#28←PI130-01、#57←PI130-02，#59 经 #58/#57 继承同候选要求。

若新版兼容受阻并按 Q6 保留最近已验收组合，先记录具体旧候选、版本差距、有效能力证据及受影响回归；只有这一选择成立，才移除上述三条新增 Pi 边，原材料和共享能力前置全部保留。新版票继续保留实际 FAIL/NOT_RUN/BLOCKED，不通过关闭或改成 PASS 来放行。此候选选择和边调整在当时独立回读，失败本身不是删边依据。

远程完整图已回读为 **66 张票、88 条边**；Q6 明确保留旧候选时的条件图为 **85 条边**，本次未应用该条件切换。两图均已检查引用存在且无环。当前原生前置满足的新增项为 [PI130-01 / #76](https://github.com/Ricardo121380/only-my-pi/issues/76)、[CLIENT-01A / #78](https://github.com/Ricardo121380/only-my-pi/issues/78)、[MATERIAL-01 / #84](https://github.com/Ricardo121380/only-my-pi/issues/84)；#39/#40 的阶段依赖也已解除，可按自身接口和验收条件推进。#21 虽无未关闭 Issue 前置，仍受外部材料条件阻断；#19 是父规格，不列为实施 frontier。

## 5. 覆盖与后续阶段

| 原工作组 / 范围 | 本次承接 |
| --- | --- |
| PI130-01–03 / GP130 | PI130-01 与 PI130-02 两票；后一票同时承接 GP130-02/03 |
| CLIENT-01 / GCLIENT-01 | CLIENT-01A 交付 API Key/OAuth 账号设置；CLIENT-01C 交付 MCP 独立认证 |
| CLIENT-02 / GCLIENT-02/06 | CLIENT-02A 交付共同设置，CLIENT-02B 交付分类/生图；与 #50–#52/#56 汇合完整资源能力，MCP/codemode 由 CLIENT-01C 补齐 |
| CLIENT-03 / GCLIENT-03 | CLIENT-03A 同票验收发现、只读查看和执行准入 |
| CLIENT-04 / GCLIENT-04 | CLIENT-04A 同票验收正常交接、多进程竞争和异常恢复，全部必须通过 |
| US-139 / GCLIENT-05 | 原 #29–#38 每个格式/快照/预算切片补实际 CLI，#38 汇合材料交接及安装态 |
| US-141/143 / GCLIENT-07 | 各票共同平台边界及 #57–#61 同候选整体验收 |
| US-142 / MATERIAL-01 | 实测比较和具体路线选择交接；替代实现票在路线确定后细化 |
| US-129/143 桌面 | 既定 3A–3D 阶段和验收保持；#61 完整通过后按实际候选细化当阶段票，不提前开始 Electron |
| US-141 Linux 新能力 | 对应 macOS 合同完成后独立适配和验收；现有 Linux CLI 兼容持续维护，不阻断 macOS 首版 |

桌面与 Linux 后续范围继续保留在蓝图和规格，本次没有将尚未冻结的远期实现伪装成可立即执行的任务，也没有删去这些交付。按已确认的逐批细化方式推进。

## 6. 审阅与发布结果

用户先要求合并可合并的工单，再明确确认“按9张发布吧”。本次按获批第 2 版发布 9 张新票、修订 25 张旧票正文，并同步原生依赖；没有重新修改产品方向或父规格 #19。

发布前完整刷新 57 张工单的正文、22 条评论和 73 条原生前置，查重及漂移检查通过。新票按依赖顺序创建，实际取得编号后渲染正文引用；先补 #43 的材料前置，再解除 #39/#40 的整批依赖。共新增 17 条原生依赖、移除获批的 2 条依赖。

发布后通过独立 GET 核对全部 66 张工单的正文、标签、状态、评论和完整前置，正文与渲染稿一致，图无环。父规格 #19 的完整返回值不变；原 57 张的标题、状态、标签、负责人、里程碑和评论保持。产品实现、运行验收和安装切换未执行。

## 7. 合并复核

原 14 张新票逐条映射到 9 张，验收项及需求/Gate 均保留；公共证据条件只去除重复文字。旧 25 张票保持原编号、验收和历史，其正文及依赖只把被合并的本地引用映射到承接票。#57 移除新增的重复账号直接边，但账号仍由三个末端的共同前置严格阻断。完整默认图和 Q6 条件图分别核对，当前已发布并完成远程回读，产品运行验证未执行。

## 8. 发布回执与实施入口

完成时间：2026-10-18 11:20:05 +08:00。机器回执见[发布核验记录](2026-10-18-client-ticket-publication.json)，获批正文与编号映射见[完整提案](2026-10-18-client-ticket-proposal.json)。

| 核对项 | 实际结果 |
| --- | --- |
| 新票 | #76–#84，共 9 张；全部 OPEN / ready-for-agent |
| 旧票正文 | 25 张逐字节回读一致，原验收条件保留 |
| 原生依赖 | 73 + 17 − 2 = 88 条；66 节点，无环 |
| 工单状态 | 50 OPEN / 16 CLOSED；未关闭或重开任何票 |
| 原评论与元数据 | 22 条评论及原标题、状态、标签、负责人、里程碑保留；父 #19 完整回读不变 |
| 保护范围 | #21 阻断、#23 材料前置、16 张已关闭票、Q6 的条件限制保持 |

后续首个实施入口为 [PI130-01 / #76](https://github.com/Ricardo121380/only-my-pi/issues/76)；默认完成后进入 [PI130-02 / #77](https://github.com/Ricardo121380/only-my-pi/issues/77)。新票 [CLIENT-01A / #78](https://github.com/Ricardo121380/only-my-pi/issues/78)、[MATERIAL-01 / #84](https://github.com/Ricardo121380/only-my-pi/issues/84) 及旧 #39/#40 的原生前置也已满足，具体执行仍冻结实际候选、接口及操作条件。材料外部阻断继续单列，发布工单不构成任何产品 Gate PASS。
