# 01 / #20 libexif 文档生成材料：2026-10-02

状态：**固定 CSS 对应与生成材料账本 PASS；工单 #20 PARTIAL。** 对应首批映射 01，即 [GitHub #20](https://github.com/Ricardo121380/only-my-pi/issues/20)，以及[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19) 的 US-006、US-007、US-010。任何必需来源或条件仍为 UNBOUND/UNVERIFIED 时，不满足工单关闭条件。

本次以实施开始的 `e57410a3b3037761a246bf1471939bec0aa0c8eb` 为代码审阅基点。仅新增[固定合同](../../contracts/release/parser-resources-v1/native-libexif-generation.json)、[材料 CLI](../../scripts/probes/webui-g2-libexif-generation.mjs)、[CLI 测试](../../tests/release-libexif-generation.test.mjs)和本记录。没有覆写原 kit、旧补充包或原报告。

## 输入、来源与新补充包

本次证据根目录为 `LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-01-1002-xildchgl`，下文称 `$runRoot`。机器报告、来源回执、原失败回执、测试日志均保存在该目录，未把本地材料伪装成已发布的远程文件。

| 材料 | 固定身份 | 本次验证范围 |
| --- | --- | --- |
| 原 locale kit | `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622` | 作为既有来源身份保留；本次未重跑整个 kit 的验收 |
| 原 libexif 报告 | `sha256:809d8a44bd25092ac911b82f42f7665ba990d513ae8f15e03e36aa13c1baa98c` | 实际读取并核对全部报告字节 |
| 原 libexif supplement | `sha256:34c1a90f44e896943ce2043b23a6d07041eb9afb995f91f3c51aa7259a94ed80` | 239 文件完整集合、逐文件摘要、大小、执行位复核 |
| 新来源 inventory.json | `sha256:a356d7f9a1d60da139879a7dde378ff88ff15d3f0da8349e400e91968778fc1d` | 104 个来源文件及清单本身，共 105 文件完整复核 |
| 固定合同 | `sha256:33cebbffa6c316ff1c38362992d4c3ee96c87223b20f27236e4c40ddfb589ce6` | CLI 内固定合同摘要；修改声明不能绕过固定输入检查 |
| 新 supplement | `sha256:2ad61bcd7704a7382db990aeba3dcefcd73611f8cc143d02e3096c55a824f53a` | Node 22/24 均生成 347 文件，完整清单、摘要、大小、执行位一致 |

新 supplement 包含 `retained/` 下原 239 文件、`origins/` 下新 105 文件、`derived/doxygen.css`、原报告和合同。它保留旧源码页、九资产和六组件的原证明；`retainedProofs.rerun=NOT_RUN`，本次文件复核不冒充重跑旧对应算法。输出始终使用新目录；预存在的输出、输入别名、输入输出嵌套及仓库内输出均拒绝。

Doxygen 材料固定为 1.16.1，commit `669aeeefca743c148e2d935b3d3c69535c7491e6`。新增十份实现源码保留不可变 URL、HTTP 回执、Git blob ID 与 SHA-256，CLI 复核这些绑定；已有模板和其他实现随旧 supplement 保留。Graphviz 材料固定为 14.1.2，commit `397dc2a41288a28663c87b6e03438758b2f6d029`，保留官方 tag/release 回执、SVG renderer 源码及固定版本原声明。该版本 `COPYING` 的内容是 `epl-v10.txt` 链接目标，完整正文及 API 元数据均已保存，未把 11 字节链接文本当作完整许可。

