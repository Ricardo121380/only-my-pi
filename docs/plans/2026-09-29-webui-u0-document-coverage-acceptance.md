# U0-04 文档部分解析与来源定位验收

日期：2026-09-29。**本批解析范围补丁及双Node回归PASS；不是U0总验收或产品功能交付。** U0保持5/6、总计13/44。G0-03仍FAIL待剩余边界和Full发行闭包，不进入U1或Electron。

## 改动与可观察行为

修改[文档实验探针](../evidence/2026-10-18-local-development-history.md#local-09a4f6ca9c34694e)、[公开语料报告字段](../evidence/2026-10-18-local-development-history.md#local-4a6e8e5a9e48de24)，增加[公开原生来源采集探针](../evidence/2026-10-18-local-development-history.md#local-7f412ae433051d81)及合同/报告。根依赖、生产Host、日常active和用户文件均未修改，收费Provider调用0。使用lean-coding限定改动在本批技术验证范围。

文档结果增加`schemaVersion:1`、`status:ready|partial`、`warnings`与`coverage`。`ready`只表示当前支持路径未检测到遗漏，**不表示完整文档保真、完整OOXML规范验证或所有生产者兼容**。`partial`保留实际提取的blocks；每类/part警告合并为出现次数和首次位置，没有把重复警告静默删除。完全无文本仍`NO_TEXT`，不把空结果标为成功。

| 格式 | 新行为 | 来源/明确限制 |
| --- | --- | --- |
| DOCX | 按主正文引用读取页眉、页脚、脚注、尾注；重复页眉引用只读取一次；孤立外围part不注入正文并提示 | `part/partKind/paragraph/noteId/tablePath`；保留原始`styleId/outlineLevel`，不推断样式继承、真实标题级别或Word页码 |
| DOCX负例 | 外部、越界、缺失页眉part及缺失引用note明确失败；外围正文与主文共享输出预算 | 包内关系只解析到存在的part；不执行远程访问；不将错误关系当作可用空附件 |
| DOCX部分读取 | 检测对象与未裁决修订，保留实际读到的文字并标partial | 不宣称已接受/拒绝修订，未做对象、版式或嵌入文档理解 |
| PPTX | 声明顺序下的幻灯片、段落、表/行/单元格物理序号；换行保留，表后坐标清空 | 合并标记提示版式未保留；坐标不是展开后的视觉网格，不渲染母版/图表；备注、媒体及嵌入对象提示未解析 |
| XLSX | 单元格地址/表名/公式缓存保留；共享公式从属cell记录公式类型/索引，不误标literal；无缓存公式提示；不把rPh注音混入正文 | 不计算公式、执行宏或解释图表；缺缓存不捏造数值；公式存在性计入cell预算，不依赖公式字符串非空 |
| PDF/混合空内容 | 有文字与无可提取文字的页并存时标partial；空worksheet/slide同样提示 | PDF原页码仍保留；不把空页证明为扫描件，也不声称OCR |
| Strict命名空间 | DOCX、XLSX、PPTX已有文字路径接受对应Strict命名空间及关系类型 | 三个有精确文字/位置期望的合成子集，不是Strict schema全量兼容性；主part路径仍固定 |

Strict与Transitional命名空间差异可参见[微软Open XML说明](https://learn.microsoft.com/en-us/office/open-xml/about-the-open-xml-sdk)。本项目使用自己的受限提取器，不因SDK具备某项能力就推断本实现也具备。

## 实测与证据

本批仓库外目录：`../artifacts/webui-optimization/U0/document-coverage-0929-YY1PVt/`（相对仓库根）。两个固定运行时为Node22.19.0及H候选内Node24.19.0；显式依赖目录为先前已解包的系统临时根下 `omp-u0-parser-package-LUbTGo/installed`，不是开发根node_modules。[原绝对位置及未改原文的本地索引](../evidence/2026-10-18-local-development-history.md#u0-document-coverage-original)保留历史身份，不推定旧临时根现在仍有效。

| 检查 | Node22 | Node24 | 证据边界 |
| --- | --- | --- | --- |
| 文档回归 | 67/67 PASS | 67/67 PASS | 原39项保留＋28项新正文/来源/partial/关系/复核修复用例；Strict样例断言全部期望文字及特定坐标 |
| 实际parser worker断网 | PASS | PASS | 每个回归/容量报告另含1项EPERM/EACCES断言，因此各为68/11项 |
| 真实默认容量 | 10/10 PASS | 10/10 PASS | 200页/200张/20万单元格/1万条目/200MiB展开恰好及超限；原上限未放宽 |
| 活跃loopback基线、沙箱及后代 | PASS | PASS | 未隔离CONNECTED；沙箱及后代均EPERM，不以断网服务器冒充网络拒绝 |
| 固定公开Office包复验 | 4/4 PASS | 4/4 PASS | 三个成功解析，一个空PPTX保持NO_TEXT；固定SHA256/许可，缓存复用，不访问私人材料 |

最终断网容量最大采样RSS：Node22 **391792KiB**、Node24 **448208KiB**；回归最大143600/149104KiB。仍是每25ms采样并终止的worker门槛，不是硬内核内存隔离、所有复杂文档性能或总Host内存保证。各worker最终退出；父驱动退出码均0。公开语料驱动未置于断网沙箱，不把其4项作为新的断网证明。

最终主报告：`offline-node22-2.json`、`offline-node24-2.json`，列出各独立`offline-*/regression.json`及`capacity.json`的准确路径和复制探针SHA256。公开语料为`office-node22-2.json`、`office-node24-2.json`：DOCX10块、XLSX5块、有表格PPTX16块；最终报告保留完整blocks、parser status/warnings/coverage。仍主要断言提取成功/空文档预期拒绝，不冒充公开包全部正文的独立精确期望已补齐。精确文字与新来源断言在28项合成用例中；较早的`*-1.json`均保留。

## 独立复核 → 实际复现 → 修补 → 回归

单轮只读探子完整审查指定代码/结果；主代理按定位阅读并修复，没有追派或让探子写代码。最初19项实际结果与断言一致，但未覆盖以下分支。新增9项并增强Strict全量文字断言，先在未修补的解析器复现，`defect-reproduction-node24.json`共67项，其中6项失败：

1. DOCX `w:noBreakHyphen/w:softHyphen`静默漏读，body/header/note得到ABC而非带对应Unicode字符的文字；补字符保留，仍计入同一输出预算。
2. XLSX shared与inline字符串把rPh注音当正文；两个样例分别复现混入日文/“注音”，补注音上下文排除。
3. 共享公式空`f`从属cell被误标literal，无缓存cell也绕过预算；两项分别复现来源/partial错误与未触发CELL_LIMIT。改以公式元素存在性计数，保留类型/索引与空公式文本，不代算或编造缓存。
4. PPTX显式默认gridSpan/rowSpan=1、hMerge=0、vMerge=false误报partial；改按属性值判断，真实合并正例仍提示。

另外补notes总预算恰好、endnote超限、多个选定notes累计超限；未选中note超过小输出阈值不消耗正文预算。Strict三个样例断言全部预期文字，不再只验末块。新检查分别留存失败而不是遇到第一项就静默跳过其余，最终矩阵68/68（含worker断网）通过。

## 原生依赖来源：已定位，不作完成判定

最终`native-provenance-3.json`状态**PARTIAL**，4条带实际断言的技术检查通过，13份公开上游文件/元数据随SHA256保留。其中7份固定源码/许可文件同时对照Git tree的blob SHA1核验；未执行下载脚本。首轮错误假定notice路径的`native-provenance-1.json` FAIL保留；改为真实仓库根路径后2为PARTIAL。复核发现2的第4条只是无条件记录观察，现已为三类已知浮动输入增加存在性断言，完整要求COPYING/README/Meson三个定位文件，固定已定位的libvips commit并记录本次探针SHA256；3仍不声称观察集合覆盖所有构建输入。

- Sharp-libvips 1.3.4 tag与npm gitHead均指向`ebb95f8add54eee8bed840e3fb587e4cbec857d7`；28项构建版本与本地`versions.json`精确一致。GitHub称tag已验证只是上游API声明；本机签名/attestation密码学验证NOT_RUN。
- libvips 8.18.7 tag当前解析到`24ad4d042940e6bf99a68871ba886ca8847c9c82`；已保留其vendored libnsgif的完整COPYING、README及Meson入口，不能再写“完全无许可来源”。仍不虚构libnsgif独立版本或二进制与源码对应关系。
- [固定构建脚本](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh#L343)仍有`cargo update --workspace`、浮动PR383补丁及从main读取notice；固定28个版本并不能冻结全部Rust传递依赖、补丁字节或对应源码。
- [固定notice表](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/THIRD-PARTY-NOTICES.md)是库名/许可摘要，不替代所有版权与许可原文。此报告不是法律合规结论；`licensingClosure=INCOMPLETE`、`Full=NOT_RUN`保留。

## 风险与下一项

1. 当前支持常见文字路径；主part重定位、复杂字体PDF、真实加密容器、批次50MiB/10项和PDF压缩流等尚未全部验证，不能因67项通过而关闭G0-03。
2. U2必须将partial和来源实际接入卡片/发送快照，并核对模型收到的内容；这里还没有上传API、材料卡片或RPC/Provider材料验收。
3. Full接入不能只复制依赖而漏ledger、许可及SBOM；下一步按[资源闭包实施清单](2026-09-29-webui-u0-parser-full-integration.md)补齐。现有脏工作区不直接调用要求clean commit的默认staging，也不切日常安装。

最终`static-final.json`核对三份探针的Node22/24语法、两份最终断网报告与当前源码SHA256一致、最终native报告与采集探针SHA256一致、13份缓存文件/7个Git blob、7份文档66个本地链接及`git diff --check`，全部PASS。用户Glacier交互审计文档仍为原有+8/-0。按本批parser路径核对没有残留worker；旧失败及初轮成功报告全部保留。此静态检查不新增产品UI、Full安装或Provider验收结论。
