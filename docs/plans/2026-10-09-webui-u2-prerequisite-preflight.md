# U2：材料输入批次入口核验

日期：2026-10-09。**U2 BLOCKED；本轮产品实现未开始，U2 的 C/P/B/I 功能验收 NOT_RUN。** 本次交付任务定位、当前依赖与接入现状核验、检查记录及恢复条件，不将入口核验记为 U2 完成。

目标为 [总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)的 U2 文件、图片与文档输入批次，原 Task U2-01–U2-06，对应 US-017–US-033、G2-01–G2-06。实际工单为 [#29 / U2-N01](https://github.com/Ricardo121380/only-my-pi/issues/29)至 [#38 / U2-N10](https://github.com/Ricardo121380/only-my-pi/issues/38)，映射沿用[已发布工单记录](2026-10-09-remaining-ticket-review.md)及其机器映射，十张工单不改变六个产品 Task 的计数。共同约束和阶段出口沿用[总规格本地副本](2026-10-01-webui-remaining-spec.md)、[Task 看板](2026-09-26-webui-optimization-tasks.md)、[验收矩阵](2026-09-26-webui-optimization-acceptance.md)及 [ADR-0018](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。

## 当前入口约束

[用户已确认的解析门禁调整](2026-09-29-webui-parser-gate-adjustment.md)要求：完整发行材料与 Full 移至 G2-00，未通过不开始 U2 产品集成或交付。当前 #29 的执行条件明确为“G2-00 已 PASS”，其直接前置为 [#28 / G2-N05](https://github.com/Ricardo121380/only-my-pi/issues/28)。#28 须核对当前候选 F01–F06，并在精确干净源码、隔离前缀和真实禁网策略下完成 Full 及包内资源矩阵；历史 U0 技术探针、U1 C/P/B 或材料 supplement 不代替该出口。

本轮请求实施 U2，按其现行规格核对入口。入口尚未满足，因此保留选定任务身份与阻断；没有将 U2 替换为 G2 材料实施，也没有改动准入规则来放行附件。现行规格已经确认缺失历史材料采用新可复现候选的路线，剩余障碍是具体材料交付和验收条件，不是等待再次批准该路线。

## 当前 GitHub 状态与原生依赖

北京时间 2026-10-09 22:47:21–22:47:26，回读 #19–#38 的正文、状态、评论数和 #23–#38 的原生 blocked-by；17 个读取命令均 exit 0。#19–#38 全部 OPEN。#24–#38 评论数为零；22:55 的补充读取覆盖 #20–#23 四条既有评论，四个命令均 exit 0，评论仍记 PARTIAL/BLOCKED，没有新的验收放行。现行远程 #19 与本地总规格字节一致，SHA-256 均为 `e87eb4718089ef7f8142fdfc5610b672d2ccc3b57c8e31bddec10274bc05905c`。

依赖方向为“前置 → 后继”；下列 AND 表示全部前置满足，不能任选其一：

```text
(#20 AND #21 AND #22) → #23 → #24 → #25 → #26 → #27 → #28 → #29 → #30
#30 → #31、#32、#33
#33 → #34、#35、#36
(#31 AND #32 AND #34 AND #35 AND #36) → #37 → #38
```

| 前置 | 当前状态与仍须交付的出口 |
| --- | --- |
| #20 / libexif | OPEN；规格和既有状态记录为 PARTIAL。实际新 CSS、五图及其余生成物、完整输入/工具/配置、双次生成、兼容及当前操作条件待闭合 |
| #21 / GIR | OPEN / PARTIAL。实际固定供应或源码及未加工输入、加工链重放、完整手册引文及当前条件待闭合 |
| #22 / 其他生成输入 | OPEN / PARTIAL。libffi ChangeLog、PDF、Expat 平台配置的实际输入与生成，可信工具/补丁/快照及当前条件待闭合 |
| #23 / 新完整 native kit | OPEN / BLOCKED；现行记录 newKit=NOT_CREATED。前三项满足关闭条件后，完整集合、字节/摘要/执行位、条件账本与真实离线正负例待验 |
| #24 / PDF 材料 | OPEN；依赖 #23。当前 PDF 材料出口仍阻断，最新本地前置报告的新候选为 NOT_CREATED |
| #25 / native 构建 | OPEN；依赖 #24。最新本地前置报告仍 BLOCKED，正式配置/编译/链接及新二进制候选未完成 |
| #26 / parser 资源候选 | OPEN；依赖 #25。新图片/PDF/资源身份和完整运行矩阵待验 |
| #27 / 默认发行 | OPEN；依赖 #26。默认接线、最终包、ledger、双 SBOM、notices 与分发条件待验 |
| #28 / G2-00 | OPEN；依赖 #27。当前候选隔离 Full、真实禁网及 F01–F06 整体出口未交付，不能放行 U2 |

以上材料状态来自本次回读的现行规格、正文/评论，以及已读取的[最新 #25 前置报告](2026-10-09-g2-n02-prerequisite-preflight.md)，不表示本轮重新执行了材料生成、whole-kit rehash 或 Full。结论限定所核对出口未满足，不推定整台机器没有任何可用材料。

| U2 工单 | 原 Task | 原生直接前置 | 本轮实施状态 |
| --- | --- | --- | --- |
| #29 / U2-N01 文本上传、冻结和真实 Pi | U2-01 | #28 | BLOCKED：G2-00 未 PASS |
| #30 / U2-N02 批量配额和恢复 | U2-01 | #29 | BLOCKED：依赖未满足 |
| #31 / U2-N03 项目文件和代码选区 | U2-02 | #30 | BLOCKED：依赖未满足 |
| #32 / U2-N04 图片粘贴/拖入 | U2-03 | #30 | BLOCKED：依赖未满足 |
| #33 / U2-N05 PDF 选页 | U2-04 | #30 | BLOCKED：依赖未满足 |
| #34 / U2-N06 DOCX 段落/表格 | U2-04 | #33 | BLOCKED：依赖未满足 |
| #35 / U2-N07 XLSX 表/单元格 | U2-04 | #33 | BLOCKED：依赖未满足 |
| #36 / U2-N08 PPTX 幻灯片 | U2-04 | #33 | BLOCKED：依赖未满足 |
| #37 / U2-N09 快照查看和安全清理 | U2-05 | #31、#32、#34、#35、#36 全部 | BLOCKED：依赖未满足 |
| #38 / U2-N10 混合材料整合验收 | U2-06 | #37 | BLOCKED：依赖未满足 |

十张 U2 工单都通过原生依赖链受 #28 约束，没有可独立绕过该入口的 U2 票。ready-for-agent 表示需求和测试边界明确，不能解除前置。状态快照、正文和机器映射的编号/直接依赖一致。

## 当前接入现状

对指定 Host 输入模块及 Composer/草稿模块做限定静态检索，主代理按出处抽核；不声称全仓穷尽或已经取得 U2 运行证据。

| 实际源码接点 | 本次核对结果 |
| --- | --- |
| [输入合同](../../packages/host/input-contracts.mjs)，21、33 行 | `materialSnapshotIds` 已有数组字段，但额外字段被拒绝；类型声明本身不表示材料已可发送 |
| [Host 准入](../../packages/host/input-controller.mjs)，93–98、259 行 | `#binding` 对非空材料快照抛出 `INPUT_MATERIALS_UNAVAILABLE`；`saveDraft` 直接走 store，不能把“可保存 ID”说成“可执行材料” |
| [Pi 输入桥](../../packages/host/pi-input-bridge.mjs)，33–48 行 | `deliver` 拒绝非空材料快照；当前 `sendCustomMessage` 的内容为 `record.text`，该投递入口未提供实际图片块 |
| [草稿与恢复](../../webui/src/useInputDraft.ts)，21–25、42、52、58 行 | 新内容固定空材料数组；远端保存内容可复制 ID，但恢复中的 prompt/补充请求要求材料数组为空，非法恢复保留 `raw` 供处理；不是材料刷新恢复闭环 |
| [Composer](../../webui/src/Composer.tsx)，43 行 | 添加附件/引用按钮 `disabled`，标签明确“尚未接入”；本次未进行浏览器点击验收 |

当前所见接点符合“U2 尚未接入”的记录。解除 G2-00 后，首片 #29 必须从公开上传、原子材料发布、卡片/草稿恢复、不可变实际字节到真实 Pi 请求与消费回执贯通；只启用按钮、传文件名或移除拒绝判断不满足工单。测试边界已在总规格确认，实施时沿公开 Host/真实 Pi、Ego Lite 和当前候选安装入口取证。

## 源码与证据保护

源码根为 `LOCAL_WORKSPACE/repo`，分支 `codex/webui-phase1`，起点及本次评审基点为 `e4457be1950fe7197ce5a712d100fe2488ea563d`。开始时 index 为空；`git status --porcelain=v1 -z` 有 224 个既有条目，其中未跟踪目录按 Git 默认折叠。保护清单覆盖 1,566 个 tracked/非忽略 untracked 文件的类型、字节摘要、执行位和链接目标；不是 Full 所需的 clean source commit。

本次仓库外证据为 `LOCAL_WORKSPACE/artifacts/webui-optimization/U2-entry-20261009-htmqoatf`。`baseline.json` 和 `baseline-status.z` 保存起点；`issues-selected.json`、`dependencies-summary.json` 及每条命令的 stdout/stderr/时间/退出码保存远程状态；`spec-identities.json` 保存规格身份。`runtime.json` 重新确认现有 Node 22.19.0/24.19.0 路径和实际版本，运行检查没有修改全局 Node 或日常栈。

只新增本报告，既有工作树文件、材料、合同、历史失败及 Task 状态保持。最终保护核验与提交范围单独留证；本报告提交不会使既有未提交产品代码或材料成为干净构建来源。

## 本轮验证与双轴评审

本轮没有产品行为修改或新测试，TDD 实现循环未开始。按 implement 请求运行既有检查；Host HTTP 检查观察配对、版本/Origin、纯文本草稿投递与账本，以及公开能力 `materials: false`，不是 U2 材料正向验收。

| 检查 | 本轮结果 |
| --- | --- |
| 任务映射、现行规格与原生依赖回读 | PASS，限定本次快照；#19 与本地副本字节相同，依赖读取无错误 |
| Node 22.19.0 / 24.19.0，`tests/host-input-http.test.mjs` | 各 2/2 PASS、exit 0；既有 C 输入合同回归，不是 U2 C/P/B/I 通过 |
| `npm run typecheck` | PASS，Node 24.19.0；根/safety/Host/WebUI 四份配置、exit 0 |
| 新增报告前 `tests/docs-links.test.mjs` | FAIL、exit 1；一条任务映射链接和两条材料讨论链接越过源码仓库，已在修改前复现 |
| 本报告内容/引用/格式、diff 与源码保护 | PASS：12 个仓库内引用存在，无尾随空白/冲突标记，`git diff --check` exit 0；1,566 原文件类型/字节/执行位/链接目标及 224 既有状态条目保持；提交前后再核对 |
| Node 全量默认入口，一次 | FAIL，Node 24.19.0、`npm test`，1,555 PASS / 1 FAIL / 5 SKIP，共 1,561、exit 1；唯一失败为修改前已复现的相同三个文档链接 |
| WebUI 全量，一次 | PASS，Node 24.19.0、`npm run test:web`，11 文件、92/92、exit 0；这是组件结果，Ego Lite 页面验收 NOT_RUN |
| Standards / Spec 两轴 | Standards PASS：硬规范违例 0、smell 0；Spec BLOCKED：原六个产品 Task 均未实现，缺失 6、范围外 0、错误实现 0；报告事实错误/阻断遗漏 0 |

既有文档链接失败保留，不修无关文档或放宽门禁来消除失败。新材料生成、构建/资源候选、真实禁网、Full、U2 真实 Pi/页面/安装态、真实外部 Provider、日常晋升和软件发行均 NOT_RUN。本轮未远程评论/关闭工单、推送或发布。

两位单轮只读探子分别评审两个轴，范围仅为本报告。基点固定为本轮起点 `e4457be1950fe7197ce5a712d100fe2488ea563d`，评审时本轮尚无提交；差异命令为 `git diff --cached e4457be1950fe7197ce5a712d100fe2488ea563d -- docs/plans/2026-10-09-webui-u2-prerequisite-preflight.md`。冻结差异保存为证据目录中的 `review.diff`，SHA-256 为 `a9e2bf208205284b32bec7c4f358da5154642876e08ffe3eda02a896ed101232`；两轴分别确认与当时 staged diff 字节一致。其他既有改动不在评审范围。评审后只回填结果与本段记录，最终 diff 身份和保护检查另存，不将冻结差异摘要冒充最终提交身份。

### Standards

PASS。文档规范硬违例 0；Fowler smell 启发性发现 0。报告按 `AGENTS.md:24` 分列运行/页面/安装/外部模型证据，明确保留 U2 BLOCKED 和功能验收 NOT_RUN；按 `docs/agents/issue-tracker.md:13–15、47` 保留原 Task、工单映射、依赖及状态。12 个仓库内引用均存在，报告记录内容/格式/diff 检查及后续保护责任。差异只有 Markdown，没有新增函数、类型、继承或控制逻辑，十二项 smell baseline 未发现问题。本轴未重新运行测试或联网读取状态。

### Spec

完整 U2 判定为 BLOCKED；报告核验未发现事实错误或阻断遗漏。现行规格 `2026-10-01-webui-remaining-spec.md:275–280` 的六项产品交付均未实现：

- U2-01：独立上传/引用、原子材料身份、路径和配额。
- U2-02：@文件/代码选区/文本卡片、范围预览、变化重确认和上下文处理。
- U2-03：三种图片真实 Pi 输入、模型能力与有界解码，失败保留草稿。
- U2-04：四类现代文档有界解析、真实位置与范围、partial 和拒绝负例。
- U2-05：不可变发送快照、共享引用及安全显式清理，磁盘故障保旧数据。
- U2-06：混合材料发送/排队/刷新/重连/历史和安装态资源的一致性。

上述缺口受“未通过不开始 U2 产品集成或交付”及 #29 的“G2-00 已 PASS”约束，报告完整保留了它们；范围外行为 0、看似实现但错误 0。指定 JSON 回执和代码点验支持状态、测试、保护及接入现状。报告核验通过不能记为 U2 Spec PASS；本轴不补任何未运行的功能验收。

两轴计数分别为：Standards 硬违例 0 / smell 0；Spec 缺失 6 / 范围外 0 / 错误实现 0，最严重状态为 U2 入口 BLOCKED。

## 恢复条件

具体顺序为：#20、#21、#22 各自满足当前材料切片关闭条件 → #23 交付独立新完整 native kit → #24 PDF 材料 → #25 正式 native 构建 → #26 parser 资源候选与完整运行矩阵 → #27 默认发行及最终元数据/内容 → #28 同候选隔离 Full 和 F01–F06 全出口 → G2-00 PASS → 回到本次 U2 的 #29。#20–#22 的独立材料工作可各自推进，下一产品实施入口仍等待 #28；不以关闭 Issue 本身替代实际验收证据。

本轮新增产品验收数为 0，历史产品 Task 20/44 和 U2 0/6 保持。此报告核验并保存阻断，不关闭 #29–#38，不提前 U3–U6 或 Electron。
