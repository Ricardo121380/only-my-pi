# G2-00-02：libexif 固定文档归档与资产材料绑定

日期：2026-10-01。**本批完成固定归档的受限解包、19个源码展示页与固定头文件的对应、9个Doxygen资产对应、6个拼接组件声明与指定一手材料的绑定；限定材料子项PASS。G2-00-02整项仍PARTIAL，完整许可INCOMPLETE、F02/F03 PARTIAL、Full NOT_RUN、U2入口BLOCKED，产品仍20/44。** 不是整个HTML文档重生成、许可合规意见、native构建或WebUI功能验收。

依据：[上一批逐输入notice清单](2026-10-01-webui-g2-00-notice-inventory.md)、[内部顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)。本批只加独立补充材料，不覆写locale kit、旧原包/报告或日常安装。

## 1. 本批Task与实际出口

| 内部子项 | 已核实结果 | 不包含的证明 |
| --- | --- | --- |
| 固定文档归档 | `exif/doc/libexif-api.html.tar.gz`为240682字节；SHA-256、执行位与当前源清单对应；受限解包107条目、106常规文件、1322485展开字节 | 不证明历史tar/gzip时间戳、完整生成环境或归档重建 |
| 实际生成版本 | index元数据和生成声明为Doxygen 1.16.1，API版本0.6.26；不是配置模板首行的1.8.13 | 版本字符串本身不证明具体二进制身份、签名或原builder |
| 源码展示对应 | 19页、1353条展示行；只隐藏Doxygen文档注释、展开8列tab和忽略行尾空白后，与固定头文件逐行对应；814条未展示行均为空白或被隐藏的文档注释 | 不等于所有API正文、提示卡、图或60份HTML都重生成/语义核验 |
| 指定通用资产 | 6文件原字节相同；clipboard/navtree/logo另3文件经明确固定字面量替换后全部字节相同 | 不推定CSS完整组合、剩余生成数据文件或Graphviz输出已复现 |
| 嵌入第三方材料 | jquery.js实际拼接6组件；保留完整原包声明，取得5个版本标签对应的许可全文及Touch Punch固定历史源码 | 不证明5份上游minified代码分别等于原发布产物；不替Touch Punch选择双许可分支 |
| 独立补充材料 | 28个候选来源重新核验；30份固定公开材料及原始获取记录冻结为103输入文件；最后239文件supplement完整复制/重核 | 不更新kitId/stackId，不合入默认stager、F03/F04或发行输出 |

解包复用[已有受限实现](../../packages/release-stack/safe-extract.mjs)，本批探针限制200条目、2MiB展开；归档及输入先核摘要。解包后拒绝链接/特殊文件并核完整文件集合、字节与模式。106文件为60 HTML、28 JS、3 CSS、6 SVG、5 MD5记录和4 map；未执行JS、打开HTML、运行Doxygen/Graphviz或上游Shell。

固定归档身份：`sha256:262a4dc93400f0a9f8860b4d3462c06f6b4ab0f80857cfba1131a66a87090a34`。解包文件清单身份：`sha256:a84bbf80d803feb0a9d74ca340250c8b9944611d58b8103eb6cf8d84cfb8390f`。

## 2. 来源与许可范围：保留原文，不自动推广

