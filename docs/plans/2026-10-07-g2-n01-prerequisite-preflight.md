# G2-N01 / G2-00-03：PDF 材料前置与实物核验

日期：2026-10-07。**G2-N01 BLOCKED；PDF 材料闭合尚未实施，新 PDF 材料候选 NOT_CREATED。** 本次完成任务定位、前置回读、已有 PDF 材料的限定实物复核和阻断记录，未完成工单验收。范围来自工作树中的 `docs/plans/2026-10-07-g2-ticket-drafts/01-pdf-material-closure.md`及[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)的 US-012 和 US-001–US-004，原 Task 为 G2-00-03，出口仅为 F02 的 PDF 材料部分。

## 任务身份、前置与已确认路线

本次认证可见的 `Ricardo121380/only-my-pi` 全状态 Issue 枚举只有 #19–#23；按 G2-N01 和 PDF 标题搜索均无结果。G2-N01 是本地审阅编号，尚无实际 Issue 映射；本次使用上述具体草稿定位任务，没有预占编号或创建远程工单。未发布本身不替代材料前置的判断。

北京时间 2026-10-07 18:14–18:20 回读当前正文、评论和原生依赖：总规格仍要求 #20/#21/#22 的新材料切片完成，再由 #23 汇总完整 native kit，随后进入 PDF 材料；本地副本为 `docs/plans/2026-10-01-webui-remaining-spec.md`。草稿明确 `Blocked by #23`；#23 当前正文写明三个前置全部满足关闭条件后才进入可执行前沿，其原生 blocked-by 返回 #20/#21/#22，三项均 OPEN。当前远程状态与本地记录相符：

