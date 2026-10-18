# U0-04 F02：真实 npm 获取、来源固定与 PDF 资产映射

日期：2026-09-29。**npm 发布字节核验 PASS；Saxes 许可来源固定 PASS；PDF 资产映射 PARTIAL；native 来源/许可闭包 INCOMPLETE。F02 未完成，G0-03 仍 FAIL，U0 仍 5/6，总计 13/44。** 默认发行接线未启用，Full 为 NOT_RUN；不进入 U1 或 Electron。

续推记录：本文件保留原获取批次及31项回归/历史失败；最新[来源与回收验收](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)已补PDF158项固定源字节、5份native许可原文/初始lock/候选patch，以及单调时间和未知状态回收补丁。双Node各45项回归/9例新组诊断通过，但完整许可/历史构建输入仍缺，旧回收归因仍OPEN_UNATTRIBUTED；不将后续通过改写成上批从未失败。

## 1. 本批实际交付与证据

复用已有下载器、`acquireInstalledArtifacts` 与 safe-extract 链，不增加依赖、不改默认 stager。新增内容：

- [获取内容核验与资产映射 helper](../evidence/2026-10-18-local-development-history.md#local-cdc7313e329dac67)：精确安装集、锁定 URL/SRI、真实 tarball 摘要、完整包内容/目录/可执行标记比较；资产未知组必须显式登记。
- [有界真实获取探针](../evidence/2026-10-18-local-development-history.md#local-9a399b5915a8c65d)：每次最多 24 个公开请求，单请求 20 秒、metadata 4 MiB、tarball 128 MiB、无重定向/重试；不执行下载代码或 npm install。
- [PDF 资产审阅配方](../evidence/2026-10-18-local-development-history.md#local-6ed8887283cc4e75)、[npm 获取审阅快照](../evidence/2026-10-18-local-development-history.md#local-35395dc5075a97e5)。原 F01 `contract.json` 的历史 `NOT_RUN` 字段不改写，本批结果由独立 F02 快照绑定 F01/配方摘要。
- [9 项新增回归](../evidence/2026-10-18-local-development-history.md#local-f3eb6304b5a068b4)：集合、URL/SRI、归档/内容/空目录/执行标记/链接/路径漂移、真实解包内容负例、资产遗漏/重叠及头部字节验证。

最终原始报告：acquisition.json（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-AwbROj/acquisition.json`）。该轮 6 条检查通过，总状态仍 PARTIAL；18 次公开 GET 均 HTTP 200（npm 11、GitHub API 6、原始 LICENSE 1），重试 0、外部模型调用 0。

固定输入仍是 F01 两棵资源树；没有读取私人文档或凭据。基线摘要证明根 package/lock、默认 stager、assembler、SBOM、private-runtime、用户 Glacier 审计文件和日常指针不变。此处不是根目录已安装 node_modules 的完整测量。

## 2. npm 字节对应：PASS 的准确含义

11 个实际包（文档 5、图片 6）均从各自 lock 的精确发布 URL 获取；压缩包合计 **17,306,428 字节**，各包自身文件内容合计 **54,818,397 字节**，逐条与原资源一致。资源总量还包含两份 lock、Saxes 补充 notice 和包间链接等，不能把此数混当 F01 全树大小。未安装的 26 个 optional lock 条目没有下载、没有算作分发包。

比较范围为完整文件字节/SHA-256、目录（含空目录）和 `Boolean(mode & 0o111)` 可执行标记，**不是全部 Unix mode 或三个执行权限位逐位一致**。新结果用 `EXACT_FILES_DIRECTORIES_AND_EXECUTABLE_FLAG`；首轮报告中的旧 `BITS` 命名保留为历史记录，不据此扩大保证。

信任前提是已有 `acquireInstalledArtifacts` 的实际进程内结果：同一完整性核验 tarball 经真实安全解包并确认包根/manifest，再与资源比较。helper 不独立重解包不可信的外部收据。新增负例使用真实获取/解包链，验证“manifest 相同但源码载荷不同”仍触发 `PARSER_ACQUISITION_CONTENT_DRIFT`。最终只读复验针对已由该链取得的材料，不冒充另一轮独立解包证明。

每个包的 URL、SHA-512、实测 SHA-256、压缩/内容大小、完整 inventory 摘要及 19 个随包 license/notice 文件保存在报告/快照中。包签名/attestation 为 NOT_RUN，native 源码构建对应 UNVERIFIED，完整许可及发行准入没有随字节 PASS 晋升。

## 3. Saxes 许可的不可变来源

公开 tag ref → annotated tag → commit → tree → Git blob → 原始字节链已核对；commit 和 blob 与审阅 pin 必须一致，而不是只记录响应值。

- `saxes@6.0.0` commit：`211fa0ebec9b628affc09219199639887174bfc3`。
- LICENSE Git blob：`187f3ba399862022f4e670b2a3a1dbc6d7e6a800`。
- 3,011 字节；SHA-256：`0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e`，与 F01 保留的完整原文一致。
- 一手来源：[固定提交 LICENSE](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE)。签名验证仍 NOT_RUN。

## 4. PDF 附带资产：196 已映射，158 未解决

对 `pdfjs-dist@6.3.289` 完整包的 CMap、字体、WASM、ICC、web/legacy 图标进行精确路径分组，共 **354 个资产**；另外的代码/类型/映射文件不由此表覆盖。不能仅按 package.json 的 Apache-2.0 给全部资产贴相同许可。

| 资产组 | 数量 | 保留文本/头部与限制 |
| --- | ---: | --- |
| Adobe CMaps | 168 | `cmaps/LICENSE`；168 个实际文件均核对 Adobe 版权及 `See ./LICENSE` 指针 |
| Foxit 字体 | 10 | `LICENSE_FOXIT` 的 PDFium BSD 文本；目前为目录/名称关联，不是字体来源完整对应证明 |
| LiberationSans | 4 | `LICENSE_LIBERATION` 保留旧 GPLv2 协议及其例外/附加条款；不能替换成现行 OFL 结论 |
| OpenJPEG | 2 | 上游与 PDF.js 两份不同文本分别保留 |
| JBIG2 | 2 | PDFium BSD/完整 Apache 与 Mozilla notice 分别保留，不压成单一标签 |
| QCMS | 1 | 上游/PDF.js 两份 MIT 文本分别保留 |
| ICC | 1 | `iccs/LICENSE` 的 CC0 文本；目录/名称关联 |
| MPL 图标 | 8 | 8 个实际 SVG 的 MPL-2.0 头部检查通过；完整许可正文和发行义务仍需核对 |
| QuickJS JS/WASM | 2 | UNRESOLVED，不套用包主许可 |
| 其他图标 | 156 | UNRESOLVED，不因没有独立头部就认定许可已解决 |

“196 已映射”只表示保留文本/头部可定位；部分是名称关联，**不是 196 项来源或法律义务全部闭合**。映射缺文件/文本、重叠或出现未登记资产即拒绝；font/WASM/打包代码对应源码与法律义务审查仍 INCOMPLETE/NOT_RUN。完整路径、文本摘要与关联强度见配方及最终报告。

首轮新增头部检查在 `altText_spinner.svg` 失败：原始失败报告（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-pX63wg/acquisition.json`）。实际 SVG 用 XML 注释续行 `- License`；已针对该实际格式归一化，并在测试保留此样例；没有删除头部检查或修改上游字节。最终两 Node 均验证 168 CMaps＋8 SVG。

## 5. native 一手信息仍不足以关闭 F02

本批重新取得 [v1.3.4 release](https://api.github.com/repos/lovell/sharp-libvips/releases/tags/v1.3.4)、[构建 run 36315646015/attempt 1](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/attempts/1) 和 [该 run 的 artifacts 清单](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/artifacts?per_page=100)。run 绑定 `ebb95f8add54eee8bed840e3fb587e4cbec857d7`、conclusion 为 success。

- release 有一个 `npm-workspace.tar.xz`，86,852,556 字节，API 声明 SHA-256 `a40fc59e3aa3635177613fa63f29ceecb28b5ad99e7919def47a61f6ca06f0ee`；**未下载或审阅其内容，不能当实测摘要或完整对应源码包**。
- 当前公开 run artifacts API 的完整页返回 0；仅证明这个时间点 API 可见集合为空，不能推断从未存在产物或全网没有源材料。
- 29 个嵌入库完整许可/版权集合、构建时最终 Rust lock/传递组件、PR383 当时 patch 字节、对应源码与预编译二进制的绑定仍待补。
- `populate-npm-workspace.sh` 只读检查不等于执行构建；开发 workspace 的 include/局部 C++ 内容不足以证明全套对应源码已经取得。

此记录提供工程证据，不作正式法律合规判定，也不以通用 LGPL 文本替代所有库的材料。

## 6. 回归与新增未解决风险

| 检查 | Node 22.19.0 | Node 24.19.0 | 结论边界 |
| --- | --- | --- | --- |
| 最终定向矩阵：新获取 9＋既有 acquisition 5＋资源 13＋pack 4 | 31/31 PASS | 31/31 PASS | 显式 `--test-concurrency=1`；不是全项目回归或 Full 候选门禁 |
| 真实获取材料只读复验 | 11 包/354 资产 PASS | 11 包/354 资产 PASS | 网络请求 0；复验已信任材料，不重解包外部收据 |
| 实际 notice 头部 | 168＋8 PASS | 168＋8 PASS | 不代表所有资产的许可闭包 |

证据：最终矩阵（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-AwbROj/unit-matrix-isolated.json`）、只读复验（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-AwbROj/revalidation-matrix.json`）。Node 22 保存摘要及 stdout 尾部，Node 24 保存本次返回的 stdout；不声称两者都有独立完整日志。

必须保留此前一次 Node 24 **30/31 的真实失败**：原矩阵（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-pX63wg/unit-matrix-before-correction.json`），位置为 `tests/release-parser-resources.test.mjs:182` 的 owned descendant-group 回收断言；回执没有原失败的 PGID/完整嵌套 detail。随后独立新组诊断 9/9 确认退出，但诊断报告（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-pX63wg/group-diagnostic.json`）仍 PARTIAL，**没有解释原失败，风险保持 OPEN**。该旧测试有 leaf-ready 同步，不能无证据归因为启动竞态；也未改旧 runner/test、延长清理上限或放宽断言来凑绿。最终通过不覆盖或豁免这次失败。

本批不重跑未受影响的全量、收费 Provider、产品 Ego 或日常安装；没有 UI 改动，也没有把 source npm pack/doctor 的结果当作注入后的最终 Full 包检查。最终静态复核（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-AwbROj/static-final.json`）核对两 Node 的 3 份源码语法、最终运行代码/合同/配方摘要、7 份来源文件、7 份计划文档的本地链接与基线；用户审计原有 +8/-0 保留。

## 7. 下一项与晋级条件

1. 继续 F02：补 native 精确许可/源码材料、PDF 未解决资产及 font/WASM 源码义务；若既有二进制无法充分核验，提出可验证重建的具体成本与材料，不静默更换候选。
2. 同属 U0-04：为 owned-group 失败补足可核验诊断并定位；保留旧失败，不以增加重试或延长阈值替代原因分析。
3. F02 完成后才接 F04 的 acquisition/ledger、双 SBOM/notices、最终 pack 内容及默认 stager；随后 F05 隔离新 Full/断网安装、F06 批次预算/PDF 压缩流/真实加密等剩余门禁。
4. 所有必需项闭合才验收 U0-04、进入 U1。当前日常指针未切换；未提交/推送/发布、未清理既有产物、收费调用为 0。