官方固定来源：[Doxygen 1.16.1](https://github.com/doxygen/doxygen/tree/669aeeefca743c148e2d935b3d3c69535c7491e6)、[Graphviz 14.1.2 renderer](https://gitlab.com/graphviz/graphviz/-/blob/397dc2a41288a28663c87b6e03438758b2f6d029/plugin/core/gvrender_core_svg.c)、[Graphviz 固定许可正文](https://gitlab.com/graphviz/graphviz/-/blob/397dc2a41288a28663c87b6e03438758b2f6d029/epl-v10.txt)。本轮公开读取不执行上游程序；一次错误的 Doxygen 路径 404 回执也保留于 `acquisition/requests.json`，没有删除或改写为成功请求。签名核验 NOT_RUN。

## 106 个归档文件逐项对账

机器账本位于 `$runRoot/final-node24/libexif-generation.json` 的 `files`，每项绑定原字节摘要和 supplement 内路径。

| 类别 | 数量 | 新证明或保留范围 |
| --- | --- | --- |
| 已对应源码页 | 19 | 保留原逐行对应证明及完整原字节 |
| 已对应资产 | 9 | 保留原资产对应证明及原声明 |
| doxygen.css | 1 | 55,162 字节全部固定模板组合对应 |
| Graphviz SVG | 5 | 绑定固定版本工具源码、Doxygen 规则、候选源码及原输出；历史 dot 输入未绑定 |
| 图 map / md5 缓存 | 9 | 完整保留；记录 Doxygen 对图输入文本求摘要的规则，md5 不是 SVG 文件摘要 |
| 剩余 HTML / JavaScript | 63 | 逐文件记录输入、规则路径/符号、配置模板、声明路径、原 notice 和 footer 观察；生成对应 UNVERIFIED |
| 合计 | 106 | 没有遗漏或把源码页证明扩张到整份归档 |

CSS 采用固定模板的 light/dark 设置、主体、scrollbar 及 `htmlgen.cpp`、`util.cpp`、`image.cpp` 的组合/颜色规则。实际匹配配置为 AUTO_LIGHT、HUE=220、SAT=100、GAMMA=80，不含 full-sidebar/treeview 扩展，TIMESTAMP=NO、无使用 build date、无 extra stylesheet。独立 JavaScript 实现固定颜色转换并组合模板，输出摘要为 `sha256:a12445890a4ce321a21a549b820061428edd0f0c57e9edf2028660efdde4c0c0`，与归档全部字节一致。**这证明对应配方，不证明历史有效 Doxyfile；historicalConfiguration=UNVERIFIED，generatorExecution=NOT_RUN。**

五个图为 `graph_legend.svg`、`struct__ExifContent__coll__graph.svg`、`struct__ExifData__coll__graph.svg`、`struct__ExifEntry__coll__graph.svg`、`struct__ExifMnoteData__coll__graph.svg`。账本分别绑定 `dotgraph.cpp`、`dotrunner.cpp`、`dotnode.cpp` 和 legend/class 规则；legend 输入指向固定 legend 实现，其余图指向所保留的 libexif 源码集合。SVG 的 14.1.2 工具标记实际存在，但不能据此识别历史可执行文件、运行环境或输出许可。原始五份 dot 文件缺失，`exactDotInput=UNBOUND`；历史工具身份 UNVERIFIED，实际重生成 NOT_RUN。

剩余 63 文件中，文件页/数据指向对应 `.h/.c`，结构页指向声明头文件，聚合索引指向完整选定源码集合。账本记录 `writeMenuData`、导航树规则以及文件/类/层次索引实现，保留两个剩余 JS 文件中的完整 `@licstart`–`@licend` 原始字节与区间摘要；这不取代已保留的原组件证明。`Doxyfile.in`、configure 和 footer 模板也完整保留。MAINTAINER_MODE 条件下的自定义 PNG footer 与归档 Doxygen SVG footer 分列，历史替换值和有效配置尚未找到；无 footer 的页也按实际观察单列。

## 分发条件与未完成项

以下列出固定原声明及本次可确认的履行事实。原声明全文随新 supplement 保存；工具源码许可不自动成为 CSS、图或其他生成文件的输出许可。

| 对象 | 固定声明与需要核对的条件 | 本次履行/缺口 |
| --- | --- | --- |
| libexif 输入源码 | 各源文件版权头/SPDX、`.reuse/dep5`、`LICENSES/LGPL-2.0-or-later.txt`；正文的源代码复制/修改/分发条件需随实际对象核对 | 选定源码及原版权、完整许可正文保留；输出特定权利和实际对外分发履行 UNVERIFIED |
| Doxygen 实现/模板 | 原 `LICENSE`、源码/模板原声明、`doc/index.dox` 的生成文档说明；核对工具源码复制与生成输出各自条件 | 固定来源与原声明保留；没有用 Doxygen 工具许可统一标记整份输出，也未发行工具可执行文件 |
| Graphviz renderer 源码 | 固定 EPL-1.0 原声明/完整正文，§3 的源代码可取得、随附协议及原版权要求需按实际分发对象核对 | 本次源码片段与完整原声明保留；历史可执行文件未绑定，五图输出许可和分发条件 UNVERIFIED |
| JS 及原资产 | 各文件原嵌入 notice；MIT 等声明要求保留相应版权及许可，适用范围沿原组件/资产证明 | 原九资产、六组件材料和剩余两个完整标记 notice 均保留；没有把组件许可扩张到其它生成文件 |
| 新材料包 | 完整输入/输出清单、原声明、来源回执、摘要和执行位；实际发行还需解决上述输出特定条件 | 本地补充包完整复核 PASS；实际对外分发履行 UNVERIFIED，licensingClosure=INCOMPLETE |

工单尚缺：历史有效 Doxyfile、maintainer 替换与 builder 身份；五份原始 dot 和实际 Graphviz 可执行文件/环境；63 个剩余文件的实际生成对应；输出特定分发条件与实际履行证明。当前没有额外材料路径可供核验，不能从未回复的材料询问推定材料不存在或选择替代路线。取得这些输入后方可补证；如选择新生成候选，需先明确其范围，保留历史候选与全部失败证据。

## 实际验证与复验入口

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TDD CLI 拒绝行为 | PASS：先 red，后 green；4 个新增测试 | `tdd-red-output.log`、`tdd-red-receipt.log`、focused 日志 |
| Node 22.19.0 / 24.19.0 相关 CLI 检查 | 两侧各 13/13 PASS | `focused-node22.log`、`focused-node24.log` |
| 实际禁网材料探针 | 两侧均 PASS，347 文件同一身份；报告除时间外一致 | `final-runs.json`、`parity.json`、两侧 `final-node*/libexif-generation.json` |
| OS 禁网负例 | 两侧 loopback 连接均 EPERM；相同 deny-network profile | network guard 日志和 `actual-runs.json` |
| 同长度许可内容漂移 | 两侧均拒绝 INPUT_DRIFT、exit 1、无补充包输出 | `negative-runs.json`、`license-tamper-*.log` |
| 缺失固定源码 | 两侧均拒绝 SET_DRIFT、exit 1、无补充包输出 | `negative-runs.json`、`missing-source-*.log` |
| 最终 typecheck | PASS | `typecheck-final.log` |
| 仓库 lint | PASS：1,323 文件、0 findings，包含本次已暂存文件 | `lint-final.log` |
| 仓库 Node 测试，全量一次 | 1,546 PASS、5 SKIP、0 FAIL（共 1,551） | `full-node24.log` |
| Web 自动化测试，全量一次 | 92/92 PASS，11 个文件 | `full-web-node24.log` |

禁网使用 macOS `/usr/bin/sandbox-exec`，实际 profile 为 `(version 1)(allow default)(deny network*)`，与正例相同策略的 loopback 负例证明网络请求遭拒。单纯没有调用 fetch 不是本次禁网结论的依据。新 CLI 不需要网络、原生工具安装或外部依赖；固定输入漂移在创建输出前拒绝，stdout/stderr 和负例夹具均保留。

在仓库根目录使用现有 Node 22/24 二进制，将 `$freshOutput` 指向不在仓库/输入内、父目录存在且尚不存在的新目录：

```sh
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' "$nodeBinary" \
  scripts/probes/webui-g2-libexif-generation.mjs \
  LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-docassets-1001-1OShlg/complete-offline-node24 \
  LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-01-1002-xildchgl/frozen-generation-materials \
  "$freshOutput"
```

成功退出仅表示 `validation=PASS_FIXED_CSS_AND_GENERATION_MATERIAL_LEDGER_ONLY`，报告同时保持 `status=PARTIAL`、`issueCompletion=PARTIAL`。已有独立输出不重用或覆盖。CLI 限定单文件 16 MiB、累计读取 64 MiB、清单最多 1,024 项，拒绝符号链接、别名、非普通文件及不安全相对路径。

## 工单逐项结论与出口

| #20 验收项 | 结论 |
| --- | --- |
| 完整 CSS、固定模板/版本/规则和配置 | 固定配方全部字节 PASS；历史配置按要求明确 UNVERIFIED |
| 五图工具、输入、步骤及输出声明 | PARTIAL：工具固定来源/规则已绑定，历史 dot/工具/输出特定条件仍未闭合 |
| 剩余数据及 footer 逐项留账 | 账本 PASS；实际生成对应和历史 footer 配置 UNVERIFIED |
| 保留六组件、九资产、版权和失败报告 | PASS：原 239 文件逐项复核、原报告及失败来源回执保留 |
| 新清单/摘要/执行位/来源，实际离线与拒绝行为 | PASS：347 文件、双 Node 禁网正例及漂移/缺输入负例 |
| 分发条件及未完成项，不越界关闭 | PARTIAL：原声明和条件账本已保留，实际履行 UNVERIFIED；#20 不关闭 |

Standards **PASS**：硬违反 0，Fowler 判断性气味 0。Spec **PARTIAL**：3 项已记录的材料缺口（五图、剩余生成对应、分发履行）；范围扩张 0，可证实的实现错误 0。两位只读探子的审阅快照为 `review.diff`，SHA-256 `16d4589e82bf992319c382e6ff7360deda8a05810df532ef822761f66d645751`。Spec 轴为静态审阅，运行回执读取未完整完成；禁网和保护检查的运行结论由主代理核对实际数组结构、报告与日志，不能借静态审阅补成运行证据。审阅后只补记本段结果、修正证据导航和未提交本地草稿链接，代码/合同/测试字节未变。

最终保护检查 PASS：实施开始时已有的 241 个脏工作树文件，字节、大小和权限全部不变；暂存前 index 为空，最终暂存范围仅本次四个新增文件。检查结果与提交身份保存在 `$runRoot/final-protection.json`、`closeout.json`。当前材料子集结果不增加产品 Task 验收数：20/44 保持，G2-00-02 PARTIAL，整体 F02/G2-00 未通过，Full NOT_RUN，U2 BLOCKED。上游生成程序、native 应用构建、Full 安装、真实 Provider、浏览器和日常晋升本轮均 NOT_RUN；仓库全量测试 PASS 不替代这些门禁。
