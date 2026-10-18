# Parser资源接入Full：U2前发行门禁与实施接口

日期：2026-09-29。**U0技术收口PASS、6/6、总计14/44；完整发行闭包仍PARTIAL、Full NOT_RUN。** 按[确认调整](2026-09-29-webui-parser-gate-adjustment.md)，本清单发行工作全部保留并成为U2入口G2-00；[PDF预算已验收](2026-09-29-webui-u0-pdf-budget-acceptance.md)。旧F01合同及F03技术子集的身份保留，新探针/派生worker/两辅助模块须更新资源合同，不能代当前Full。默认Full未接资源，旧失败/来源与OPEN_UNATTRIBUTED保留；下一批U1，不在本批宣称发行通过。

依据：[U0计划](2026-09-26-webui-optimization-plan.md)、[解析范围证据](2026-09-29-webui-u0-document-coverage-acceptance.md)、[图片候选](2026-09-29-webui-u0-image-compat-acceptance.md)、[资源合同与隔离注入验收](2026-09-29-webui-u0-resource-integration-acceptance.md)、[真实获取与资产新验收](2026-09-29-webui-u0-acquisition-acceptance.md)、[最新来源与回收验收](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)。09-29续推新增资源合同、获取/来源/注入helper、探针及测试；不改默认发行链、根依赖声明或日常active。

## 1. 选用的验证链与资源归属

U2入口的发行工作使用当前Pi0.85.1的**release-stack链**，从`ReleasePayloadStager`到`assembleReleasePayloads`，不是固定旧seed的native distribution链。现有入口为[scripts/m11-stage-release.mjs](../../scripts/m11-stage-release.mjs)及[scripts/m11-build-release.mjs](../../scripts/m11-build-release.mjs)。新Full候选不继承S0旧Full的验收结论。

