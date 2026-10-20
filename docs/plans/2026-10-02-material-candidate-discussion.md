# G2-00-02 新材料候选：定向讨论与实施状态

日期：2026-10-02。范围：总规格 #19 下的 #20–#23；产品任务仍为 20/44。本记录接续首轮工程规格，不重置原 Task、历史验收或原始材料。

## 当前事实

本次核对分支 `codex/webui-phase1`，HEAD `0f258c90e90311a2e539fd3a276ad26c32749216`。三项材料实现与一次前置检查均已提交到本地；本轮没有重新运行材料生成、测试、native 构建或 Full。

| 工单 | 本地提交 | 已交付范围 | 当前完成状态与缺口 |
| --- | --- | --- | --- |
| [#20](https://github.com/Ricardo121380/only-my-pi/issues/20) | `c9b756ea6a0e065e9723fbdfa0905db3fecfefe8` | 固定 CSS 全字节对应、完整生成材料账本、347 文件 supplement 与校验 CLI | PARTIAL：五图输入/实际生成、其余生成对应及适用条件未闭合 |
| [#21](https://github.com/Ricardo121380/only-my-pi/issues/21) | `9e0497cfd64d470cfa51d0282e04743f72067b84` | 53 个固定文件/40 GIR 的供应加工账本、部分引文对应、131 文件 supplement 与 CLI | PARTIAL：原供应输入、实际加工重放、完整文档来源及适用条件未闭合 |
| [#22](https://github.com/Ricardo121380/only-my-pi/issues/22) | `f4cc764f280157e1586f8b9d6ac2f50600ceb4a5` | 五模板各两次离线内容复现、八输入/111 宏脚本账本、1002 文件 supplement 与 CLI | PARTIAL：其余三输出、部分工具供应和适用条件未闭合 |
| [#23](https://github.com/Ricardo121380/only-my-pi/issues/23) | `0f258c90e90311a2e539fd3a276ad26c32749216` | 前置核验与阻断记录 | BLOCKED：#20–#22 未闭合；新 kit NOT_CREATED |

证据：[libexif 验收](2026-10-02-libexif-generation-acceptance.md)、[GIR 验收](2026-10-02-gir-materials-acceptance.md)、[生成输入验收](2026-10-02-webui-g2-00-generated-inputs.md)、[新 kit 前置检查](2026-10-02-native-kit-prerequisite-preflight.md)。这些报告及其原运行回执继续作为各次历史证据；本轮状态同步不产生新的运行 PASS。

此前用户答复“这些材料好像都没有”，目前没有可提供的历史材料路径；这不证明全机材料不存在。三份现有 CLI 主要校验固定输入、清单和来源账本，不能仅修改状态声明就得到真实生成证明。

## 决策树与已确认内容

本轮问题单独编号为 R1–R4，对应本轮卡片 Q1–Q4，避免与初版规格 Q1–Q5 混淆。

| 决策 | 内容 | 状态 |
| --- | --- | --- |
| R1 / Q1：缺失材料路线 | 优先保持现有组件版本；为缺失部分冻结来源、工具、配置并实际生成新候选；允许新输出与旧输出不同，保留旧候选、未核历史及差异；如需更换组件版本，单独评估影响 | CONFIRMED：用户选择“采用新候选路线（推荐）：补齐可验证的生成链，按新身份验收” |
| R2 / Q2：材料关闭与后续 Gate | 当前来源/生成/声明及当前复制生成条件由材料工单验收；完整 kit、实际构建、最终包/分发、Full 各由相应 Gate 留证；逐条保留后续义务 | CONFIRMED：用户选择“按阶段明确关闭条件（推荐）：保留全部义务和最终放行门禁” |
| R3 / Q3：生成与兼容测试 | 固定环境两次独立生成、全输出字节一致；旧新差异及兼容性核验；现有双 Node CLI、实际禁网和负例；分列后续 native/发行/Full | CONFIRMED：用户选择“采用完整生成与复验标准（推荐）” |
| R4 / Q4：成稿共识及原拆分 | 五份具体正文准确表达 R1–R3，保留原四张粒度与 #20/#21/#22 → #23 依赖，更新现有总规格与工单 | CONFIRMED：用户对等待 Q4 的成稿说明批注“确认” |

R2 的动因是修订前 #22 的待办包含新 kit/最终分发履行，而 #23 又以 #22 完成为前置。这里记录的是文档关闭条件的循环等待风险，不是已证实的代码死锁，也不表示任何许可条件已获得豁免。

## 已发布的修订范围

R1–R4 均已确认。总规格 #19 的 G2 材料条款和测试设计已通过 to-spec 增量更新，现有四张工单已按 to-tickets 的获批切片同步；五份远程正文与获批稿及本地副本逐字节一致。保持 #20/#21/#22 → #23 的拆分与依赖；U2–U6 功能、原 Gate、已验收产品 Task 与 G2 六步骤保留。

具体获取来源、工具身份、命令及环境在对应实施包固定；当前讨论与状态同步不证明已取得输入、执行生成器或创建新 kit。安装、native 应用构建、Full、付费 Provider、日常晋升及公开软件发行继续沿各阶段的具体授权。

当前 G2-00-02 PARTIAL，F02/F03 PARTIAL，完整材料/许可 INCOMPLETE，Full NOT_RUN，U2 BLOCKED。三个材料工单和 #23 均保持 OPEN；原失败与未核历史不重写为成功。

## 状态同步结果

已向 #20–#23 各发布一条既有实施事实评论并回读一致；原正文、标题、状态、标签与负责人未变，#23 原生前置仍为三个 OPEN 工单。评论仅含必要摘要与本地提交身份，未上传源材料或伪造远程文件链接。

- [#20 PARTIAL 进展](https://github.com/Ricardo121380/only-my-pi/issues/20#issuecomment-5950147139)
- [#21 PARTIAL 进展](https://github.com/Ricardo121380/only-my-pi/issues/21#issuecomment-5950149107)
- [#22 PARTIAL 进展](https://github.com/Ricardo121380/only-my-pi/issues/22#issuecomment-5950151002)
- [#23 BLOCKED 前置](https://github.com/Ricardo121380/only-my-pi/issues/23#issuecomment-5950152913)

## R4 / Q4：具体成稿共识核对

用户已通过批注“确认”完成 R4/Q4。获批的共识核对稿（本机历史证据：`../../../artifacts/webui-optimization/G2-material-route-1002-xw6todvm/review/README.md`）及五份正文保留审阅时原字节；其中等待确认的措辞是当时快照，当前结果以本节及发布回执为准。五份正文已同步到既有 #19–#23 和本地副本，原标题、OPEN 状态、ready-for-agent 标签、负责人和评论保持，#23 的三个原生 blocked-by 仍为 #20/#21/#22。

## 发布回读与下一实施入口

- [总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)及 #20–#23 正文回读：5/5 MATCH；与获批稿及本地副本一致。
- #23 原生依赖回读：3/3 保持，前置仍 OPEN。没有创建重复工单、关闭条目或改变负责人。
- 后续从 #20 的剩余生成缺口继续：冻结有效 Doxyfile、实际图输入、工具与输出，在独立目录生成新文档材料候选，完成两次生成、差异/兼容和离线正负例；复用字节与范围仍匹配的既有证明。
- 本轮完成的是规格/工单修订与静态核验，新候选生成、native 应用构建、Full、真实 Provider 和日常晋升仍 NOT_RUN。状态与证据回执见发布记录（本机历史证据：`../../../artifacts/webui-optimization/G2-material-route-1002-xw6todvm/publication/results.json`）。
