# G2-N02 / #25：native 构建候选前置核验

日期：2026-10-09。**G2-N02 BLOCKED；本次 native 二进制候选 NOT_CREATED，实际配置、编译、链接及候选加载 NOT_RUN。** 本次完成任务定位、当前原生依赖与直接关联材料回执核验，并保存阻断及恢复条件；未完成 #25 的构建与验收。

目标为 [G2-N02 / #25](https://github.com/Ricardo121380/only-my-pi/issues/25)，原 Task G2-00-04 的 native 构建切片，对应[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)的 US-013，并遵守 US-001–US-004、US-005/010 和 [ADR-0017](../decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)。[当前正文副本](2026-10-09-remaining-ticket-drafts/02-g2-n02.md)与本次远程正文逐字一致。用户提供的 G2 后续批次截图用于消除最初 G02 与 Glacier 交互编号的歧义；本次选定第二项 #25，其他工单的完成状态不随本报告推进。

## 当前前置及阻断原因

北京时间 2026-10-09 22:18:21–22:18:27，主代理回读 #19–#25 正文、评论、状态，以及 #23/#24/#25 的原生 blocked-by；十个只读命令均 exit 0。原生依赖为：#25 blocked by #24；#24 blocked by #23；#23 blocked by #20、#21、#22。Issue 的 OPEN 与材料验收状态分列：

| 前置 | GitHub 状态 / 验收状态 | 当前仍需交付 |
| --- | --- | --- |
| [#20：libexif 生成链](https://github.com/Ricardo121380/only-my-pi/issues/20) | OPEN / PARTIAL | 固定有效配置、实际 dot 输入与工具，生成 CSS、五图及其余文档/索引/footer，完成双次生成、兼容和当前操作条件 |
| [#21：GIR 供应与加工](https://github.com/Ricardo121380/only-my-pi/issues/21) | OPEN / PARTIAL | 实际供应包或源码和未加工输入，固定加工链、实际重放、完整引文与当前操作条件 |
| [#22：其余生成输入](https://github.com/Ricardo121380/only-my-pi/issues/22) | OPEN / PARTIAL | libffi ChangeLog、libffi PDF、Expat 平台配置三项的实际输入与生成，固定可信工具/补丁/快照及当前条件 |
| [#23：完整 native kit](https://github.com/Ricardo121380/only-my-pi/issues/23) | OPEN / BLOCKED；newKit=NOT_CREATED | 前三项满足各自关闭条件后，汇总独立新 kit，核验全文件字节/摘要/执行位、义务账本及真实离线正负例 |
| [#24：PDF 材料](https://github.com/Ricardo121380/only-my-pi/issues/24) | OPEN / BLOCKED；新 PDF 候选 NOT_CREATED | #23 出口满足后，闭合字体/CMap/worker/WASM/helpers/QuickJS 的实际来源、工具、生成与当前操作条件 |

#25 首项验收明确要求“开始前核对已验收 native kit、PDF 材料出口及所有当前构建前提”。当前 #24 正文明确仍 BLOCKED、恢复条件为 #23 完整出口；#23 正文仍要求 #20–#22 全部满足关闭条件才进入可执行前沿。已读正文和评论没有新的完成或解除依赖证据，ready-for-agent 标签不解除这些前置。

新可复现材料路线已由 R1–R4 确认并写入现行规格。当前阻断来自尚未交付的材料与验收，不是等待路线授权；旧回执中等待新候选范围决定的字段保留为历史快照。本次保持 #25 的任务身份，未将目标替换为前三张材料工单，也未以旧 dylib、configure 冒烟或 supplement 身份补足新 kit/PDF 出口。

## 源码、回执及核验范围

源码根为 `LOCAL_WORKSPACE/repo`，分支 `codex/webui-phase1`，起点及审阅基点为 `b09ef66184404426a8a33896a65082db024b3ce1`；开始时 index 为空。原工作树有 289 个既有改动路径，保护清单覆盖 1,565 个 tracked/未跟踪源码文件的类型、字节、摘要与权限。清单 SHA-256 为 `8a35ea85d8f669c032da6f6a95cd7ed9d56f431d0d9e14b125450d6edaaae395`，这是源码快照身份，不能作为 kitId、binary/resource 身份或 stackId。

本次证据目录为 `LOCAL_WORKSPACE/artifacts/webui-optimization/G2-N02-preflight-1009-kec6o24_`。`preflight.json`、`baseline/`、`spec-identities.json`保存源码与环境；`issue-19.json`至 `issue-25.json`、`blocked-by-23/24/25.json`及 `remote-readback.json`保存远程原字节、命令、时间、退出码和摘要。当前环境 Darwin 27.0.0 / arm64；本地自动化使用已存在且重新核对版本的 Node 22.19.0 / 24.19.0，没有更改全局 Node 或日常栈。

主代理抽核三份直接关联回执，保存原字节副本与 `material-readback.json`：

| 回执 | 本次原字节 SHA-256 | 读取到的状态及范围 |
| --- | --- | --- |
| `G2-00-04-preflight-1002-bdkahjzz/preflight.json` | `f5277283014d296690d1aad742928f3565aafc0f514ff5a05ed46bd413005684` | scope 为 #23 前置核验；status/issueCompletion=BLOCKED、newKit=NOT_CREATED、newKitId=null、wholeKitRehash=NOT_RUN。目录名不是 #25 已构建证明 |
| 同目录 `closeout.json` | `57f7eaa3162dfd9ba33f5e4f9b5a60f3e39f1337f142dc53ee6036384662e753` | status=PASS 同时 workStatus=BLOCKED、newKit=NOT_CREATED；PASS 仅为当次记录与保护收口，不能记为新 kit 验收 |
| `G2-N01-preflight-1007-n9dkft_y/closeout.json` | `173cc5a1cf807ec50ee4dea43b5bd17caafb55216f9d6c6893a26ecaa8a3c0c9` | taskStatus=BLOCKED、newPdfCandidate=NOT_CREATED，新材料生成及新离线矩阵均 NOT_RUN |

以上回执路径相对仓库外 `artifacts/webui-optimization/`，对应[原 native kit 核验报告](2026-10-02-native-kit-prerequisite-preflight.md)及[原 PDF 核验报告](2026-10-07-g2-n01-prerequisite-preflight.md)。当前三份 native 材料合同的 issueCompletion 仍为 PARTIAL、licensingClosure 仍为 INCOMPLETE；其摘要另存 `material-readback.json`。独立探子核对的六份 #20–#22 双 Node 历史报告及 #23 保存副本也保持这些状态，主代理抽核关键合同字段。

本轮读取的是现存回执字节、合同字段和当前远程前置；历史生成、完整 kit 实物重核、PDF 资源根与实际禁网矩阵均未重新运行。结论限定上述直接关联证据没有交付已验收的新 kit/PDF 出口，不推定全机材料不存在，也不外推日常安装损坏。当前未提交的相关合同、计划和测试仍是工作树证据；本报告提交不使它们成为干净源码构建证明。

## #25 验收逐项状态

| 验收条件 | 本次状态 |
| --- | --- |
| 已验收 native kit/PDF 出口，完整源树/子模块、补丁、overlay、347 vendor、locale override、工具链/SDK 固定 | BLOCKED：#24/#23 出口未满足；本次未组装、修补或生成替代输入 |
| 单一公开构建入口、有界配方、完整私有依赖正式重新配置及实际编译/链接 | NOT_RUN：前置未满足，正式构建实现未开始；已有五组 configure 冒烟和测试 crate 不补本项 |
| locked/offline、锁与补丁不变，缺输入/漂移/别名/未审 overlay 等拒绝及失败证据 | 新候选矩阵 NOT_RUN；既有 C 合同回归单列，不能替本项通过 |
| 完整候选布局、清单/摘要/执行位、真实日志、源码对应和动态链接解析范围 | 二进制候选 NOT_CREATED；新候选的布局、对应与链接验收 NOT_RUN |
| 候选实际加载及最小代表性功能，路径/输出/退出码 | NOT_RUN；#26 的完整图片/Pi/RSS/PDF 矩阵也未因此放行 |
| 当前实际构建的声明与条件，完整义务账本及后续分发/Full 交接 | BLOCKED：本次没有可接受构建输入及实际产物；具体构建条件与后续义务仍待绑定真实对象、原文和证据 |
| 独立 binary/resource 身份、双轴及构建/运行证据，旧 kit/supplement/合同/失败保留 | 本次只交付阻断核验与双轴记录；kitId、binary/resource 身份及 stackId 未生成或互相替代，完整出口未满足 |

## 本次检查与评审

本次仅新增本报告，没有行为代码或新测试，TDD 实现循环未开始。按 implement 请求运行已有本地自动化，验证生产探针拒绝输入的合同及当前工作树状态；这些 C 测试不是本次真实 native 构建、候选运行或禁网验收。

| 检查 | 本次结果 |
| --- | --- |
| 当前工单正文、原生依赖及直接关联历史回执 | PASS（限定读取范围）；十个远程命令 exit 0，回执原字节及状态已留证 |
| Node 22.19.0 / 24.19.0，native rust CLI / target graph CLI / configure review 三文件 | 各 10/10 PASS、exit 0；缺编译器/补丁/输入、别名/既有输出拒绝及 configure 诊断合同，不是候选构建 |
| 类型检查 | PASS，Node 24.19.0、根/safety/Host/WebUI 四份配置、exit 0 |
| 新增报告前的文档链接基线 | FAIL，exit 1：任务映射一条与材料路线讨论两条仓库外链接；原日志已保存 |
| 报告内容、引用、格式及 diff | PASS：四个仓库内引用存在，无新增越界链接、尾随空白或冲突标记；最终 diff 单独留证 |
| 仓库 Node 全量，一次默认入口 | FAIL，Node 24.19.0、`npm test`、1,555 PASS / 1 FAIL / 5 SKIP，共 1,561、exit 1；唯一失败与新增报告前的三个越界链接一致 |
| WebUI 全量，一次 | PASS，Node 24.19.0、`npm run test:web`、11 文件、92/92、exit 0；这是组件检查，浏览器验收 NOT_RUN |
| Standards / Spec 两轴 | Standards PASS：硬违反 0、Fowler smell 0；Spec BLOCKED：七项工单出口未满足，a=7、b=0、c=0；报告遗漏及事实错误均为 0 |
| 原源码文件、既有改动及 tracked diff 保护 | PASS：检查后 1,565 原文件类型/字节/权限、原 tracked diff 与 index 均保持；提交前后再核对 289 既有改动路径 |

日志及检查收据位于本次证据目录。既有链接失败在新增报告前已复现；保留其 FAIL，不修改无关文档或放宽链接门禁来消除它。最终仅提交本报告；当前工作树、旧 kit/supplement、历史失败和日常安装保持各自身份。本次实际 native/PDF 构建、新候选加载/真实禁网矩阵、Full、浏览器、真实外部 Provider、日常晋升及软件发行均 NOT_RUN，远程写入与推送均未执行。

两位独立探子只审阅本报告，冻结差异为证据目录中的 `review.diff`，SHA-256 为 `07c8a2f46231aa42becda49d470d7b1ab51d7f741b2eb9f7f3b3b83207acb94d`。比较命令为 `git diff --cached b09ef66184404426a8a33896a65082db024b3ce1 -- docs/plans/2026-10-09-g2-n02-prerequisite-preflight.md`；其他 289 个既有改动路径排除。Standards 未发现规范问题；Spec 的七项缺口与上表逐项一致，报告完整保留阻断，没有替代材料或误报通过。评审未运行测试、构建或重新核验完整材料；本次执行及检查收据由主代理产生。评审后仅回填本段与结果行，最终 diff 身份和源码保护单独复核留存。

## 恢复条件与后续责任

最小恢复顺序为：#20、#21、#22 各自的新材料切片满足当前关闭条件 → #23 交付具有独立身份、完整文件核验、条件账本和离线正负例的 native kit → #24 完成 PDF 材料出口 → 回到同一 #25 核对当前材料身份、工具链/SDK 文件身份、锁/补丁/overlay、私有依赖布局和构建所需条件，再实施正式隔离构建及候选加载。路线授权已存在，这些恢复项是具体交付与验收条件。

#25 只负责 native 实际构建与最小运行；#26 负责 PDF/完整 parser 资源候选和图片/Pi/RSS/PDF 矩阵，两项都满足才完成 G2-00-04。#27 负责默认发行、最终包/ledger/双 SBOM/notices 及分发履行；#28 负责同候选隔离 Full 与 F01–F06 核对。当前 #25 BLOCKED、G2-00-04 未完成；完整材料/许可 INCOMPLETE、Full NOT_RUN、U2 BLOCKED，产品 Task 的 20/44 历史验收计数不由本报告增加。