| 前置 | 当前远程状态 | 尚须交付的当前候选结果 |
| --- | --- | --- |
| [#20：libexif](https://github.com/Ricardo121380/only-my-pi/issues/20) | OPEN / PARTIAL | 固定有效配置、实际 dot 输入与工具，生成 CSS、五图及其余文档/索引/footer，完成复验、兼容与当前操作条件 |
| [#21：GIR](https://github.com/Ricardo121380/only-my-pi/issues/21) | OPEN / PARTIAL | 实际供应包/源码和未加工输入，确定加工与实际重放，完整引文及当前操作条件 |
| [#22：生成输入](https://github.com/Ricardo121380/only-my-pi/issues/22) | OPEN / PARTIAL | libffi ChangeLog、libffi PDF、Expat 平台配置三项的实际输入与生成，可信工具/补丁/快照及当前条件 |
| [#23：完整 native kit](https://github.com/Ricardo121380/only-my-pi/issues/23) | OPEN / BLOCKED | 前三项满足各自条件后，生成独立完整 kit，实核全文件、摘要、执行位和义务，完成离线正负例；当前 `newKit=NOT_CREATED` |

10 月 2 日的新候选路线 R1–R4 已确认，并已写入当前 #19–#23 正文；本地记录为 `docs/plans/2026-10-02-material-candidate-discussion.md`：优先保持组件版本，固定可取得来源、工具、配置与环境，实际生成并按新身份验收，保留旧候选和未知历史。这里的阻断是尚未满足的交付和依赖，不是缺少这条路线的授权。旧前置报告中等待路线决定的措辞是历史快照，不能作为当前授权状态。此次选定 G2-N01 不改变其明确前置，也不将任务替换为 #20–#23。

## 本次源码与证据身份

源码 Git 根为 `LOCAL_WORKSPACE/repo`，分支 `codex/webui-phase1`，起点与审阅基点为 `0f258c90e90311a2e539fd3a276ad26c32749216`。开始时 index 为空，默认 porcelain 展示 221 项既有改动；展开未跟踪目录后为 249 个既有脏文件。

证据目录为 `LOCAL_WORKSPACE/artifacts/webui-optimization/G2-N01-preflight-1007-n9dkft_y`，下文称 `$runRoot`。`preflight.json`记录 Task、源码、环境和 Node 路径；`baseline/`保留初始 status、tracked diff、既有脏文件摘要及 1,524 个源码文件的字节/权限清单。该源码清单身份为 `sha256:52bf9128a86dc5143e6a093a859212683138ec796b14103abd150bb38427bd1a`，不是 PDF kitId、resourceId 或 stackId。

`remote-readback.json`及四份 `*-remote.json`保存主代理抽核的 #19/#23 正文、#23 原生依赖（含三个前置正文）和全状态列表，四个只读命令均 exit 0；独立探子另外完成 PR 身份排除、五张 Issue 及两种 PDF 搜索。查询失败的 PR 编号回退为 Issue 查询，不算材料验收失败。`spec-identities.json`绑定本次具体草稿与总规格，摘要分别为 `sha256:d6bd90ac8e0413821d998c349a7910dbdf78e73a64152eb7bb63fa3babf575de`和 `sha256:65788560bd465d4ace280f280afc43dfe154238ea05cde5ba44a5105fa614005`。

本地自动化使用既有隔离 Node 22.19.0 / 24.19.0，环境 Darwin 27.0.0 / arm64；没有更改全局 Node 或日常栈。每份检查收据记录实际 Node 路径、命令、起止时间、退出码和日志摘要。

上述草稿、总规格本地副本、讨论记录及下列 PDF 材料/脚本均属于既有未提交工作树，本次只提交这份报告，不捎带它们。校验结果绑定该源码清单与工作树，不能作为从本报告的干净提交独立构建或运行的证明；文件路径是本机出处，远程需求和前置由实际 Issue 及回读快照支持。

## 已有 PDF 证明范围与本轮实物观察

原 PDF 输入报告 `docs/plans/2026-09-29-webui-u0-pdf-inputs-acceptance.md`及固定审阅记录 `contracts/release/parser-resources-v1/pdf-build-inputs-review.json`对应 `pdfjs-dist@6.3.289`、PDF.js revision `1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56`。前批 158 项是 QuickJS 两项和其他图标 156 项；后批 196 项是 CMap 168、Foxit 10、Liberation 4、OpenJPEG 2、JBIG2 2、qcms 1、ICC 1 和带 MPL 头的图标 8 项，另有 10 份附带文本。合计 354 项资产的固定源 blob 字节对应是历史证明范围，包含字体、CMap、图标和二进制/辅助资产；不能据此声称完整源树已取得、worker 已重建或编译闭包完成。

主代理本轮复核历史 `pdf-inputs.json`原字节：158,494 字节、`sha256:dc7d128b29115468de7567ff6170058abcd6e876a55e4ca5c10f4a42b997911e`，与原审阅摘要一致。其原执行时间为 2026-09-29，状态 PARTIAL；本轮未重放历史采集或历史 354 项资产校验。直接引用的 33 份说明/候选文本均仍在原路径，本轮重新计算长度、SHA-256 和 Git blob，33/33 匹配，共 175,694 字节。实物复核及历史报告副本保存于 `pdf-material-readback.json`和 `pdf-inputs-historical.json`，原件不写入。

当前 F01 合同与材料配方的摘要仍分别为 `sha256:a7f342d5ce2ead6610fb5cc2624307ca90c31a0f6540fb1b64a63fd2475edb70`和 `sha256:5a168315d9bdb6198f9e94cd72ae2a5adadbd239f1c63c18ca819d61339c37e5`。原材料校验 `scripts/probes/lib/resource-source-materials.mjs`继续保留 `sourceBuildCorrespondence=UNVERIFIED`、`licensingClosure=INCOMPLETE`，没有改为 PASS。

另有当时的输入状态问题：历史报告记录的 documents 临时根当时虽仍是目录，其记录的 `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`不存在。确切原路径保留在 `$runRoot/historical-roots-node22.log:5` 和 `$runRoot/historical-roots-node24.log:5`，不在仓库报告重复设备临时路径。通过公开 `verifyParserResources`入口进行只读实物校验，两侧 Node 均先因缺少 manifest/精确 lock 返回 `PARSER_RESOURCE_LOCK_INVALID`、exit 1；images 树未进入后续核验。原日志及历史失败结论保留。

这个失败只说明上述历史临时根当前不能复验 F01，不证明其他候选或日常安装损坏，也不追溯否定历史执行。原采集 CLI 会先做同一资源校验、随后获取材料；本次没有重跑联网采集、补写临时根或更换旧资源。完整资源树重新取得/生成与核验仍待前置满足后绑定当前身份。

## PDF 尚缺材料及后续出口

下表是依据当前合同与直接引用的历史材料确定的缺口，不是全机材料不存在的证明。字体或组件版本变化、功能降低及接口变化继续按草稿单列影响；本轮未作这些决定。

| 对象 | 已有记录可复用的范围 | 仍须实际固定并核验 |
| --- | --- | --- |
| Foxit / Liberation 字体 | 固定 PDF 源 blob 与附带文本、说明 | Foxit 精确提取来源与路径，实际采用的 Liberation 原始材料，复制/生成条件与候选对应 |
| Adobe CMap | 168 项压缩资产、附带文本、固定转换脚本 | 实际采用的原始 CMap 输入、版本/集合，确定调用和解析后输入，生成对应 |
| worker | F01 对普通/legacy worker 文件有路径、长度和摘要合同 | 实际采用源码、构建脚本、工具/环境和输出链；354 项资产对应不覆盖 worker 构建 |
| OpenJPEG / JBIG2 / qcms | 固定产物与两个 `*_nowasm_fallback.js`辅助模块、附带文本、参考 builder blob | 实际 builder、完整源码/wrapper、patch/lock/vendor、精确工具链与解析后输入；参考脚本或浮动工具声明不等于取得材料 |
| QuickJS | 声明 revision `3d5e064e9dd67c70f7962836505a7fa067bf0a4e`、源 LICENSE、候选 patch/exports/脚本 | 实际采用的完整源码与 builder/toolchain/environment；`b62f7cd527363ca2c1fe7467f274bc9acbf78c24`仍仅历史候选，不是已证明的历史 builder |
| 图标、ICC 与混合文本 | 源字节对应，部分嵌入声明，10 份附带文本；ICC 原件及许可差异的历史证据 | 每类必要原文、版权、拟用途与适用前提的绑定，以及当前复制/生成条件；156 项其他图标和 QuickJS 的未闭合声明保留 |

本阶段需要新生成的对象仍须在固定来源、工具、配置及环境下使用两个独立目录实际生成，核对完整输出集合和字节，保存失败、新旧差异及可观察的内容/结构/接口兼容证明。当前没有新的 PDF 材料清单、执行位身份、来源回执、义务账本或新 kitId；不将本报告、33 文本复核或合成夹具测试当作这些交付物。

| G2-N01 验收条件 | 本次状态 |
| --- | --- |
| 当前集合完整覆盖并保留 354/10 的原证明范围及变化 | 原证明范围已记录；当前候选完整集合与变化核验 NOT_RUN |
| 原始字体/CMap、各 WASM/QuickJS、worker/helpers 的实际构建输入 | PARTIAL：仅保留上述来源字节与说明/候选文本，实际完整输入未闭合 |
| 混合资产逐项声明及当前必需条件 | INCOMPLETE：未完成当前 PDF 义务账本和操作条件闭合 |
| 固定环境两次独立生成、完整比对、差异与兼容 | NOT_RUN：#23 前置未满足，未开始 PDF 新生成 |
| 保持组件/功能范围、独立保留旧候选与未知历史 | 本次未替换原输入或组件；新候选的该项验收 NOT_RUN |
| 独立材料输出、双 Node、真实禁网/网络拒绝和受影响负例 | 新输出 NOT_CREATED；新材料矩阵 NOT_RUN。既有合成合同测试另列，不能补该项 PASS |
| 当前 PDF 全部条件满足后关闭并完整交接后续义务 | BLOCKED：未形成可验收材料出口；后续仍待真实对象、原文和适用前提绑定 |
| 双轴、源码/输入/输出/命令身份及范围受限的出口报告 | 本报告只记录前置与限定复核；G2-00-03 出口 BLOCKED，评审结果在验证后记录 |

后续责任保持：实际 native 构建候选归 G2-N02，实际 PDF/完整资源构建与运行兼容归 G2-N03，默认最终包/ledger/双 SBOM/notices 和分发履行归 G2-N04，隔离 Full 与 F01–F06 总核对归 G2-N05。材料出口必须先满足当前复制/生成条件；后续义务须在材料候选中携带对象身份、原文、拟用途、适用前提和所需证据，本表不冒充已形成的义务账本。

## 本次验证与评审

没有行为代码或新测试，TDD 实现循环未开始。按本次 `implement`请求运行已有本地自动化；PDF 定向测试使用既有合成夹具，属于 C，不能证明新材料生成、真实资源可用或禁网通过。

| 检查 | 本次结果 |
| --- | --- |
| 远程前置回读、历史报告及 33 文本实物摘要 | PASS（限定范围）；对应 `remote-readback.json`、`pdf-material-readback.json` |
| Node 22.19.0 / 24.19.0 的两个 PDF 定向测试文件 | 各 20/20 PASS，exit 0；`pdf-tests-node22/24-receipt.json` |
| 类型检查 | PASS，Node 24.19.0、四份配置、exit 0；`typecheck-receipt.json` |
| 历史临时资源根当前复验 | BLOCKED，两侧 exit 1、`PARSER_RESOURCE_LOCK_INVALID`；保留原日志，不补为 PASS |
| 新增报告前的文档链接基线 | FAIL，exit 1：既有 `engineering-ticket-map.md`一条与 `material-candidate-discussion.md`两条仓库外 Markdown 链接；`docs-baseline-receipt.json` |
| 新增报告内容、路径引用、格式及 diff | PASS：引用文件在本机快照存在，无无效新增 Markdown 链接、空白错误或冲突标记；最终摘要及 diff 另存 |
| lint | PASS，1,333 个 tracked 文件、0 findings、exit 0；`lint-receipt.json` |
| 仓库 Node 全量，一次默认入口 | FAIL，`npm test`、1,555 PASS / 1 FAIL / 5 SKIP，共 1,561，exit 1；唯一失败与新增报告前基线完全相同，为上述三条既有链接；`full-node-receipt.json` |
| WebUI 全量，一次 | PASS，11 文件、92/92、exit 0；`full-web-receipt.json`。这是组件检查，不是浏览器验收 |
| Standards / Spec 两轴审阅 | Standards PASS：硬违反 0、Fowler smell 0；Spec BLOCKED：a=7、b=0、c=0，工单缺口均如实保留、报告事实错误 0；两份独立评审另存 |
| 原源码、既有 249 脏文件及 tracked diff 保护 | PASS：1,524 原文件字节/权限、原 status 与 tracked diff 均保持；`protection-before-review.json`，提交时再核对 |

两轴只覆盖本报告，比较命令为 `git diff --cached 0f258c90e90311a2e539fd3a276ad26c32749216 -- docs/plans/2026-10-07-g2-n01-prerequisite-preflight.md`。冻结 `review.diff`身份为 `sha256:92a47cf341b686b844ae50cfcc5fde3cf51430c51d24b04be8ad3cea45555b1b`；原 249 脏文件排除。Spec 的七项包含当前集合、实际输入、声明/当前条件、双次生成/兼容、新输出/离线矩阵、逐项后续义务及评审时尚待回填的两轴出口记录。收到交卷后只回填本节与结果行；两轴结果已保存，完整材料出口仍未满足。探子没有运行测试、联网或重核完整材料；本报告的事实与检查计数由主代理实际收据支持。最终 diff 与已审快照分别留存，不沿用已审摘要标识回填后的文件。

全量失败未豁免；其三个链接在本次新增报告前已复现，属于既有工作树，原文件保持，不为当前阻断报告修改它们或降低链接规则。最终静态核对、差异评审与保护收据保存后，只提交本报告。新 PDF 生成/完整 kit/实际禁网、新资源构建及运行矩阵、Full、浏览器、真实外部 Provider、日常晋升和软件发行均 NOT_RUN；未修改、认领、评论或关闭远程 Issue。

恢复 G2-N01 的最小条件是：#20/#21/#22 的当前新材料切片分别满足关闭条件，再由 #23 交付已全量核验且具有独立身份的完整 native kit 及其出口证据。届时沿同一 G2-N01 草稿复核身份，继续字体/CMap/worker/WASM/helpers/QuickJS 的完整材料链。当前 G2-00-02/F02/F03 保持 PARTIAL、完整材料/许可 INCOMPLETE、Full NOT_RUN、U2 BLOCKED、产品 Task 20/44；本报告不放行任何后续出口。