Doxygen官方`Release_1_16_1`为annotated tag对象`056601be67714a5b579465f384fcdb3b9b6779cf`，解引用到`669aeeefca743c148e2d935b3d3c69535c7491e6`；固定VERSION、树元数据和取到的30份公开原文核验Git blob、字节数及SHA-256，不声称签名已验。[官方ref](https://api.github.com/repos/doxygen/doxygen/git/ref/tags/Release_1_16_1)、[固定提交](https://github.com/doxygen/doxygen/commit/669aeeefca743c148e2d935b3d3c69535c7491e6)。

生成器自身GPL v2全文与其生成输出声明分开保存：固定`doc/index.dox:136–137`说明生成文档源自其输入，不受生成器该许可影响；这不删除输入文档或嵌入JS自身的声明，更不把整份归档改标为MIT、GPL或库LGPL。[固定输出声明](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/doc/index.dox#L136)、[固定GPL全文](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/LICENSE)。

| jquery.js中的组件 | 实际标记/固定来源 | 保存与限制 |
| --- | --- | --- |
| jQuery 3.6.0 | 原文件:1；版本提交`0cc1ad64ab0f482c13d6edd2a5226f309dd00006` | [原LICENSE.txt](https://github.com/jquery/jquery/blob/0cc1ad64ab0f482c13d6edd2a5226f309dd00006/LICENSE.txt)；保留OpenJS署名，不另编版权年份 |
| jQuery UI 1.13.2 | 原文件:91–94；版本提交`d6c028cc2e214a4f9f3a787313ef03a17a33a008` | [原LICENSE.txt](https://github.com/jquery/jquery-ui/blob/d6c028cc2e214a4f9f3a787313ef03a17a33a008/LICENSE.txt)；demos的CC0和external/node_modules自有许可范围仍保留，不能把CC0推广至UI脚本 |
| scrollTo 2.1.2 | 原文件:132–137；版本提交`d33ae4515be21a76bb7907c94dd8a0ca0de7e49b` | [原LICENSE](https://github.com/flesler/jquery.scrollTo/blob/d33ae4515be21a76bb7907c94dd8a0ca0de7e49b/LICENSE)；原bundle标2007，全文标2007–2015，二者都保存，不改写统一年份 |
| PowerTip 1.3.1 | 原文件:141–146；版本提交`90225c403c8246a0f154f0c0d6a02326d9cd3f4a` | [原LICENSE.txt](https://github.com/stevenbenner/jquery-powertip/blob/90225c403c8246a0f154f0c0d6a02326d9cd3f4a/LICENSE.txt)及2018原署名 |
| Touch Punch 0.2.3 | 原文件:167–176；历史源码提交`8f7559b6e65cdc3ee3648d5fe76d38c653f87ff5` | [固定min源码](https://github.com/furf/jquery-ui-touch-punch/blob/8f7559b6e65cdc3ee3648d5fe76d38c653f87ff5/jquery.ui.touch-punch.min.js)；检查到的tag列表为空、固定根目录无独立LICENSE。原MIT或GPL v2双许可完整保留、选择UNDECIDED，不假造版本标签/独立全文 |
| SmartMenus 1.1.0 | 原文件:178–180；实际标签`1.1.0`，提交`9a73dd16049c8ac0b000d0c7b23b47defed61015` | [原LICENSE-MIT](https://github.com/vadikom/smartmenus/blob/9a73dd16049c8ac0b000d0c7b23b47defed61015/LICENSE-MIT)；先前猜测`v1.1.0`的404仍在收据中 |

整个jquery.js与固定Doxygen模板原字节相同。Touch Punch段另外与历史min源码精确对应，只有3处明确换行变换：合并注释末尾换行、在已指定unbind参数位置插入换行、追加末尾换行；不是任意去空白或执行minifier。没有把路径历史“最近修改提交”称作原发布提交。

其他材料分别保存：clipboard原文保留jothepro 2021–2022 MIT全文；dynsections/menu/navtree原文保留Dimitri署名与MIT全文；cookie保留2023署名/MIT声明；未用一个合成notice替代所有原文。[固定clipboard](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/templates/html/clipboard.js)、[固定navtree](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/templates/html/navtree.js)。

libexif的完整头文件、Doxyfile模板GPL声明、Makefile/footer/README各自范围及`.reuse/dep5`均保留；dep5只作用于所列路径，不能套到整个HTML归档。GNU Library v2全文、COPYING中的Lesser v2.1和GPL v2各自保存，不用COPYING文件名消除头文件的LGPL-2.0-or-later声明。

## 3. 可复现的静态对应与未关闭项

- 原字节对应：jquery.js、cookie.js、dynsections.js、menu.js、navtree.css、tabs.css。
- clipboard仅替换1处标题；`htmlgen.cpp:1297–1301`及`translator_en.h:2604–2607`提供固定规则/英文值。navtree仅替换1处PROJECTID为空及3处TREEVIEW_WIDTH为250；`ftvhelp.cpp:855–862`提供规则。logo只替换5处明确颜色标记，其他字节相同；`resourcemgr.cpp:100–110`和`util.cpp:5806`起的颜色替换规则保存，但没有运行HSL算法或证明历史配置。[固定clipboard输出规则](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/src/htmlgen.cpp#L1297)、[固定navtree输出规则](https://github.com/doxygen/doxygen/blob/669aeeefca743c148e2d935b3d3c69535c7491e6/src/ftvhelp.cpp#L855)。
- 源码页只核实源码行。两种实际fold包装被窄识别；尾部提示卡完整保留并受全页摘要约束，但不作为源码行/API正文证明。普通版权/许可注释不被投影移除；未知源码行标记、非注释代码缺行、代码差异仍失败。
- `doxygen.css`保留完整55162字节，light/dark/scrollbar模板和`htmlgen.cpp`组合规则另存；完整组合/历史配置/重生成仍NOT_RUN。
- 5个图SVG标注Graphviz 14.1.2 (0)。原SVG、map、MD5均保留；固定Graphviz来源、图输入和生成过程尚UNBOUND，不据此给生成图指定许可证。
- 观察到默认Doxygen SVG footer，与保留的libexif自定义PNG footer不同；历史maintainer条件/具体配置仍UNVERIFIED，不伪造实际Doxyfile。
- 其余生成页/索引数据、GIR原供应包/版本/加工链/手册引文、其他生成输入、最终分发义务和source/build/binary对应仍待收口。

## 4. 实现与实际验证

新增[固定配方](../evidence/2026-10-18-local-development-history.md#local-04d05abb68265073)、[窄静态对应helper](../evidence/2026-10-18-local-development-history.md#local-f57cf034904e70a2)、[离线材料探针](../evidence/2026-10-18-local-development-history.md#local-a56facf825f530fa)、[9项回归](../evidence/2026-10-18-local-development-history.md#local-8ccffca555cc2dca)。复用safe-extract、verifyGeneratedFile及已有有界公开读取能力；无新依赖、通用文档/许可证判定器或默认发行接线。

探针输入为规范绝对路径的kit、冻结公开材料根和全新output；已有/嵌套/祖先output、链接/别名拒绝。单文件16MiB、读取64MiB预算；实际累计读19911154字节（含复制后的重核），不是独立输入的净大小。28个选中源重核，不冒充全29336源重新核验。输入/摘要检查先于创建output；解包/对应失败留下PARTIAL报告，不覆盖旧输出。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 定向自动化 | Node22.19.0、24.19.0各9/9 PASS、0 FAIL/SKIP；1测试文件 | `tests-node{22,24}.log`、`validation-summary.json` |
| 实际OS禁网 | 两Node材料探针PASS；同策略loopback连接EPERM，未把默认可联网环境当禁网 | `complete-offline-node{22,24}/libexif-doc-materials.json`、`network-guard-node{22,24}.log` |
| 双Node一致性 | 只删除`at`后报告完全一致，239文件补充身份相同 | `parity-and-negatives.json` |
| 实际版权漂移负例 | 在独立副本同字节长度修改OpenJS署名，两Node均exit1、输入摘要漂移拒绝、output未创建 | `copyright-tamper-fixture/`、`tamper-negative-node{22,24}.log`；不是语义许可解析器测试 |
| 原输入保护 | 4项kit元数据、28个选中源和冻结原版权不变；HEAD/分支/日常指针保留 | `baseline.json`、`closeout.json` |
| Full/浏览器/模型/native构建 | NOT_RUN；本批不是产品集成验收 | 不继承U0/U1旧结果 |

首次颜色投影发现两个十六进制字母标记未涵盖；按完整原文补成5个固定替换，保留`svg-initial-color-projection-failure.json`。首次实际探针因fold/提示卡布局拒绝，随后识别两种已见fold包装、将提示卡与源码证明范围分离；`initial-offline-node22/`、`reviewed-offline-node22/`失败报告保留。一次命令引号错误发生在Shell解析阶段、未创建指定输出；不列为探针PASS。

Node24默认使用spec报告，首次自动读取TAP计数字段产生null；原`validation-runs.json`保留，`validation-summary.json`据实际保存的两种日志逐项核9/9。未为格式问题重复跑无关测试或借用上批25项计数。

补充包身份：`sha256:34c1a90f44e896943ce2043b23a6d07041eb9afb995f91f3c51aa7259a94ed80`。去除时间后的报告身份：`sha256:47b73376fc0aa93627d3c2df84b140b6157483cfdb618dc33ec0a9cda9957e5a`。这些不是kitId、stackId、新dylib或完整许可证明。

## 5. 证据与下一Task

证据根：`artifacts/webui-optimization/G2-00-docassets-1001-1OShlg/`，checkout外、非日常prefix。

- `baseline.json`、`extraction.json`、`extracted-inventory.json`：本批1485文件基线和第一次有界解包；`initial-source-lines.json`是初次未覆盖链接行号的1297行结果，最终1353行以投影报告/实际探针为准，不删初稿。
- `doxygen-official/`、`doxygen-assets-official/`、`doxygen-fixed-assets/`、`jquery-license-origins/`、`notice-additional-official/`、`last-component-origins/`、`doxygen-navtree-rule/`：全部原HTTP响应和收据，包括两个tag假设404与“navtreedata不是静态模板”的初次缺口。
- 主线程实际61次公开GET、1162934响应字节，无认证/跟随重定向/自动重试；只访问任务所需一手公开材料。探子的独立读取不并入此计数。两个较宽探子催收后仍无终态已中断，不作为来源证据；新派单轮窄探子提供官方固定ref/commit与GPL输出条件，主代理亲核原材料并完成实现/验收。
- `frozen-public-materials/`、`freeze-receipt.json`：103输入文件、30份材料，源正文/Git对象/原始收据完整保留；复跑只读取本地，不再联网。
- `complete-offline-node{22,24}/`：各239文件supplement及实际最终报告；原kit、前批Windows/生成/notice补充包不变。

复跑：固定Node运行 `scripts/probes/webui-g2-native-libexif-docs.mjs <locale-kit> <本批frozen-public-materials> <全新output>`，三参数均为规范绝对路径。离线复验须使用本次实际OS禁网策略并另核策略生效，不能只以脚本无fetch推断禁网。

**下一Task仍为G2-00-02：先补Doxygen CSS组合及Graphviz资产必要来源/输入/声明，再追回GIR供应版本、固定加工链与手册引文；其余生成输入和分发条件不得静默豁免。** 审阅后的各批补充材料合入候选时须形成新kit身份，原locale kit保留。G2-00-02材料闭合后才G2-00-03及新候选/F01/F03–F06；全部门禁PASS才U2-01，不进入Electron。

`research`限制本批来源为固定一手材料；`lean-coding`使实现仅覆盖固定字节/窄投影和输出保护。未修改全局配置/根依赖/默认stager、清理用户产物、切日常安装、启动服务、调用收费模型、发布或浏览器验收。
