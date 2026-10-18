# U0-04 F02：PDF 全资产字节来源与构建输入分层

日期：2026-09-29。**新增196项资产＋10份附带许可文本的固定PDF源树字节对应PASS；保留前批158项后，354项资产全部有固定源树对应。保存33份构建说明/候选原文，并核对ICC更上游原件及CC0文本。完整编译输入与发行义务仍PARTIAL，G0-03仍FAIL，U0保持5/6、13/44。** 不进入U1/Electron，不切日常版。

## 1. 本步交付与证据层次

继续[Full内部清单F02](2026-09-29-webui-u0-parser-full-integration.md)，不重查[前批158项](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)或[native25源pin](2026-09-29-webui-u0-native-materials-acceptance.md)。主代理使用research核对一手材料、lean-coding复用已有reader/资源边界；三个默认角色、`fork_turns="none"`只读探子单轮收敛后，主代理实施与验证。未改生产解析、根依赖或发行入口。

| 产物 / 检查 | 当前结果 | 不能替代的门禁 |
| --- | --- | --- |
| [helper](../evidence/2026-10-18-local-development-history.md#local-f3bf483bcf6bb664)新增保留资产绑定 | 196资产＋10附带文本，202个固定源路径；同时核安装SHA-256、源Git blob、长度和路径/链接边界 | 版权解释、实际编译与原始第三方输入，不由复制字节PASS推导 |
| [固定材料配方](../evidence/2026-10-18-local-development-history.md#local-46197c576c9e6828)及[探针](../evidence/2026-10-18-local-development-history.md#local-ef6f42fe5eea4bff) | 9份固定PDF说明/生成脚本＋9份历史QuickJS builder候选＋1份声明的QuickJS源码LICENSE＋14份其他builder参考blob，共33份，175694解码字节；其中10份另核预期SHA-256，其他23份核blob/长度并记录实测SHA | builder候选/参考blob不冒充实际历史builder |
| QuickJS声明核验 | 两个固定资产路径历史的最近更新、更新提交的两项blob与源码revision声明相符 | 实际builder、历史镜像/编译器及产物重建对应仍UNVERIFIED |
| ICC上游原件与源许可 | 固定revision的8464字节profile与F01原件相同；6552字节CC0原文保存 | 原件PASS不代替整个PDF及native发行合规 |
| [12项新回归](../evidence/2026-10-18-local-development-history.md#local-1cb5313f229ca8c4)＋旧PDF绑定8项 | Node22.19.0/24.19.0各20/20，三文件语法PASS | 不是前批native12＋PDF8的同一次20项，也不是Full/页面验收 |
| [审阅快照](../evidence/2026-10-18-local-development-history.md#local-31984cd3173ed4d4) | 原始采集、最终代码、材料/绑定摘要与双Node复验分别固定；F01与前批审阅不重写 | 快照status维持PARTIAL，不能被默认stager当发行授权 |

主采集报告（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/pdf-materials-pcoeyi/pdf-inputs.json`）为PARTIAL，五条局部检查通过、33次GET/193830响应字节。前置metadata与CMap定位另为13次GET/313222字节，ICC三个独立批次合计5次GET/34730字节；**本轮主代理落盘51份HTTP响应，共541782字节**。其中一份HTTP404明确是ICC大写LICENSE路径的失败，不是许可文本；未重试该URL，按固定源树定位小写路径后取得正文。

上述51不包含探子的读取或web浏览工具；不把它称作全轮总流量。没有认证、重定向跟随、自动重试、上游源码执行、镜像下载或构建。reader沿用64请求/单响应512KiB/累计4MiB/20秒边界，每批新目录wx留证。固定资源树在采集前后及最终重放均核对，原件未替换。

## 2. 已确认定位与仍未确认的构建

### QuickJS

[PDF资产更新7a7e4fd](https://github.com/mozilla/pdf.js/commit/7a7e4fd382481a76f55c6d735873f635c9178db1)声明源码revision为`3d5e064e9dd67c70f7962836505a7fa067bf0a4e`；其两项blob与固定PDF提交`1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56`及前批F01字节对应。声明revision的[QuickJS LICENSE](https://github.com/bellard/quickjs/blob/3d5e064e9dd67c70f7962836505a7fa067bf0a4e/LICENSE#L3)保存Bellard/Gordon版权和MIT正文，不能只保留一段没有版权主体的通用MIT模板。

候选[b62f7cd Dockerfile:1–19](https://github.com/mozilla/pdf.js.quickjs/blob/b62f7cd527363ca2c1fe7467f274bc9acbf78c24/Dockerfile#L1)固定同一QuickJS revision并应用仓库patch，但基底是`emscripten/emsdk:latest`；[build.js:64–79](https://github.com/mozilla/pdf.js.quickjs/blob/b62f7cd527363ca2c1fe7467f274bc9acbf78c24/build.js#L64)可复用既有`qjs-sandbox`标签镜像。因此**同revision与时间相近不能证明实际用了b62f7cd**，更不能恢复历史image digest、Emscripten/Clang/Closure版本。当前main没有被作为历史pin。

[compile.sh:10–41](https://github.com/mozilla/pdf.js.quickjs/blob/b62f7cd527363ca2c1fe7467f274bc9acbf78c24/compile.sh#L10)的源码集合、exports/myjs及patch/锁文件已保存；`CONFIG_VERSION="1.0.0"`是宏，不是QuickJS发行版本。`MAXIMUM_MEMORY=2GB`是候选构建参数，不是当前文字提取worker的RSS实测；OMP的512MiB约束不因此降低。未执行这些脚本，也未补跑脚本引擎来冒充PDF解析验收。

### OpenJPEG、JBIG2、qcms

固定PDF的[OpenJPEG说明](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/openjpeg/README.md#L3)、[JBIG2说明](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/jbig2/README.md#L3)、[qcms说明](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/qcms/README.md#L3)都指向独立builder，但未指定builder revision。目录metadata与安装字节对应已确认；以下**仅为固定参考blob，不是6.3.289实际构建输入**。

| 参考输入 | 原文事实 | 仍缺 |
| --- | --- | --- |
| [OpenJPEG Dockerfile blob](https://api.github.com/repos/mozilla/pdf.js.openjpeg/git/blobs/8bfb091e0aaf29492e95f1b2a62ba4ff64a6f6dc)，1/4/9–12行 | 声明OpenJPEG源`6c4a29b00211eb0430fa0e5e890f1ce5c80f409f`、buffer-stream patch与浮动emsdk；patch、compile/compile_lib/build原文保存 | 历史builder、原始源与编译器归档、wrapper全部源和产物对应 |
| [JBIG2 Dockerfile blob](https://api.github.com/repos/mozilla/pdf.js.jbig2/git/blobs/b6425189a1e5707b2886467f33ada8fda87107c6)，1/4/8–10行 | 声明PDFium源`bb1f9f71e7b15afdd5937adf8cfe5807522b882f`，emsdk仍latest；compile与完整Apache正文保存 | 源pin仅在参考脚本中声明，未核历史builder/PDFium源包、build目录和wrapper源 |
| [qcms Dockerfile blob](https://api.github.com/repos/mozilla/pdf.js.qcms/git/blobs/319c0709986cfb2d70cf39b5762ede05227cd8e4)，1/4–12行 | rust:latest、无固定版本安装wasm-pack/wasm-bindgen-cli；不ADD Cargo.lock，运行cargo update | 参考[lock blob](https://api.github.com/repos/mozilla/pdf.js.qcms/git/blobs/a325cb497d9f918531455b4d6f816f4a817e33f7)的qcms0.3.0/wasm-bindgen0.2.100不是已证明实际解析版本；实际lock/vendor/toolchain与builder仍缺 |

版权文本继续分开：OpenJPEG上游及Mozilla BSD两份；JBIG2附带PDFium BSD与完整Apache及单独Mozilla notice；qcms两份MIT，不按README单一标签抹去包内差异。十份附带文本已核固定源blob，不等于这些组件的全部源码/版权义务完成。

## 3. 字体、CMap与ICC

- [standard_fonts/README:19–31](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/standard_fonts/README.md#L19)明确四份字体是未改动的Liberation Sans1.07.4；2.0之后的OFL不适用于这批。[实际LICENSE_LIBERATION](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/standard_fonts/LICENSE_LIBERATION#L5)保留GPLv2、文档嵌入例外、physical-product条款和修改字体的商标/文件名要求。嵌入例外不是再分发全部豁免；这是文本识别，不作法律适用结论。原始发行源包与实际发行义务仍需审阅。不能为了改许可静默换字体；字形顺序/widths/factors须同步更新并重验。
- 同README的3–15行只说明Foxit PFB由PDFium提取及2014版权，没有提取commit/原文件路径。十份PFB和BSD文本到固定PDF源树的字节对应PASS，但更上游精确提取来源未闭合。
- CMap脚本已定位到`external/cmapscompress`，不是探子请求404的`external/cmaps/README.md`。[固定README:3](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/cmapscompress/README.md#L3)及[compress.mjs:21/472–494](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/cmapscompress/compress.mjs#L472)说明转换/优化入口，输入目录由调用方提供；这几份原文没有绑定生成所用Adobe原始CMap版本。168个压缩资产与其Adobe文本已固定，不能把生成脚本身份当作历史输入归档。
- [ICC固定README:3–10](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/iccs/README.md#L3)确实声明上游revision。[ICC原件](https://github.com/saucecontrol/Compact-ICC-Profiles/blob/bdd84663061bc4ae95ca70decff54f581e27f702/profiles/CGATS001Compat-v2-micro.icc)与F01精确相同；源[小写license](https://github.com/saucecontrol/Compact-ICC-Profiles/blob/bdd84663061bc4ae95ca70decff54f581e27f702/license)为6552字节，PDF附带6553字节，两者差异实证为一个尾随LF，不冒称原始字节完全相等。三份原件/首次失败（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/icc-origin-pWlb9q/icc-origin.json`）、固定根定位（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/icc-license-locator-HnEBAf/locator.json`）、最终CC0（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/icc-license-pXt0kg/icc-license.json`）均保留。

## 4. 最终验证、风险与下一项

双Node最终记录（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/verification-final.json`）各20/20；Node22复验（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/offline-v22.19.0-fZ2y5U/revalidation.json`）与Node24复验（仓库外证据：`../../../artifacts/webui-optimization/U0/pdf-inputs-0929-Ik8MqL/offline-v24.19.0-13iQj9/revalidation.json`）各重算51响应、33主文本＋2补充原件/文本及196/10绑定，完整F01树不变；合并前批158的来源摘要、同一F01和互斥路径集合，得到354，不称本批重跑了旧158。33次fetch替身只读已有响应，真实外部fetch0、未知URL拒绝；**不是OS断网或Full安装**。

采集后补强配方身份、URL规范形态/null blob响应与旧HTTP状态核验；原执行代码摘要和最终代码摘要分别保存，没有重取33份材料或重写原报告。最终10个定向验证受管组确认退出；主采集组也退出。原30/31回收归因继续OPEN_UNATTRIBUTED，不由本次退出证据豁免。

受监测根依赖声明/lock、stager/assembler/SBOM/private-runtime、用户Glacier追加+8/-0、原资源和日常指针不变。未运行全量项目测试、前端/浏览器、Provider、Full或重建；未安装/升级依赖、清理、提交/推送或修改全局配置。构建卷当前835GiB可用，空间不是本步阻断。

下一项仍F02：有界补native四份503材料及已定位版权/例外，完成可核验重建的固定输入准备；PDF缺口已从“资产源字节未知”缩到“历史构建输入/上游字体与CMap输入/逐资产许可及发行义务”。优先保留已证实资源，**不无限重跑同一历史API、用当前builder或仓库初始lock猜填实际输入，也不默认换库**。若公开历史不能闭合，按[既有三路线](2026-09-29-webui-u0-native-materials-acceptance.md)评估固定新构建；新候选须新F01与质量/RSS/F03回归，工具安装或容器变更另按授权边界处理。F02完成后才F04发行元数据与默认接线，再F05/F06与剩余批次/PDF边界；U0当前仍未验收完成。
