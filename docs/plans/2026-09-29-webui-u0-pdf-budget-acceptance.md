# U0 PDF累计展开预算与技术收口

日期：2026-09-29。**按用户批准的阶段调整，U0技术验收完成：6/6 Task，总计14/44。** G0-03只关闭选定解析方案的技术可行性；完整发行材料、默认Full接线和断网安装由U2入口G2-00继续强制阻断。不是WebUI全功能、产品附件、Full或日常安装验收。

依据：[已确认顺序](2026-09-29-webui-parser-gate-adjustment.md)、[解析合同](2026-09-26-webui-u0-contracts.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)、[新身份审阅](../evidence/2026-10-18-local-development-history.md#local-4668305eeffd23cf)。旧F01/F03、原FAIL/PARTIAL及来源报告保留，不改写历史。

## 本批实际改动

- [预算构建器](../evidence/2026-10-18-local-development-history.md#local-3dffbfa6c782c1cd)：验证PDFJS6.3.289的完整worker SHA-256和26个唯一锚点，只在新实验目录生成带上游许可头的副本，不编辑安装依赖。上游版本/字节漂移即失败，没有未补丁解析回退。
- [文档探针](../evidence/2026-10-18-local-development-history.md#local-09a4f6ca9c34694e)：先加载唯一已校验worker，再加载API；每份文档独立200MiB累计预算。metadata、每页、异常恢复、destroy完成后都核对不可逆越界状态；失败不返回任何正文。
- [真实解码与PDF夹具](../evidence/2026-10-18-local-development-history.md#local-784e7e4c2cef56d3)：实例化上游Flate/LZW/ASCII85/Hex/RunLength/Predictor/Brotli类，并用有效xref、压缩流及Filter数组检验完整PDF路径，不回显测试输入作为“实际计数”。
- [离线驱动](../evidence/2026-10-18-local-development-history.md#local-30af436d2533866e)：同时复制三个源码文件并保存摘要，实际parser worker系统禁网；加入预算专项。普通报告也绑定三份源码摘要和依赖realpath。

预算策略`u0-pdf-decoded-stage-high-water-v2`。原worker SHA-256为`df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b`；本批派生worker为`6d5799d356ce58fd294e893e230d446b07f765fea1d2277a0076e208644c09a2`。完整四文件源码摘要与报告摘要在审阅JSON中。

计数口径：每过滤阶段真实产生的逻辑输出高水位，共享一份文档预算；多层过滤累加，真实重建的stream再次计数。缓存reset/peek/read与同对象native Promise复用不重复收费；容量、缓冲复制、流拼接与解密副本不是新的展开输出。失败native已经产出的字节不退款，JS回退新产出继续计数。越界先置位，再抛错，不能被PDFJS的NullStream/字体/文本恢复路径放行。

为消除扩容复制峰值，固定Node22/24的同步缓冲及native分块输出使用可扩容ArrayBuffer；native不同时保留全部chunks和另一份合并输出。只核验这两种Node，不据此推广其他平台或将RAB标为通用产品适配已完成。单文件20MiB、批次50MiB/10项、文字2MiB、30秒及512MiB采样门槛未提高。

## 最终验证

证据根：工作区仓库外`artifacts/webui-optimization/U0/pdf-budget-0929-Etg8Xj/`。所有报告用新文件名/`wx`，未覆盖失败。

| 范围 | Node22.19.0 | Node24.19.0 | 证据 |
| --- | ---: | ---: | --- |
| 断网文档回归 | 68 PASS | 68 PASS | `matrix-3GZYZh/offline-B1Pngy/regression.json`；`matrix-fy88Xd/offline-vIY8XX/regression.json` |
| 实际默认容量 | 11 PASS | 11 PASS | 同目录`capacity.json` |
| 加密/Flate/批次先验 | 17 PASS | 17 PASS | 同目录`boundaries.json` |
| PDF预算专项（含worker禁网负例） | 56 PASS | 56 PASS | 同目录`pdf-budget.json` |
| 公开Office固定语料 | 4 PASS | 4 PASS | `office-3WGq2F/report.json`；`office-xyZsT2/report.json` |
| 文档矩阵最大采样RSS | 392512KiB | 435200KiB | 低于524288KiB，不是瞬时/内核硬上限 |
| 单页native实际200MiB成功 | 330720KiB / 807ms | 377376KiB / 867ms | 输出文字、完整计数、实际native chunks与无回退均断言 |

各152条文档/预算检查是解码控制、静态身份负例与完整文档路径的合计，**不是152次完整PDF解析**。两个独立联网基线均CONNECTED；worker及后代的真实连接均EPERM。RSS监测父进程在沙箱外，25ms采样；全部实际worker等待close、所有本批受管命令组退出。最终汇总`matrix-1790693596312.json`和`office-1790693703182.json`保留运行回执；Office只用既有公开缓存，fetch调用0，不把其fetch替身当系统禁网证明。

预算专项覆盖：Flate stored/fixed/dynamic；ASCII85完整/短尾/零压缩；ASCIIHex奇数尾；RunLength两分支；LZW两种earlyChange与词典路径；TIFF及PNG Predictor双阶段；Brotli JS。Node22无native Brotli，明确验证实际JS回退；Node24 native Brotli实际进入并产出chunk。native超限负例断言已进入/产生字节且未回退；另用坏zlib checksum验证partial native＋JS两次实际产出的累计与越界拒绝。

端到端覆盖：合法ASCII85→Flate双过滤exact/+1；两页累加；单流与单页native实际200MiB/+1；50×4MiB完整PDF实际200MiB/+1并核对每页文字/位置；共享Contents引用重新解码计两次；同一child串行两份各120MiB文档在destroy后独立复位；错误恢复后已有正文也不能返回。

## 失败、核验与修正

- `budget-first-RoNnpU/report.json`保留：同步单流200MiB扩容复制被RSS拒绝两项，以及错误要求Node22 native Brotli的一项。先修RAB扩容，再按真实能力区分路线，未放宽容量/内存或默换库。
- `budget-second-*/report.json`各46 PASS保留，不当最终覆盖。两名默认角色、`fork_turns=none`探子只读单轮，主代理等终态后收敛；指出单页native、合法Filter数组、共享引用、串行复位、native负例路径证据和control过早send的缺口，已由主代理补齐实现/测试。
- `budget-third-4grH5l/report.json`保留：原测试误把相同对象引用当缓存；该固定上游`XRef.fetchUncompressed`不缓存BaseStream，实际native attempts=2。按实际新解码计数补exact/+1，而不是按对象ID去重或修改上游来掩盖实际产出。
- `budget-fourth-*`两种Node各55专项PASS，再由当前同摘要源码完成最终系统断网矩阵。本轮主代理核验、实现和最终验证；探子没有改文件、追派或代做验收。

## U0收口与未晋升的边界

`baseline.json`重新逐文件比较1232个原有非文档源码，与S0 H候选相同，S0八项有效；日常active仍`7444c7fb…`，用户Glacier审计+8/-0及摘要保留。U0设计、Pi协议、资源配置、固定预览配方复用其未变化的范围证据，见[U0进展](2026-09-26-webui-u0-progress.md)。图片继续引用原每Node37项与Pi入口字节检查，**本批未重跑图片或浏览器**。预览故障原总报告PARTIAL只支持已核验PoC子集，不提升为生产预览通过。

技术上限仅证明固定版本的选定文字/图片路径：不承诺所有PDF字体/CMap/生成器、OOXML完整合规、图表、扫描件、内部image/WASM分配或产品并发池。`isEvalSupported`在该API中不存在，已移除无效参数；不把它当安全开关。无渲染/OCR/动作API调用，网络边界独立实测。U2还须明确完整资源URL、兼容语料及稳定的产品错误/快照身份，不能直接把实验临时路径存为产品来源。

**后续强制项**：F01按新探针/派生worker/辅助模块更新资源身份，完成F02对应源码/许可/固定构建闭包、F03默认接线、F04 ledger/双SBOM/notices/最终内容、F05隔离Full断网安装、F06发行核对，才G2-00 PASS、开始U2产品集成。来源不可闭合则固定源码/工具链重建新候选并重验，不猜填旧历史；[发行实施清单](2026-09-29-webui-u0-parser-full-integration.md)仍有效。旧回收归因OPEN_UNATTRIBUTED不抹除。

未修改生产路径、根依赖声明/lock、全局配置、日常安装或旧资源合同；无收费Provider、公开发布、提交、浏览器空间替换或清理。下一批U1-01：Host持久草稿/输入/队列Schema与原子存储，仍按逐Task实现和验收，不进入Electron。
