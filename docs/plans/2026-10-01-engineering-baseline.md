# only-my-pi 工程基线：2026-10-01

本基线把新配置接到现有开发工作上，保留原计划、Task ID、ADR 和验收证据。既有产品看板的行动项是 **G2-00-02 材料收口**；U2 入口仍阻断。基线整理后已补做本次 grill-with-docs，Q1–Q4 确认总范围与测试边界；[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)已完成静态核对并发布，四张拆分已于 2026-10-02 经 Q5 批准并发布为 #20–#23。本文保留初始基线的历史观察，最新工程状态见[任务映射](2026-10-01-engineering-ticket-map.md)，没有重新执行产品验收。

## 1. 源码与工作树锚点

| 项目 | 本轮核对结果 |
| --- | --- |
| Git 仓库 | only-my-pi 源码目录 `repo`，父目录为材料与证据目录 |
| 分支 | `codex/webui-phase1` |
| 配置提交 | `e57410a3b3037761a246bf1471939bec0aa0c8eb` |
| 配置提交的父提交 | `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8` |
| 配置提交内容 | AGENTS.md 和 docs/agents 下的 issue-tracker、triage-labels、domain，四文件共 130 行 |
| 既有未提交内容 | 232 个文件：57 个 tracked modified、175 个 untracked |
| 既有文件保护 | 逐文件 SHA-256、字节数、类型和权限与提交前快照一致 |
| tracked diff SHA-256 | `21c2d1377b7dae4898b25592291795e4d22cfe77313b913830369fab7f0f438b` |
| 232 文件清单 SHA-256 | `f4992558cff41540055e91106ac5ec0d6aa2f813787bb4e8d144ac4b7094e404` |

完整文件清单与编码规则见[机器可读基线](2026-10-01-engineering-baseline.files.json)。源码身份由配置提交 **加这 232 个工作树文件**共同描述；配置提交自身不是产品代码验收版本。新建的本批报告和草稿不属于该 232 文件基线。

路径粗分为：文档 53、Host 13、其他 runtime 6、probes 55、release 29、tests 52、tooling/inventory 5、WebUI 19。这是便于处理的路径分组，不能用于认定作者、批次归属或验收完成情况。

共享文件如 Host server、WebUI App、包内容合同和根依赖文件跨越多批工作。后续实施应按具体 diff 和目标 Task 定界；不能把这些文件整体归给某张工单，也不能为了建立“干净基线”清掉现有内容。

## 2. 配置与远程任务状态

[项目规则](../../AGENTS.md)、[Issue tracker](../agents/issue-tracker.md)、[triage 标签](../agents/triage-labels.md)、[领域入口](../agents/domain.md)已落盘并进入配置提交。项目使用 GitHub Issues，单一 CONTEXT，ADR 继续沿用 docs/decisions。