采用**app tgz内部版本化parser-resources树**，保持两棵独立依赖树：文档不安装可选canvas；图片精确安装Darwin ARM64所需Sharp/native optional包。`parser-resources/v1/{documents,images}/`已存在于本轮隔离app副本及其重打包中，不存在于日常安装或默认Full输出。固定[合同](../evidence/2026-10-18-local-development-history.md#local-6cc62f5d9429765b)与两份locks已落盘；解压运行不依赖开发根node_modules、全局npm或用户缓存。进入F04/F05时再把资源完整路径纳入private manifest/stack身份；本轮没有新stackId。

选择app tgz内部而非仅Full private tree，是为了避免Full有资源而Thin复制同一个app包时静默缺失。**不在本轮宣称Thin已验收**；接入后必须检查最终app包资源闭包，并分别保留发行形态的实际安装门禁。其他OS/CPU/libc不得继承Darwin ARM64结果。

文档保留完整、固定的pdfjs-dist package资源树，包括worker/WASM/font/CMap等；能读取测试文字不代表这些辅助资产都已运行覆盖，按最终功能确定实际路径、来源、摘要及断网样例。图片资源保留六个实际npm包、native相对加载布局及准确许可材料；lock中26个未安装optional条目不当作实际分发清单。

## 2. 连接面与最小接口

| 连接面 | 当前事实 / 文件 | 拟实施与必须验证 |
| --- | --- | --- |
| 独立资源准备 | [release-payload-stager](../../packages/release-stack/release-payload-stager.mjs)的defaultPrepare仅准备external、Pi、app；external目的地固定 | 增加显式parser合同/lock输入及仓库外准备目录，ignore-scripts；不得覆盖external或向根package安装 |
| app注入 | `buildOnlyMyPi()`仍是原默认流程；新增[隔离helper](../evidence/2026-10-18-local-development-history.md#local-1e2ee4d02bb62fa7)及[实际探针](../evidence/2026-10-18-local-development-history.md#local-32d11e67c0264a10) | 隔离app注入后repack/解包已验证；F02/F04闭合后才接默认stager。当前helper只准U0_REHEARSAL，其他purpose拒绝；不以可复制等于可发行 |
| acquisition | stager当前roots仅external lock与Pi shrinkwrap；新增parser helper已完成11包实际tarball及内容核验 | F04纳入两棵parser roots并绑定本批审阅pin；helper依赖可信进程内acquire/extract结果，不独立验证外部收据；native来源另收集 |
| ledger | [payload-assembler](../../packages/release-stack/payload-assembler.mjs)只构建external/Pi两份ledger；mergeLedgers支持数组 | 增加parser ledger并复用严格重复身份检查；同名同版摘要冲突应失败，不增兜底覆盖或降低漂移校验 |
| license | collectLicenses仅拷root LICENSE/COPYING；当前registry仅MIT/ISC/Apache-2.0及固定来源 | 明确多许可/版权文本、native嵌入组件及来源材料的结构，不仅给libvips塞一份通用LGPL文本；保留精确绑定和unused binding失败机制 |
| SBOM/notices | release metadata来自合并ledger；[distribution/sbom](../../packages/distribution/sbom.mjs)自动扫描只进入package的node_modules | parser必须进入ledger或成为显式扫描根；native嵌入库/非npm assets单独有身份，两个SBOM/notices与最终文件清单可对账，不假设任意资源目录自动被发现 |
| final内容检查 | 根files/bundled lists与[pack合同](../../verification/manifests/pack-content-v1.json)尚无parser树 | 精确准入所需资源与链接，不笼统放开所有node_modules；pack后注入必须补最终artifact检查，source npm pack检查不能覆盖尚未注入的资源 |
| 清洁源码/安装 | staging plan要求精确clean commit；defaultPrepare会在source cwd运行Vite build | 使用独立干净快照/checkout和新的仓库外output，保留当前未提交改动；不只因output在外就称checkout不写；Full只装入新隔离prefix |

实际资源合同使用项目通行的`formatVersion:1`（对应原规划schemaVersion）、策略版本、源码身份、平台、验证Node矩阵、两份lock摘要、实际包清单、asset路径/大小/摘要、lock声明的tarball来源/integrity、license/source材料映射及资源树摘要。未知版本、上限、路径、平台或身份漂移拒绝，没有开发依赖回退。F01原资源档案与F02实际npm发布tarball分别留证；F01历史NOT_RUN字段不改写，由[npm审阅快照](../evidence/2026-10-18-local-development-history.md#local-35395dc5075a97e5)绑定F01/资产配方摘要。文件/目录/可执行标记一致不是全部Unix权限一致；许可/source及其他发行门禁不会因字节PASS而关闭。

## 3. 可执行内部清单

| ID | 前置 | 交付 / 验收 | 当前 |
| --- | --- | --- | --- |
| F01 固定实际资源合同 | 当前document/image结果 | 保存精确locks、平台安装集、原件/派生策略、完整resource inventory与路径合同；核对同名同版本身份；fixture不冒充resource | 旧内容合同PASS（5＋6包/782条）保留；进入G2-00时须更新当前探针/派生worker/辅助模块与新构建候选身份，旧摘要不能放行 |
| F02 获取与native/资产材料补齐 | F01、固定上游来源 | 核验真实tarball与磁盘内容，保存对应许可/版权原文和已知嵌入组件；固定patch字节、source档案与Rust lock缺口；不确定项明确失败/partial | PARTIAL：前批npm11、native25源pin/47原文、PDF354/10及输入材料保留。本批四份AOM/WebP原文以官方固定Git提交补齐；仍缺历史builder/toolchain、完整义务、native最终lock/浮动patch及完整二进制来源对应 |
| F03 staging/app注入 | F01；许可清单可见，不能隐去F02缺口 | 隔离resource inject seam；正例＋目标存在、越界、符号链接、摘要/平台漂移及失败清理；根依赖声明/lock与日常指针不变，不冒称扫描了根已安装依赖 | PARTIAL：技术子集PASS；双Node各32项相关测试，解压资源各68回归/11容量/37图片通过；默认stager NOT_ENABLED，待F02/F04 |
| F04 发行元数据闭包 | F02、F03 | parser acquisition/ledger、双SBOM/notices、许可与最终pack准入逐项对账；丢资源或丢许可必须失败 | NOT_RUN |
| F05 独立Full候选与断网安装 | F01–F04完成、空间/源码身份满足 | 新候选由隔离clean源码构建；禁网安装到独立prefix；从安装后的精确parser资源执行回归/容量/公开语料及图片候选互操作；证明没有全局/checkout依赖 | NOT_RUN；默认CLI不可直接用于当前脏repo |
| F06 分层收口 | U0技术：全部解析边界；U2发行：F01–F05 | U0核对PDF累计展开等技术门禁；U2前另核对资源/完整许可/Full，全部必需发行证据通过才G2-00 PASS | U0选定技术路径PASS，各Node152＋4；U2发行整体NOT_RUN。原整体门禁失败与各批技术子集留证，不把阶段调整算成发行通过 |

F03可以在F02未全闭合时做**明确标partial的隔离准备测试**，但不得把结果晋升F04/F05验收、改日常安装或弱化许可门禁。最新双Node各45项相关回归、9例实际新组通过；已补单调时间/EPERM保守复查/统一失败详情，原一次失败因缺detail仍OPEN_UNATTRIBUTED，不以新组复跑豁免历史。避免将安全的独立开发工作误写成全部等待，也不让准备动作等于发行许可。

## 4. 已固定来源与仍缺的精确内容

- Sharp-libvips tag/npm来源提交`ebb95f8add54eee8bed840e3fb587e4cbec857d7`；28项版本逐项匹配本地。固定的[构建脚本](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh#L343)与[notice表](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/THIRD-PARTY-NOTICES.md)已归档，不执行上游构建脚本。
- libnsgif vendored目录已固定到libvips提交`24ad4d042940e6bf99a68871ba886ca8847c9c82`并保留[COPYING](https://github.com/libvips/libvips/blob/24ad4d042940e6bf99a68871ba886ca8847c9c82/libvips/foreign/libnsgif/COPYING)与构建入口；独立版本仍UNVERIFIED，不能凭README表补一个猜测版本。
- 剩余不是“所有来源都未知”：主要为29库完整许可/版权集合、编译时Rust最终lock/传递组件、PR383实际patch字节、源码包内容哈希与预编译二进制对应证据。当前脚本从main取notice也不能作为精确版本许可材料的唯一来源。
- npm11个实际tarball已重新下载核验SHA-512/实测SHA-256并与资源全包对应；provenance密码学验证仍NOT_RUN，完整许可/来源不随此通过。Saxes LICENSE已固定到commit`211fa0ebec9b628affc09219199639887174bfc3`及Git blob。
- PDF前批158项到80个源路径/blob的结果保留；新增196项资产＋10附带文本到202个固定源路径，354资产全部有固定PDF源树字节对应。33输入/候选原文、QuickJS声明源码revision及ICC上游原件/CC0保存，但实际历史builder/toolchain、上游字体/CMap生成输入与完整义务仍缺。最新[pdf-build-inputs-review](../evidence/2026-10-18-local-development-history.md#local-31984cd3173ed4d4)不改F01或前批source快照；不以主包Apache覆盖混合资产，也不提供法律合规结论。
- libvips/librsvg/libultrahdr三库5份许可全文与初始Cargo.lock保存且blob一致，PR383两份固定提交patch仅候选；不声称三库全部版权义务、最终lock或历史浮动patch已恢复。详细原文/摘要及边界见[最新记录](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)。
- native公开run绑定精确commit/attempt，当前API可见artifacts为0；release workspace仅取得metadata，未下载审阅，不当作完整对应源码。详细边界见[本批记录](2026-09-29-webui-u0-acquisition-acceptance.md)。
- 最新固定native配方保存25个官方源pin/49项预期文本；实际留存47份，四份AOM/WebP取文503，另新增完整logs匿名403与固定workflow留存范围证据。不可把先前预查的一次200但未留原文当采集成功，不声称匿名不可得等于全球不存在。原文/许可选择与重建前置见[native材料验收](2026-09-29-webui-u0-native-materials-acceptance.md)。

## 5. 执行与回滚边界

仅新artifact/output/prefix；用户旧证据不复用为会被stager失败清理的output。默认apply失败会清理本次output，长期报告独立留存。新Full候选安装不激活、不替换日常stack，不读私人文档或账号凭据；Node22/24结果、资源加载与产品材料/RPC验收分层。

若精确预编译来源材料无法充分取得，G2-00保留阻断并准备固定源码/工具链的可核验新候选及重验；四份AOM/WebP原文已补齐，不重复原503。最终Rust lock/浮动patch与PDF历史构建仍不能由现材料证明。U0技术已PASS，下一批U1；发行闭包在U2产品集成前仍必需。新PDF预算worker资源URL/font/CMap兼容、RAB固定Node互操作与实际安装加载须同时纳入G2-00，不仅更新源码摘要。不静默换库、降低40MP/512MiB或改变功能，不用当前builder/初始lock猜填历史，不无限复跑API。新dylib须新资源身份和验证，不证明旧二进制。F04–F06发行整体未运行；安装/费用/日常晋升边界仍遵循已有授权。
