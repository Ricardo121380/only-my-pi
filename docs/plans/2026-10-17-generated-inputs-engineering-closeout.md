# G2-00-02 / #22：工程收尾与独立回读

日期：2026-10-17。**[#22](https://github.com/Ricardo121380/only-my-pi/issues/22) 已于北京时间 13:15:17（05:15:17Z）关闭，状态 CLOSED / completed，现行 10 条完成条件全部勾选。** [完成评论](https://github.com/Ricardo121380/only-my-pi/issues/22#issuecomment-6230047786)、正文、关闭状态和 #23 原生依赖均已独立 GET 回读。本次仅完成 #22 工程收尾；#21 继续 OPEN/PARTIAL、candidate admission BLOCKED，#23 继续 OPEN/BLOCKED、新 kit NOT_CREATED。

## 基线与证据复用

入口 HEAD 为 `fc7fdbd01cd414c9c3b49caba0b44b87a2764e0b`，分支 `codex/webui-phase1`，与 10 月 16 日最终回执一致。入口 1,745 个 tracked/untracked 文件的字节、大小、权限或链接目标及空暂存区已冻结。工作区既有 tracked/untracked 修改全部保留。

原[材料候选验收报告](2026-10-16-generated-inputs-candidate-acceptance.md)及历史最终回执 `final-closeout.json` 保留原字节，包括当时“#22 仍 OPEN”的结论；本报告追加本次工程收尾。原实现提交为 `2629b888087422ad4c99bdd46125e66d6f1caa5d`，报告澄清提交为 `fc7fdbd01cd414c9c3b49caba0b44b87a2764e0b`。代码及原始完整材料尚未推送或上传，GitHub 仅同步本次授权的必要验收摘要。

本次证据根 E 为 `LOCAL_WORKSPACE/artifacts/issue22-engineering-closeout-20261017T050927Z`；10 月 16 日证据根 P 为 `LOCAL_WORKSPACE/artifacts/issue22-generated-candidate-20261016T091610Z`。E 保存入口快照、原本地文件备份、远程正文/评论/分页依赖、实际请求、写入时间及独立回读，没有覆写 P。

| 身份 | 本次核对 |
| --- | --- |
| 5 个执行相关文件 | 合同、CLI、MJS/Python 驱动及测试与最终 v3 回执、冻结审查提交 `9b0197058be81dd80ae778e9b1c875090754ecf5`、实现提交和当前工作树相同；执行位一致 |
| 最终合同 SHA-256 | `34afaa62acbdc214fc4a9863e9094d7c632a621902ff3c8e9bec95fb77a419b0` |
| 固定输入 manifest SHA-256 | `fe5c9a74a5142b0b22a29d565143cce8bb7c5977d14eda5168c402c1e8ddf440`；10,353 个覆盖成员、477,874,858 字节，包含 manifest 自身的根为 10,354 文件 |
| 完整候选输出 SHA-256 | `0053b59a01e9bfc25f635954c0bcf9ff1f6d7e4075f7e90010ff0031d9cfd8ea`；两侧均 10,359 文件、482,360,128 字节 |
| 完整输出/固定输入复核 | 只读重新散列两棵完整输出及全部固定输入成员；各自与完整回执/manifest 比对，无缺失、额外或漂移，完整执行位一致 |
| 原报告 SHA-256 | `4c74a0a8c9573ede220592009cee80171d90f8156701de79c6941f5d7dd4071d`，与入口 HEAD 相同 |

两名探子分别只读核验身份与定位本地状态入口，主代理抽核承重身份、原文及最终日志并负责本次最终验证。冻结审查后的报告补记与澄清有明确提交；不声称六文件全文与审查快照相同。历史 `freeze-v2.json` 的中间合同摘要不作为最终 v3 身份，最终合同由 v3 双回执、冻结审查、实现提交及当前字节共同绑定。详见 `E/evidence-reuse-verification.json`。

## #22 的 10 条完成条件

下列顺序对应本次回读的 GitHub 正文；证据按身份与原证明范围复用，没有重新生成候选或重跑行为回归。

| AC | 结论 | 已核对的完成依据与边界 |
| --- | --- | --- |
| 1．八项生成输入 | PASS | ChangeLog、libffi PDF、Expat 配置有实际新生成；固定 Git 2,082 提交/显式调用、TeX/font/recorder、平台编译探测/config.status 分别绑定；五模板按字节与适用范围复用原证据 |
| 2．三个静态对应 | PASS | spec/stdint/stamp-vti 保留；不冒充历史运行、日期或编译探测，libexif 文档域由 #20 独立覆盖 |
| 3．111 宏/脚本 | PASS | 十家族逐项声明/版本/来源，63 固定成员、45 生成器/包输入、3 明确基线补丁；12 完整归档/200 工具成员审计、HTTPS 供应、包 patchset 与 GNU config 快照保留 |
| 4．当前条件/后续义务 | PASS（本地私有操作） | 当前必要条件为 SATISFIED_LOCAL_PRIVATE_OPERATIONS；各许可/例外范围、原文、用途、前提和证据分开，后续 #23/#25/#27/#28 不预授予 PASS |
| 5．历史未知/新身份 | PASS | 确定新链及输出另冻；历史 invocation、供应/补丁作者等 UNVERIFIED 保留，没有补造历史 |
| 6．完整 supplement/拒绝 | PASS | 完整清单、字节与执行位、实际离线生成、40/40 公开入口拒绝及零新输出；当前必要材料条件均有证据 |
| 7．旧材料/失败保护 | PASS | 原 1,002 文件 supplement、五源树 3,122 文件及 kit 元数据有保护回执；Windows/gettext/xmlwf 不重判缺失，完整原文、旧候选及失败保留 |
| 8．双目录完整一致 | PASS | Node 22.19.0/24.19.0 各自实际生成，完整候选集合/字节/大小/执行位一致，本次再核验无漂移；没有复制第一次结果或删除字段 |
| 9．差异/阶段兼容 | PASS（材料范围） | ChangeLog 同旧字节；PDF 19 页 layout text/结构兼容，4/19 页像素相同及字体/Producer/格式差异保留；Expat 三宏差异与真实头部结构编译留证；正式 app/Pi/资源仍归 #25 |
| 10．公开入口/双 Node/两轴 | PASS | 既有 CLI 的显式 --candidate、双 Node、实际禁网/拒写、缺输入/漂移/overlay/用途/别名拒绝；Standards/Spec 分列且均 0 findings |

## 沿用的实际验证与本次验证范围

| 2026-10-16 已完成证据 | 复用结果及限制 |
| --- | --- |
| 公开材料入口与相关检查 | 双 Node 各 11/11 PASS；final v3 各 exit 0 / PASS_MATERIAL_CANDIDATE |
| 负例 | 20 类 × 双 Node，共 40/40；每次实际公开入口拒绝且零新输出 |
| 同策略实际网络探测 | 每 Node 策略外正控制接收 1 次，策略内 0 次、exit 77 / EPERM；独立接收端有记录 |
| 实际写保护 | 固定输入、旧 origins、原 kit、checkout 四处均拒写，未留下 sentinel |
| 类型/lint/WebUI | 四组类型及 lint PASS，WebUI 17 文件、108/108 PASS；不是浏览器或新材料 Pi 验收 |
| 适用 Node 回归 | exit 0，1790 PASS / 0 FAIL / 0 CANCELLED / 8 SKIP；明确排除 10 条 #21 GIR 用例，不能称无排除的全量通过 |
| 独立两轴 | Standards PASS / 0 findings；Spec PASS / 0 findings，仅限 #22 材料切片；审查时回归仍运行的原字段保留，以已自然结束的最终日志及回执另证退出结果 |

本次新执行的是只读身份/完整文件复核、远端回读及收尾文档静态检查。没有重跑上述生成、禁网/负例或行为回归。既有 Pi/Host/本地受控服务回归没有注入本轮新 native/parser 材料，不能作为其应用/Pi/浏览器运行证据。当前整体 licensing 仍 INCOMPLETE，历史未知不改写。

## GitHub 写入与独立回读

写入前再次 GET 核对 #22 正文、OPEN 状态、原评论和元数据，#21/23 正文/评论及原生依赖与入口一致。仅执行三项获准写入：#22 body-only PATCH、追加一条完成评论、#22 state-only PATCH（closed / completed）；没有修改其他工单、标签、负责人或依赖。

- #22：10 条完成条件勾选，原规格只改变勾选标记，追加日期明确的本次结果；2026-10-02 历史 PARTIAL 段落与原评论完整保留。完成评论 id `6230047786`，正文 SHA-256 `6447701e2a1964e7b9f7d251203ba4c1b5c22e138789c8390cf1e3f39b523d61`。独立 GET 验证 body、全部评论、CLOSED / completed、关闭时间及原标题/标签/负责人等元数据；本票 blocked_by=0，blocking 仍指向 #23。
- #21：OPEN/PARTIAL、candidate admission BLOCKED；正文、原评论、元数据及 updated_at 与入口一致。沿用“没有，保留阻断并交付已核实材料”的既定交付决定，未重跑、未重试、未放行。
- #23：OPEN/BLOCKED、新 kit NOT_CREATED；正文及评论不改写，三条原生依赖的 Issue id 与次序均保留：#20 closed、#21 open、#22 closed。active blocked_by 从 2 变 1，total_blocked_by 仍为 3；唯一未完成前置是 #21。#23 仍 blocking #24，没有推进后续工单。

首次完整嵌套快照比较在 #23 blocking 响应发现差异并停止；逐字段诊断确认只有仓库级 open_issues/open_issues_count 随 #22 关闭从 42 变 41，嵌套 #24 的其他完整字段及依赖身份未变。保留该校验失败、请求日志与诊断；随后仅重新 GET，以这两个明确的预期计数变化核对完整响应，没有删除未知字段或追加远端写入。最终回读 PASS 见 `E/github-readback-verification.json`，原诊断为 `E/dependency-nested-snapshot-diff.json`。

## 本地同步及范围终点

[Task 看板](2026-09-26-webui-optimization-tasks.md)、[工单映射](2026-10-01-engineering-ticket-map.md)及[适配映射](2026-10-10-pi-1.1.0-ticket-review.md)追加日期明确的最新记录；[当前机器快照](2026-10-17-material-closeout-status.json)独立保存本轮状态；原[机器映射](2026-10-01-engineering-ticket-plan.json)新增当前文件/记录指针及 `materialCloseout20261017`，原各日期流程/发布/实施对象与全部旧字段原样保留。旧机器映射在入口就是未跟踪文件，本次维持其未跟踪状态，不把其既有历史内容纳入本轮提交。旧的 OPEN/PARTIAL、发布前沿及推荐项继续代表其观察时点，当前材料状态由新增记录与远端回读共同说明。

本次在 #22 收束。G2-00-02/F02/F03 仍 PARTIAL，Full NOT_RUN、U2 BLOCKED、产品历史 20/44 保持；没有创建 #23 kit、推进后续构建/Full、切换日常安装、调用真实 Provider、推送或发行。当前材料条件通过不替代完整许可或后续事件的实际履行。

本次最终静态验证：Node 24.19.0 文档链接检查 **2/2 PASS**；两份机器记录 JSON 可解析，#22/#21/#23 状态与独立远端回读一致。原三份 Markdown 仅新增文本，旧机器映射所有既有字段及原字段字节保留。入口 1,745 项中，本轮更新 4 个既有状态文件，其余 **1,741/1,741** 字节、大小、权限或链接目标不变；10 月 16 日原报告及 17 份复用回执原字节未变。暂存区在本轮暂存前为空。最终 diff/提交归属、暂存区与 dirty 状态另由 `E/final-closeout.json` 留证；仅本轮五份文档/当前快照进入提交，原未跟踪机器映射维持未跟踪。