基线建立时的只读查询 [Ricardo121380/only-my-pi](https://github.com/Ricardo121380/only-my-pi)：

- Issues 已启用，默认分支 main，all-state Issue 列表为空。
- 五个默认 triage 标签中，目前只有 wontfix 存在；needs-triage、needs-info、ready-for-agent、ready-for-human 尚未创建。
- 现有 Task 尚未迁移，Issue 编号均为空；本批草稿也尚未发布。
- 本地配置确定的是标签映射。创建远程标签、Issue、依赖，以及推送文档均是后续发布动作。

磁盘规则与当前会话规则加载是两个状态；本基线不声称配置提交使所有既有会话自动重新加载。

## 3. 当前计划和证据口径

[Task 看板](2026-09-26-webui-optimization-tasks.md)与[验收矩阵](2026-09-26-webui-optimization-acceptance.md)分别定义产品 Task 和验收 gate；两者各有 44 项，不能互相替换计数。

| 范围 | 原看板记录 | 本轮新增证据 |
| --- | --- | --- |
| S0 | 8/8 已验收 | 工作区/命令正规化源码的静态抽核 |
| U0 | 6/6 技术可行性已验收 | 本轮未重跑 PoC 或解析验收 |
| U1 | 6/6 C/P/B 已验收 | 输入持久化、CAS、队列消费和恢复入口的静态抽核 |
| 产品合计 | 20/44 | 无新增产品 Task 验收 |
| U2–U6 | 24 项待推进 | 原 ID、依赖和状态完整保留 |
| G2-00-01 | 固定重建输入技术子集已验收 | 保留原证据，不重开为未完成任务 |
| G2-00-02 | PARTIAL | 三份 closeout 存在，三个实现文件字节与相应回执绑定一致 |
| F02 / F03 | PARTIAL / PARTIAL | 默认发行链的源码核对支持继续保留未闭合门禁 |
| 完整材料/许可闭包 | INCOMPLETE | 子集文本与哈希对应不提升为总闭包通过 |
| 新 native 应用构建 / Full | NOT_RUN / NOT_RUN | 本轮未执行 |
| U2 入口 | BLOCKED | 须先 G2-00 全部必需门禁通过 |

S0/U1 静态事实包括：写入路径正规化与 Git 元数据保护、危险 Git 命令识别、原子输入存储、revision CAS、重启后的保守状态迁移、先读消费回执再标 consumed，以及恢复队列 UI 入口。抽核范围没有覆盖全部父组件接线、运行态、崩溃和多窗口并发；这些事实不是本轮 C/P/B PASS。

### 近期材料证据

下列路径相对于项目父目录，使用代码文本记录，避免把仓库外证据当作仓库文档链接。

| 回执 | 本轮核对 | 范围与局限 |
| --- | --- | --- |
| `artifacts/webui-optimization/G2-00-locale-1001-EpCrn4/closeout.json` | 存在；SHA-256 `9d4106212d97b88a4b810b3c6fd3cc9f2ee50c26555537b151ad3de955117bd0` | 保存历史双 Node 各 38 项子集；未列实现源码 SHA，不能证实完整 locale 实现绑定 |
| `artifacts/webui-optimization/G2-00-notices-1001-5JoWe2/closeout.json` | 存在；SHA-256 `1b647478a026bcd9245223e10537083e998c1eec22346e31a3882c08eb9fa5a8` | 保存 368 输入清单、111 宏/脚本、历史各 25 项；本轮只抽核一个 helper 的源码绑定 |
| `artifacts/webui-optimization/G2-00-docassets-1001-1OShlg/closeout.json` | 存在；SHA-256 `b203c7f7bb7ee0c98bc09ce17c34a57d4573b58c4763dfe5c3a26607d32f9873` | 保存 106 文件、19 源码页、9 资产、6 组件、历史各 9 项；本轮抽核两个实现文件绑定，wholeKitSourceRehash 仍 NOT_RUN |

三个被抽核文件：

- [generated notices helper](../evidence/2026-10-18-local-development-history.md#local-109ec9ea8e9f4000)：`59749cbd70e644167103efec1de2d154cf001a920c9f056fc8259cc8f27b2160`。
- [libexif helper](../evidence/2026-10-18-local-development-history.md#local-f57cf034904e70a2)：`7a6fd3f5d1623cd77dc78b38f81aaa46cfc78e8f78f7b4a7a4209db37752bf6f`。
- [libexif probe](../evidence/2026-10-18-local-development-history.md#local-a56facf825f530fa)：`1f97c9113ffdd18361cd42b4a5cbe11113397123550716a125c5c9544e047a24`。

字节匹配仅证明选中文件与回执记录相同，不证明完整历史执行环境、所有测试源码或整个材料集合相同。三份最终大报告只核实存在，没有重读、重跑或全包重哈希。

locale kit 身份为 `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622`。notice supplement 为 `sha256:d403cc43b370d6187b24c5edec8f53897a313a475de368b3777c3011101b4572`；libexif supplement 为 `sha256:34c1a90f44e896943ce2043b23a6d07041eb9afb995f91f3c51aa7259a94ed80`。后两项是报告记录的身份，本轮没有重新核整个集合；它们不能代替新 kit、stack 或 binary 身份。

### 默认发行链的关键事实

- [parser 注入 helper](../evidence/2026-10-18-local-development-history.md#local-1e2ee4d02bb62fa7)第 139–142 行明确只开放 U0_REHEARSAL；其他目的被 PARSER_RESOURCE_RELEASE_BLOCKED 拒绝。
- [defaultPrepare](../../packages/release-stack/release-payload-stager.mjs)第 257–298 行尚未调用 parser helper，acquisition roots 只有 external 和 Pi。
- [payload assembler](../../packages/release-stack/payload-assembler.mjs)第 122 行只合并 external/Pi ledger。现有双 SBOM 调用不能证明 parser 已纳入。
- [最终内容合同](../../verification/manifests/pack-content-v1.json)尚未列出注入的 parser-resources 前缀；[parser 资源合同](../evidence/2026-10-18-local-development-history.md#local-6cc62f5d9429765b)仍明列 ledger、双 SBOM、最终 allowlist 和 Full 为 NOT_RUN。

这些否定结论只覆盖已检查的默认链文件；没有扩大为“全仓没有任何接线”。隔离接线准备可先做，正式默认发行放行仍需材料、身份和元数据闭合。

## 4. 文档日期与状态冲突处理

[文档索引](../README.md)仍包含 9 月 20 日“实现与验收未开始”的计划快照；[STATUS](../STATUS.md)主要记录旧里程碑。[ADR-0017](../decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)的初始实现状态、[9 月 29 日 Full 清单](2026-09-29-webui-u0-parser-full-integration.md)开头的 14/44 也有各自日期语境。

当前状态采用新看板及其链接的逐批原证据；保留旧快照，后续若更新索引，只修当前导航与明确标注的摘要，不改写历史事实。本轮没有替换旧 STATUS 或把历史 PASS 批量迁为新的未完成 Issue。

## 5. 候选首批范围与既有后续顺序

此前拟议首批只覆盖 G2-00-02 的剩余材料：

1. libexif：Doxygen CSS 组合、Graphviz 来源/图输入/声明和尚未绑定的文档生成数据。
2. GIR：原供应包与版本、固定加工链、原手册引文及对应分发条件。
3. 其余生成输入：剩余 8 项、生成工具来源与现有宏/脚本的实际分发条件。
4. 将上述闭合结果和已验收 supplement 汇总为全新的完整材料 kit，保留原 kit。

之后才按 G2-00-03 → G2-00-04 → G2-00-05 → G2-00-06 推进 PDF 闭包、新候选、默认发行和隔离 Full；依赖与完整 Task 映射见[工单映射](2026-10-01-engineering-ticket-map.md)。

## 6. 本轮验证与发布前置

基线整理时的验证结果（流程纠偏前）：

| 检查 | 结果 |
| --- | --- |
| 232 既有工作树文件及四份配置的字节/权限保护 | PASS |
| 44 产品 Task 原状态/原依赖完整对应，20 已验收＋24 待推进 | PASS |
| 六个 G2 内部步骤独立映射，四张候选依赖无环，候选无前置项为 01/02/03 | PASS |
| 只新增本批八文件，index 为空，无额外源码改动 | PASS |
| 草稿正文/JSON/格式/新文件 diff | PASS |
| 现有文档检查，含全部仓库本地 Markdown 链接 | PASS，2/2 |

这些结果只覆盖配置、报告和草稿。产品 C/P/B、native 应用构建、Full、日常安装及真实 Provider 均未执行；历史回执不作为本轮重新验收。

初始基线之后，Q1–Q4 已确认共同理解和测试边界，并授权总规格发布；完整规格已发布为 [总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)，四张工单经 2026-10-02 的 Q5 批准后发布为 #20–#23，#23 原生依赖前三项。实际发布状态及稳定链接记录在任务映射，基线中的原始远程快照不当作后续最新状态。本轮不为本地材料制造 GitHub blob 链接。完整清单的文件名和摘要只用于本地基线，不自动公开到 Issue 正文。

2026-10-02 的发布回填只在原 Task 看板增加 Issue 导航，并同步本批任务映射与工单正文；原 232 文件清单及其摘要保留为建立基线时的历史快照。44 个产品 Task 的状态、依赖及验收口径不变，当前工作状态按已迁移的 Issue 和未迁移的原看板分别跟踪。
