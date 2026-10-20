# U0 文档解析实验与未闭合项

日期：2026-09-26；09-29更新。U0-04 **进行中，发行闭包与剩余边界待补**；G0-03仍FAIL。文档现为67项回归、10项容量及worker断网通过，部分解析/来源合同已补；图片候选Node22/24各37 PASS、各23个派生PNG经Pi公共入口字节不变。原生来源已固定，许可/Full仍缺，见[文档新验收](2026-09-29-webui-u0-document-coverage-acceptance.md)、[图片验收](2026-09-29-webui-u0-image-compat-acceptance.md)及[Full接入清单](2026-09-29-webui-u0-parser-full-integration.md)。下文保留前轮历史；独立资源包不等于Full发行验收。实验代码：[文档](../evidence/2026-10-18-local-development-history.md#local-09a4f6ca9c34694e)、[图片](../evidence/2026-10-18-local-development-history.md#local-f1c707d5ef328256)、[公开Office语料](../evidence/2026-10-18-local-development-history.md#local-4a6e8e5a9e48de24)、[资源包](../evidence/2026-10-18-local-development-history.md#local-726eaca9bc7428d1)、[断网](../evidence/2026-10-18-local-development-history.md#local-30af436d2533866e)。

## 候选依赖

| 依赖 | 精确版本 / 许可证 | 实验用途 | 成本与边界 |
| --- | --- | --- | --- |
| pdfjs-dist | 6.3.289 / 主包声明Apache-2.0，附带资产混合且未闭合 | PDF逐页getTextContent | npm元数据约34.8MB未压缩；Node要求22.13+或24+；可选canvas未装，文字样例可解析，不能声称渲染/OCR正常 |
| yauzl | 3.4.0 / MIT | lazyEntries流式读取OOXML ZIP | 约110KB，另依赖pend；验证entry size仍需统计实际解压字节与总预算 |
| saxes | 6.0.0 / ISC | 严格XML解析 | 约164KB，另依赖xmlchars；主动拒绝DOCTYPE，不跟随外部关系 |

来源：[PDF.js源码](https://github.com/mozilla/pdf.js)、[PDF.js参数文档](https://mozilla.github.io/pdf.js/api/draft/api.js.html)、[yauzl](https://github.com/thejoshwolfe/yauzl)、[saxes](https://github.com/lddubeau/saxes)。版本、engine、许可证和完整性由本次npm元数据/隔离package-lock再次核对，不以搜索摘要替代。

依赖仅装在仓库外U0实验目录，`ignore-scripts`、不装可选依赖、独立npm缓存和配置路径。**未更改根package.json/package-lock或日常栈**。源码解析路径显式传入，不借开发node_modules冒充Full安装能力。

## 已验证

四种格式各正常/损坏/超限，共12项：PDF两页ASCII；DOCX中文段落和表格；XLSX文字、数值和带缓存的公式；PPTX两页中文标题。来源包括PDF页码、XML part、段落、单元格地址；XLSX公式输出缓存值且明确未计算。

另7项：ZIP实际展开字节限制、ZIP越界路径、DOCTYPE拒绝、ZIP条目数、超时终止、RSS超过缩小测试阈值后回收子进程、可执行文件缺失时的启动失败回收。每次独立worker，候选Node实际运行；所有worker退出或未启动；安全负例断言具体错误，不让无关worker失败冒充路径防护成功。

本次续推增加11项：重复ZIP entry、宏二进制条目、畸形XML、DOCX无正文、旧DOC/XLS/PPT三种类型拒绝、ZIP加密标记、输入大小恰好/多1字节、CDATA文本保留、PDF无正文。加密标记用例不是实际Office加密容器兼容性证明，空PDF不是扫描件理解证明。修复CDATA被漏读与PDF无正文可被误判成功的分支，并用独立用例复验。

后续新增9项，文档共39项：DOCX嵌套表格层级坐标、PPTX声明顺序、XLSX声明顺序/表名、外部/越界关系拒绝、空与富文本shared strings、真实2MiB文本恰好/超1字节、真实20MiB输入超1字节。关系只解析到包内已存在part，禁止外部访问；不再以文件名排序代表工作表/幻灯片顺序。PDF内部解压量仍不受ZIP的expandedBytes限制，必须另验压缩流与worker边界。

上限默认仍为计划值：20MiB文件、200MiB展开/10k条目、2MiB文本、200页PDF/200幻灯片/200k单元格，30秒/512MiB。2MiB文本恰好/超限与20MiB输入超限已用真实字节数测试，其余缩小阈值负例**不是最大值的容量证明**。RSS每25ms采样存在过冲，Node heap上限也不等于进程总内存硬隔离。

## 新增真实资源证据

- `images-1.json`、`images-node22-1.json`：复用H已带的Photon0.3.4（Apache-2.0），PNG/JPEG/WebP均真正解码到192个RGBA像素；各有损坏/像素超限负例，加默认40MP拒绝与有效头/坏载荷。Pi公开resize入口先解码后缩放，不能当解码前像素门禁。本实验先用pi-tui尺寸读取拒绝超限，再在独立worker调用Photon并核对真实尺寸；伪造头部不是48MP容量证明，也不是防WASM漏洞的OS沙箱。方向/动画/缩放/模型传递仍待U2。
- `office-corpus-4.json`及`office-corpus-node22-1.json`：4个完整公开OOXML包，附内容摘要与许可证。其中3个正文提取通过，另一个实际为空的PowerPoint包明确返回NO_TEXT。生成器元数据分别声明Word、LibreOffice、Macintosh PowerPoint；不等同于本机这些应用打开验收。初次DOCX因嵌套表格失败，补实现后通过；初次PPTX预期错误，检查原XML确认确实是空slides后保留作负例，另加含表格的正常样例，没有把空文档冒充成功解析。
- 固定来源：[python-docx语料](https://github.com/python-openxml/python-docx/tree/e45454602b53e8e572b179ccf1c91093ec9f4ed7/features/steps/test_files)、[ExcelJS LibreOffice语料](https://github.com/exceljs/exceljs/tree/5bed18b45e824f409b08456b59b87430ded023ab/spec/integration/data/hidden-test)、[python-pptx语料](https://github.com/scanny/python-pptx/tree/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/features/steps/test_files)。三个仓库MIT许可已随样例保留。探针校验固定SHA-256，不能仅凭URL和长度信任缓存。
- `parser-package-3.json`：5个依赖及全部许可，共592个文件、35,134,944字节，打包解包逐文件摘要一致，候选Node24在干净目录加载后39项文档检查通过。**网络未禁用或测量，不能据此称离线验收。** 未修改根依赖、Full pack-content/SBOM、日常栈；Full资源闭包与真正断网验证仍缺。
- 第一次资源打包因saxes6.0.0 npm包缺许可证正文失败，补入[该版本上游完整许可](https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE)的独立notice后通过；没有修改既有node_modules或删许可证检查。完整许可文件与摘要在资源包清单中保存。
- 独立只读复核还补强缓存SHA-256和损坏/超限的精确错误断言；不允许TIME_LIMIT/MEMORY_LIMIT冒充PAGE_LIMIT等。早期报告保留，最终Node24文档结果见资源包内`extracted-documents.json`，Node22见`documents-node22-2.json`。

## 必须完成后才能通过G0-03

1. 对完整语料补精确正文/位置期望与更广生产者差异（页眉/页脚、严格OOXML、文字型PDF字体等）；当前4个公开包与合成回归不是完整兼容性证明。
2. 明确支持/部分解析范围，补PPTX表格位置、DOCX外围正文来源与XLSX不支持对象提示；不能静默漏读后宣称完整。
3. 图片解码基础检查已补，但真实最大像素容量、动画/方向与不可信解码内存边界仍未冻结；不以头部负例替代容量实验。
4. 宏/旧版/重复/畸形/空正文基础负例已补；真实加密容器、总材料50MiB/10个、PDF压缩流与其余生产最大预算仍需覆盖。
5. 明确独立worker内存承诺：采样回收与硬边界分开；实际内存峰值及Host响应不退化，不能把`--max-old-space-size`写成512MiB OS沙箱。
6. Node矩阵和独立资源目录加载已补；仍需真正断网、Full发行许可证/资源/SBOM/打包白名单闭包。需要新的Full候选时先核对磁盘预算，不清理用户数据。

本机未发现LibreOffice/Word/Excel/PowerPoint应用，未安装这些应用或读取用户私人文档。新增内容来自上述公开固定提交语料，下载体积合计约67KiB（另含许可）。本轮不以局部测试数量关闭缺口，不提前把实验adapter接到产品上传入口。

## 09-29缺口更新

上述第3项已由真实载荷验证出容量失败，不能再仅记未运行；第6项中解析worker断网已通过（父驱动/RSS监控在沙箱外），Full闭包仍未完成。200页/200张/20万单元格/1万条目/200MiB展开的恰好及超限共10项通过，缩小阈值不再是这些边界的唯一证据。其余支持范围、位置、批次材料、PDF流、图片适配和Full事项仍保留，详见最新验收表。

### 图片候选最新进展

Photon失败已定位到解码阶段worker RSS；隔离Sharp 0.35.5（Apache-2.0）归一化候选，40MP原图转2048长边派生图，在Node22/24各6项容量检查PASS，原件前后摘要不变。候选需要平台native可选依赖，不能沿用上文文档解析包的“无可选依赖”结论；libvips许可、兼容性、质量合同和Full仍缺。原始全分辨率输出路线未通过，G0-03仍FAIL。见[完整研究与失败证据](2026-09-29-webui-u0-image-memory-study.md)。

随后补实际编码PNG/2000长边候选：两Node各37项通过，含编码、透明、EXIF2–8、动画拒绝、损坏/体积/真实像素负例及40MP合成截图；正常派生PNG各23个经真实Pi公共resize/read保持字节。资源包及两Node断网加载通过，第三方完整许可与Full仍缺，其他文档范围不撤销。发送预览/原件与历史快照合同已补，但产品上传、RPC、真实模型与任意图片质量不在本轮结论中。见[候选验收](2026-09-29-webui-u0-image-compat-acceptance.md)。

### 文档部分解析与来源最新进展

主正文引用的DOCX页眉/页脚/脚注/尾注已可提取，保留partKind、noteId、段落及tablePath；未引用外围part只提示不注入。PPTX表格物理坐标/换行及表后复位通过，合并标记提示；XLSX无缓存公式与图表/嵌入对象等提示，混合空页/表/幻灯片标partial。raw styleId/outlineLevel不冒充实际标题/页码。Strict命名空间三个文字子集合成样例通过，不是全规范或所有生产者兼容。

初轮新增19项；只读复核后再增9项并实际复现6个失败断言，修复DOCX连字符、XLSX注音/共享公式与预算、PPTX默认合并属性误报。最终原39＋新增28=67项，两Node均通过；实际解析worker断网各另1项。10项真实默认容量重新通过，最大采样RSS分别391792/448208KiB；公开Office4项无回归且补完整blocks/status/warnings/coverage留证。结果版本、partial/coverage、发送前异常处理与快照合同已补。前述“必须完成”第2项已有本批证据，但主part重定位、更多生产者/字体、批次/PDF流/真实加密与Full仍保留，不能将整组缺口一并关闭。

native来源提交与28项版本精确匹配，libnsgif vendored许可原文已定位并归档；完整第三方文本、最终Rust lock/patch/source对应材料仍未取得。见[本批证据与局限](2026-09-29-webui-u0-document-coverage-acceptance.md)。Full连接面分F01–F06记录为U0-04内部工作，不虚增Task数或调用当前脏repo的默认staging。

### 实际npm获取与PDF资产最新进展

11个实际包精确tarball已核对SHA-512/实测SHA-256及完整资源内容、目录和可执行标记；19个随包license/notice文件列入快照。Saxes缺失的发布包LICENSE已与固定commit/blob的3011字节原文对应。PDF354资产中196可定位文本/头部、158仍未解决；Liberation随包旧GPLv2文本不能替换成现代OFL，字体/WASM源码义务也未关闭。两Node的实际168 CMap＋8 SVG头部检查、最终31项定向矩阵和无网络只读复验均通过。

native29库完整材料与patch/最终Rust lock/source对应仍缺；一轮Node24 owned-group断言30/31失败保留OPEN，新组9/9和最终串行31/31不解释或覆盖该失败。默认Full未接线，Full NOT_RUN，G0-03仍FAIL、U0仍5/6。新实现、上游证据、信任范围及下一项见[本批验收](2026-09-29-webui-u0-acquisition-acceptance.md)。

### 固定源字节与回收补强续推

新增PDF158项对应80个固定源路径/blob，实际F01 SHA-256/长度与官方目录blob逐个一致；不再笼统说这158项“来源都未知”，许可及QuickJS精确构建输入仍未闭合。另保存三库5份许可全文、librsvg初始lock和PR383两份固定提交候选patch；它们不等于最终lock或历史浮动patch响应。

已捕获新负例中的真实EPERM（受控时钟前跳、非合成errno），修复Date.now等待与立即抛弃有界复查的问题，补统一异常详情/发信号前未知拒绝。双Node各45项相关回归与9例真实新组通过；旧30/31回执不足以确定原归因，仍OPEN_UNATTRIBUTED，不以新通过覆盖。实际材料只读复验通过，Full NOT_RUN，U0仍5/6、13/44。精确证据、状态与下一项见[最新验收](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)。
