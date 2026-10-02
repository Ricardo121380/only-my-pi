# 04 / #23：新完整 native 材料 kit 前置核验

日期：2026-10-02。**工单 #23 BLOCKED；新完整 native kit 尚未生成。** 本次完成前置核验及阻断记录，未完成 #23 的实现与验收。[工单 #23](https://github.com/Ricardo121380/only-my-pi/issues/23)要求 #20、#21、#22 各自满足关闭条件后才能进入可执行前沿；三个前置报告均明确保持 PARTIAL，仍存在必需材料缺口。实现提交、材料账本或部分测试 PASS 不解除这些前置。

范围来自[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)的 US-005、US-010、US-011，以及 US-001–US-004 共同约束。原编号为 G2-00-02，出口只是 F02 的 native 材料部分；身份与历史保护继续遵守 [ADR-0017](../decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)。

## 当前代码、环境与证据

源码 Git 根为 `LOCAL_WORKSPACE/repo`，分支为 `codex/webui-phase1`。本次起点及审阅基点为 `f4cc764f280157e1586f8b9d6ac2f50600ceb4a5`；其最近三项材料实现分别是 `c9b756e`（#20）、`9e0497c`（#21）及 `f4cc764`（#22）。这些提交的报告仍明确声明工单 PARTIAL。

本次证据目录为 `LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-04-preflight-1002-bdkahjzz`，下文称 `$runRoot`。`preflight.json`保存环境、源码与前置报告身份；六份 `issue-*-node*-report.json`保留所读取报告的完整原字节；四份 `issue-*-remote.json`保留本次 GitHub 回读的正文、状态和评论。

| 项目 | 本次观察 |
| --- | --- |
| 环境 | macOS / Darwin 27.0.0 / arm64；预核验默认 Node 为 26.8.2 |
| 本地自动化 Node | 使用既有隔离栈中的 Node 24.19.0；不改变全局 Node 或日常栈 |
| 预存在的工作树改动 | 217 个脏文件；开始时 index 为空 |
| 源码保护快照 | `git ls-files --cached --others --exclude-standard`的 1,515 个文件，逐文件记录 SHA-256、字节数、类型和权限 |
| 源码清单身份 | `sha256:70556bac7266e12fbc3dcb12adbeba5d373d925d872b90306c0315529d7d5bce`；这是本次源码快照身份，不能作为 native kitId |
| GitHub 回读 | #20、#21、#22、#23 均 OPEN；本次没有修改远程状态 |
| 六份前置报告 | 两个 Node 版本的三项报告均为 `status=PARTIAL`、`issueCompletion=PARTIAL`、`licensingClosure=INCOMPLETE` |

三项只读独立核验分别定位各前置的合同、CLI、报告和直接引用回执；主代理再亲自抽核下列关键原文、合同状态及六份实际 JSON 报告。报告字节核对属于本次观察；其中记录的历史执行、禁网、材料清单与保护结果未重新运行，不升级为本轮验收。

## 前置缺口与最小所需材料

| 前置 | 已有证明范围 | 仍阻断关闭的必需缺口 | 本次抽核出处 |
| --- | --- | --- | --- |
| [#20](https://github.com/Ricardo121380/only-my-pi/issues/20) | CSS 的 55,162 字节固定组合对应；五图及 63 个其余文件的生成材料账本；已验收六组件、九资产保留 | 有效 Doxyfile、maintainer 替换及 builder 身份；五份原 dot 与 Graphviz 可执行文件/环境；63 文件的实际生成对应；输出特定分发条件及履行 | [libexif 报告](2026-10-02-libexif-generation-acceptance.md)“分发条件与未完成项”；[固定合同](../../contracts/release/parser-resources-v1/native-libexif-generation.json)的 `pending`与 `issueCompletion` |
| [#21](https://github.com/Ricardo121380/only-my-pi/issues/21) | 53 个加工后固定文件、40 GIR 的供应/加工账本，以及 25 条 FileError 与取得的 GLib/GNU 比较材料对应 | 原 36 份容器 GIR 与不可变 image/build 身份；两个精确 MSYS2 包及三份原 GIR；macOS job/source/artifact 与原 GIR；加工工具/手工修订及实际重放；历史手册和其余 GIR 文档/分发条件 | [GIR 报告](2026-10-02-gir-materials-acceptance.md)“#21 逐项验收与仍需输入”；[固定合同](../../contracts/release/parser-resources-v1/native-gir-materials.json)的 `processing`、`distribution`、`pending` |
| [#22](https://github.com/Ricardo121380/only-my-pi/issues/22) | 五个 autoheader 模板各两次内容复现；八项输入及 111 个宏/脚本的十家族条件账本；三个静态对应保留 | libffi ChangeLog 的 Git 图/原调用、PDF 引擎供应/TeX 输入、Expat 平台/compiler/config.status；Debian patchsets、GNU config 历史快照、三个 HTTP 比较包的可信来源；包特定 notice、例外适用与分发履行 | [生成输入报告](2026-10-02-webui-g2-00-generated-inputs.md)“未完成项与后续边界”；[固定配方](../../contracts/release/parser-resources-v1/native-generated-inputs.json)的 `pending`、`distribution`与 `issueCompletion` |

本次代码抽核与报告相符：[libexif CLI](../../scripts/probes/webui-g2-libexif-generation.mjs)保留 `exactDotInput=UNBOUND`及 `generationBinding=UNVERIFIED`；[GIR CLI](../../scripts/probes/webui-g2-gir-materials.mjs)保留 `originalSupplierInputs=NOT_ACQUIRED`及 `actualOriginalToGirReplay=BLOCKED`；[生成输入 CLI](../../scripts/probes/webui-g2-generated-inputs.mjs)保留 `issueCompletion=PARTIAL`。未知项不由退出码 0、工具版本字符串、许可全文已保存或 SPDX 标签补为通过。

以上路径是当前冻结输入中的缺口，不是全机材料不存在的证明。已请求这些原材料的本机目录；未收到路径或新的候选范围决定，不能推定其不存在、选择替代来源链或改变原前置条件。若明确改用新的确定生成候选，须另行固定输入、工具、输出身份和证明范围，保留历史候选、未核历史及全部失败证据。

用户于本次核验后答复“这些材料好像都没有”。据此记录目前没有可提供的材料路径，保留这句话的不确定性，不提升为全机材料已查无。继续实施建议为先补做 #20–#22 的新确定候选：冻结新来源/工具/配置、实际生成并绑定独立输出、核对必要文本与分发条件，满足各自关闭条件后再回到 #23。该路线改变前三项的材料来源链，需要明确后续范围；本次 `04` 没有自动授权选择新的供应版本、执行这些上游生成过程或改写原候选。

## 已有身份的保留范围

| 对象 | 原记录身份 | 本轮范围 |
| --- | --- | --- |
| locale kit / 当前输入 kit | `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622` | 读取前置报告中的身份；完整 kit 实物重核 NOT_RUN |
| #20 supplement | `sha256:2ad61bcd7704a7382db990aeba3dcefcd73611f8cc143d02e3096c55a824f53a` | 两侧报告均列 347 文件及同一身份；底层文件重核 NOT_RUN |
| #21 supplement | `sha256:fca98e127d942ffad3ec9d5534a8e86c040a213aa189253cb14611f276783c5c` | 两侧报告均列 131 文件及同一身份；底层文件重核 NOT_RUN |
| #22 supplement | `sha256:29597c710e2adef1c5c4077ad631879e22e62c52556a2dd549c4524edfcd29a8` | 两侧报告均列 1,002 文件及同一身份；底层文件重核 NOT_RUN |

本次仅新增本报告及仓库外预核验记录。原 locale kit、353 vendor kit、各 supplement、Windows/gettext/xmlwf 证明及成功/失败历史没有被本次写入或重新判定。supplementId、输入 kitId、binary/resource 身份及 stackId 继续区分；未生成新 kitId。

## #23 验收逐项状态

| 工单验收条件 | 本次状态 |
| --- | --- |
| #20/#21/#22 各自满足关闭条件，必需缺口阻断 | BLOCKED：三个前置均存在上述缺口 |
| 独立新输出/清单/kit 身份，并保留旧输入 | 新 kit NOT_CREATED；本次只记录前置，原输入不写入 |
| 完整 source/子模块/patch/tool/lock/347 vendor/locale override/已审 overlay/必要文本 | NOT_RUN：前置未满足，未汇总为新 kit |
| 全文件字节/摘要/执行位与清单闭包实核 | NOT_RUN：没有新 kit；源码保护快照不替代 whole-kit rehash |
| 生成来源与实际分发条件逐项闭合 | BLOCKED：此前账本保留，必要来源及履行仍未闭合 |
| 新 kit 有界离线正例及缺材料/漂移/错误用途/别名负例 | NOT_RUN：没有新 kit；此前 supplement 的负例不是本项证据 |
| G2-00-02 native 材料出口 | BLOCKED：本报告是阻断核验，不是完成出口 |
| 下一项 G2-00-03 与后续阶段边界 | 待 #23 完整出口后才进入 G2-00-03；当前返回前三项补证 |

## 本次验证与交付

| 检查 | 本次结果 |
| --- | --- |
| 工单正文及实际六份报告回读 | PASS：三个前置 PARTIAL，#23 BLOCKED；原字节已留证 |
| 文档链接/格式/diff | PASS：文档链接 2/2、暂存 diff 无空白错误 |
| 类型检查 | PASS：Node 24.19.0，根/safety/Host/WebUI 四份配置；`typecheck-receipt.json`及日志 |
| lint | PASS：1,332 个 tracked 文件、0 findings；`lint-receipt.json`及日志 |
| 仓库 Node 全量，一次正式默认入口 | PASS：`npm test`，1,556 PASS、5 SKIP、0 FAIL，共 1,561 项；`full-node-receipt.json`及日志 |
| WebUI 全量，一次 | PASS：`npm run test:web`，11 文件、92/92；`full-web-receipt.json`及日志 |
| Standards / Spec 两轴审阅 | Standards PASS：硬性违反 0、判断性气味 0；Spec PARTIAL：a=6、b=0、c=0，六类未满足出口均已记录，报告遗漏 0；#23 仍 BLOCKED |
| 原 1,515 文件及 217 既有脏文件保护 | PASS：字节/大小/类型/权限及原 tracked diff 均保持；`protection-before-review.json`，提交前再核对 |

本次没有行为代码改动或新测试，TDD 实现循环未开始。按 `implement`请求执行上述本地自动化；其中既有实际 Pi 加 loopback Provider 回归不代表新材料候选通过，WebUI 组件检查不代表浏览器验收。新 kit 生成、whole-kit rehash、新 kit 离线矩阵、新资源对应的 native 应用构建/实际 Pi 矩阵、Full 安装、浏览器、真实 Provider、日常晋升及公开发行均 NOT_RUN。没有修改、认领、评论或关闭远程 Issue，也没有推送。

两位探子的审阅仅覆盖本报告，冻结差异为 `$runRoot/review.diff`，SHA-256 `a202723ce9f3a10c80b2153add57f7daaf7c123336aa9b58a16af6387626ae31`。暂存工作适用的固定比较命令为 `git diff --cached f4cc764f280157e1586f8b9d6ac2f50600ceb4a5 -- docs/plans/2026-10-02-native-kit-prerequisite-preflight.md`，其他 217 文件排除。Standards 未发现规范问题；Spec 的六类缺口为前置、独立新 kit、完整集合汇总、全文件核验、来源/分发闭合及新 kit 离线矩阵，均为已承认的阻断，无扩张或误报。探子未运行测试或独立重核 kit，测试计数由主代理读取本次实际日志确认；审阅后补入本段、结果行及用户材料答复，最终 diff 和原文件保护由主代理复核。

当前 G2-00-02 保持 PARTIAL，整体 F02/F03 保持 PARTIAL，完整材料/许可闭包 INCOMPLETE，Full NOT_RUN，U2 BLOCKED，产品 Task 仍为 20/44。只有前三项必需材料闭合并满足关闭条件，#23 才能汇总独立新 kit、验证完整集合与正负路径；其 native 材料出口完成后，原定下一项仍为 G2-00-03。
