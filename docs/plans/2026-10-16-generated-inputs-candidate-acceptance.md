# G2-00-02 / #22：独立生成输入候选与阶段义务

日期：2026-10-16。依据实时[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)、[#22](https://github.com/Ricardo121380/only-my-pi/issues/22)及[既有材料报告](2026-10-02-webui-g2-00-generated-inputs.md)。当前三个剩余对象的实际生成、完整输出一致性及限定负例已有通过证据；Standards/Spec 结论在末节单列。材料候选不放行整体许可、应用构建、分发、Full 或 U2。

## 基线、固定输入与范围

- 入口 HEAD：`47adc12331fa1f17280aed21316f97b79e4121cb`；分支 `codex/webui-phase1`。入口 1,740 个 tracked/untracked 文件的完整字节、大小、权限或链接目标及空 index 已冻结。
- 本轮仓库外证据根：`LOCAL_WORKSPACE/artifacts/issue22-generated-candidate-20261016T091610Z`，下文简称 P。原始材料、二进制、归档和失败留在本地，没有推送或上传。
- `P/preflight` 保存 #19–#23 正文、评论及分页原生依赖。实时 #20 CLOSED、#21/#22/#23 OPEN；#22 无本批前置；#23 对 #20/#21/#22 的既有边保留。没有创建 #23 kit。
- 原合同、旧 1,002 文件 supplement、原 kit、五模板复现、三个静态对应、Windows/gettext/xmlwf 及历史失败均保留。原 [#21 交付与阻断](2026-10-15-gir-candidate-acceptance.md)没有重跑或改判。

新入口为 `node scripts/probes/webui-g2-generated-inputs.mjs --candidate <absolute-fixed-inputs> <new-absolute-output>`。四参数 legacy 入口原义保留。[新合同](../../contracts/release/parser-resources-v1/native-generated-candidate.json)绑定不可变输入 manifest 与[生成驱动](../../scripts/probes/lib/generated-input-candidate.py)；[入口执行器](../../scripts/probes/lib/generated-input-candidate.mjs)逐文件校验集合、完整字节及执行位、用途、保护根、源码驱动与环境后才创建输出。

固定输入 `P/fixed-inputs-v2` 含 **10,353 个清单覆盖文件、477,874,858 字节**，另有 manifest 本身；manifest 身份 `sha256:fe5c9a74a5142b0b22a29d565143cce8bb7c5977d14eda5168c402c1e8ddf440`。完整保留五个组件源树、旧 supplement、旧合同与完整工具归档、Git 图谱、供应包/补丁/请求回执、TeX 工具与字体、处理配置、逐对象来源和条件账本。没有按目标库图裁剪源包或 vendor 来消除缺口。

固定环境为 Darwin 27.0.0 / macOS 27.0 build 26A428 / arm64。manifest 绑定 3,802 个宿主工具、Clang resource/SDK 头文件及 SDK 元数据/链接输入；执行前后重新逐项核对。私有 pdfTeX/字体等在材料内逐字节固定；locale、TZ、Git 配置、Python 和 SOURCE_DATE_EPOCH 均显式固定。工具没有安装到全局目录；当前日常栈与应用资源未切换。

## 八项与三个静态对应

| 对象 | 实际链与新候选证据 | 历史和后续边界 |
| --- | --- | --- |
| libffi ChangeLog | 实际取得 libffi 上游 Git，冻结含 2,082 个可达提交的自包含 bundle、完整源码 tar 及 parent 图谱；固定 HEAD `12ffd1f9dc56fcea79d2f742f424301ae668d663`。每次独立 clone 后执行 `git log --no-decorate --abbrev=8 <HEAD>`；647,331 字节与旧结果相同 | 8 位缩写是本候选显式参数；原发行 invocation/对象库范围仍 UNVERIFIED。不是从旧 ChangeLog 复制生成 |
| libffi PDF | 原 libffi 3.8.0 的 libffi.texi、version.texi、2021-04-25.21 texinfo.tex；实际用私有 TeX Live 2026 pdfTeX 1.40.29、固定 Plain 格式源、CM/AMS 字体与映射生成。固定 texindex 6.8，4 次 TeX pass，末两次 PDF 字节一致；83 个实际 TeX 输入由 recorder 全量留证 | 新工具供应及确定元数据设置，不冒称原 pdfTeX 1.40.25。原来源全文和结果例外分开；字体按自身原文保留 |
| ffi/exif/webp/expat/archive 的五个 autoheader 模板 | 当前完整源文件、嵌套宏、已审核输入及工具来源与原固定配方匹配；原各两次禁网输出均与当前模板逐字节相同，复用原两次执行与失败记录 | 只复用同身份及原证明范围，原发行环境/运行仍 UNVERIFIED；不重新生成五模板或重判已绑定材料缺失 |
| Expat expat_config.h | 完整原源树及 configure/模板；实际 Apple clang 21 C 编译/平台探测与 config.status。参数、原始 config.log/config.status/全部 Makefile/libtool/探测日志保留；生成头通过真实 `-fsyntax-only` 结构检查 | 固定 macOS arm64 材料配置，不是正式 native 应用构建。G2-00-04 必须依完整私有依赖重新配置，不直接复用本探针结果 |

新生成对象身份：

| 输出 | 大小 | SHA-256 |
| --- | --- | --- |
| `generated/ChangeLog` | 647,331 | `088b35e2be8712b614fea8d7558660802935309e280ac93a36f82058551dc545` |
| `generated/libffi.pdf` | 233,627 | `b8bab84268162300c4bb5e7b19244ac36a75d4753ea1837db82e99b926e6fe66` |
| `generated/expat_config.h` | 4,175 | `84cc30b5db2a744e1b788b82c226fe9d41df5be2b417984df4ef8985ad330095` |

三个静态对应继续保存并在新入口重新核对：libexif.spec 两行模板替换、stdint.m4 的固定分支内容、stamp-vti 与 version.texi 的复制对应。它们不证明历史 config.status、编译探测或日期生成。libexif 文档生成域仍由 #20 的独立证据覆盖。

## 111 个完整宏/脚本的来源

`materials/config/macro-bindings.json` 对全部 111 个对象保留自己的声明版本、完整原文件、摘要/执行位、工具供应、包输入、聚合 include 及历史 UNVERIFIED，不把文件版本统一写成宿主工具或父包版本。十个原家族及完整原文均保留。

| 当前绑定 | 数量 | 证明范围 |
| --- | --- | --- |
| 完整固定供应成员与当前对象逐字节相同 | 63 | 含现有来源、Ubuntu/Debian 包成员和 GNU config.guess；这是实际内容供应对应，不是历史调用证明 |
| 固定生成器源码/完整归档及包输入 | 45 | 35 Makefile.in、5 aclocal.m4、5 configure；保留各包输入和聚合宏的所有 include、不同内嵌范围；没有声称重放这 45 个历史调用 |
| 固定上游基线加完整、明确的新重建补丁 | 3 | Expat 的 config.sub、libtool.m4、ltmain.sh；每次公开入口实际以 `patch --fuzz=0` 重建并与当前字节相同。原补丁作者、供应过程及历史调用仍 UNVERIFIED |

本轮补证如下。

- Libtool 2.5.4、2.6.2、Texinfo 6.8 重新从 GNU HTTPS 入口实际取得并冻结完整包；curl 同时限制首次和重定向均为 HTTPS。旧 HTTP 比较包、全部旧请求及失败原样保留，不把它们改写成可信历史供应。主线程另行从 12 个完整归档逐成员读取，200 个保留工具成员与实际归档全部相同；三个新 HTTPS 包与旧比较包也逐字节相同，见 `P/tool-source-audit-v4.json`。
- Ubuntu `libtool_2.4.7-7build1` 和 Debian `libtool_2.5.4-4` 的完整 binary package、dsc、Debian tar/patchset/copyright 均冻结。ffi 的 ltmain.sh/libtool.m4 与 Ubuntu 包成员相同，webp 的两文件及 archive 的 ltmain.sh 与 Debian 包成员相同。没有声称验证发行包签名或重现 Debian 构建。
- GNU config.guess 与真实上游提交 `f56a7140386d08a531bcfd444d632b28c61a6329` 的成员相同。config.sub 的固定基线为 `03087cbd5161db0ff94e578b02d318d0bba2742d`，保留当前多出的 PS2 分支作为显式完整补丁；两个 Expat Libtool 文件同样绑定 Libtool 2.6.2 原包及完整差异。新重建链没有更换这些文件的候选字节或减少平台分支，也不冒充找回原补丁供应。
- TeX Live 完整运行容器、TLPDB 与 SHA-512 container checksum 实际核对；原容器、完整私有运行树、CM/Plain 源、Texinfo 完整源及版权/许可材料保留。没有声称自行构建 pdfTeX 二进制或取得该发行二进制的完整对应构建源码；若后续包实际包含该二进制，其源码/许可履行仍归 G2-00-05 核验。三个上游工具 symlink 在私有树中展开为同字节普通文件，原成员、目标及摘要单列；原归档仍完整。

## 当前条件与后续义务

`materials/config/current-obligations.json` 逐对象绑定身份、完整原文、实际拟用途、适用前提、当前证据及具体 Gate。本轮用途是**私有本地材料复制、处理与工具执行**；完整头部、聚合 include、包自身与嵌入声明均保留。当前状态限定为 `SATISFIED_LOCAL_PRIVATE_OPERATIONS`，没有把保存全文等同于实际分发履行。

Autoconf 的脚本/输出声明与分发例外分别记录；Libtool 文件本身及其内嵌输出不同范围分开；Texinfo 宏自身 GPL 与实际经 TeX 读取后的结果例外分开。PDF 的 libffi MIT copying 全文实际保留于文档，AMS 字体 OFL/CM/Plain 的各自声明、TeX Live 多包许可边界均独立保留，不将工具、字体或源树统一归为仓库 MIT。

| Gate | 交接的对象/义务 | 本轮状态 |
| --- | --- | --- |
| #23 / G2-00-02 | 新 kit 全量身份、所有 supplement/完整 source/overlay/声明对账 | NOT_RUN；新 kit 未创建；#21 阻断仍保留 |
| G2-00-04 / #25 | 正式依赖重新配置、真实应用构建及其包条件；若使用 Libtool 例外须有实际构建证据 | NOT_RUN |
| G2-00-05 / #27 | 实际最终包、默认发行、ledger、双 SBOM、完整 notices；所选分发路径的例外前提或 GPL 源码等履行；如分发重建修改需明确修改标记 | NOT_RUN；exception admission 不预授予 |
| G2-00-06 / #28 | 同候选隔离 Full、包内资源矩阵及发行核对 | NOT_RUN |

上表只交接后续事件才会产生的证据，不将当前复制/生成必要条件挪后。实际分发未进行、完整 licensing 仍 INCOMPLETE、Full NOT_RUN、U2 BLOCKED。本报告不替代完整许可签核。

## 双目录、差异及实际验证

最终代码使用同一 `fixed-inputs-v2`，在 `P/replay-node22-v3` 和 `P/replay-node24-v3` 两个独立目录实际运行公开 CLI。分别为 Node 22.19.0 / 24.19.0，二进制身份见各自 receipt。两个目录均重新 clone 固定 Git 图、实际 TeX/texindex 生成、实际 configure/config.status/编译探测及补丁重建，没有复制第一次生成结果。

两次均 exit 0 / `PASS_MATERIAL_CANDIDATE`，完整候选根均为 **10,359 文件、482,360,128 字节**。主线程另行读取两棵完整根，逐文件核对集合、大小、字节及完整执行位，全部一致。完整清单身份 `sha256:0053b59a01e9bfc25f635954c0bcf9ff1f6d7e4075f7e90010ff0031d9cfd8ea`；没有去掉未知 JSON 字段或只比较三个目标文件。对应回执为 `P/independent-parity-v3.json`。

完整材料和三个候选对象在候选根；raw 生成 workspace 与执行证据另存 `<output>.execution`，每侧 **324 文件**，均完整绑定到各自 receipt。这里包括实际 config.status/config.log、全部中间 Makefile/Libtool、Git/TeX 原始日志和 recorder、实际运行代码副本。它们含真实绝对执行路径及诊断，不声称两侧 raw workspace 字节相同，也没有删除其路径/字段来凑一致；不是最终材料候选文件。

| 旧新检查 | 结果与限制 |
| --- | --- |
| ChangeLog | 2,082 条可达历史、完整图谱、正文与旧字节一致 |
| PDF | 19 页、同 Letter 页面，完整 layout text 逐字节相同（44,996 字符）；Producer 从 1.40.25 变为 1.40.29，PDF 1.5→1.4、字体/确定元数据设置改变；全部字体实际嵌入，旧新原字节均保留 |
| PDF 目视 | 已实际打开 19 页 contact sheet、旧新第 10 页放大图；4/19 页像素相同，其余字体绘制有差别，正文及结构兼容通过。原 libffi.texi:603 的 overfull hbox/黑色标记在旧 PDF 同样存在，原样保存，不改原源码来消除该警告 |
| Expat | 新旧宏逐项对比，只有 HAVE_CXX11、HAVE_GETRANDOM、HAVE_SYSCALL_GETRANDOM 从定义转为未定义：本轮未启用需要 C++ 的测试/例子，后两项为固定 Darwin 探测结果。配置参数、完整差异与实际 C 头部结构编译保留；真实应用/链接/Pi/资源兼容归 G2-00-04 |
| 111 宏/脚本与五模板 | 候选字节未变；改变的是补充的当前确定供应/重建链与账本，不改写原历史未知 |

限定自动化和真实拒绝：

- 支持的两种 Node 各 **11/11 PASS**：legacy 5、新入口 4、文档链接 2。入口按总规格已确认的公开 CLI 边界做 red→green；缺输入用例的初始夹具路径重叠失败单列保留，修正夹具后仍断言明确缺输入拒绝。
- 本轮完整固定材料的 **20 类 × 双 Node = 40/40** 实际公开入口拒绝：缺 Git/font/嵌套宏/Debian patch、同长度 source/tool/license 漂移、执行位消失/部分执行位、未知 overlay、错误用途、伪造 PASS manifest、成员/根/父目录 alias、旧失败保护、输入/checkout/旧 origins/原 kit 输出。每次 exit 1、预期错误及零新输出均留证；保留 `P/negatives-v3` 的完整独立输入、失败记录与汇总。
- 同正式生成 policy 的网络负例：沙箱外正控制，独立 loopback server 对每种 Node 各收到 **1** 次；沙箱内均 exit 77 / EPERM，对每种 Node 各收到 **0** 次。见 `P/network-v3.json`，没有用配置声明代替真实禁网。
- 同 policy 实际尝试向固定输入、旧 origins、原 kit、源码 checkout 四处写 sentinel，均 PermissionError、exit 77，未创建文件；`P/write-protection-v3.json`。
- 四组类型检查及 lint PASS。WebUI 全量组件回归 **17 文件、108/108 PASS**，不是浏览器/Pi 验收。Node 适用回归自然完成，exit 0：**1,790 PASS / 0 FAIL / 0 CANCELLED / 8 SKIP**，耗时 947,191.973 ms；遵守用户“不重跑 #21”，明确排除其 10 条 GIR 用例，不称无排除的仓库全量通过。原命令与完整日志见 `P/node-suite-v3.json/.stdout/.stderr`；这次限定新运行不改写历史全量 FAIL 或其他 PARTIAL 结论。

## 失败、保护及 #21 同步

保留 `P/fixed-inputs-v1`、v1 失败输出、最初 TeX format 缺 pdftexconfig 的失败、获取源容器的 HTTP/TLS 失败、原 autoheader 失败和全部旧 HTTP 比较材料。第一次公开重放在 ChangeLog 的默认缩写长度断言失败：完整镜像与仅 2,082 提交的 bundle 对 merge parent 的默认缩写分别为 8/7 位；新候选将 `--abbrev=8` 显式固定，不改写 v1 失败。`code-v1`、`code-v2` 保存对应源/合同；最终入口还逐次保存实际运行代码。中间 v2 成功不替代最终 v3 双 Node。

入口基线唯一修改的已有文件为本轮 CLI，其余 **1,739/1,739** 的字节、大小及权限/链接目标未变。旧 supplement **1,002/1,002** 和原 kit 中本轮五棵完整源树 **3,122 文件**另行逐字节/执行位核对，kit/source-inventory/overlay 元数据不变，见 `P/workspace-preservation-v3.json`。仅本轮六文件进入提交，保留其他 tracked/untracked 工作和原 AGENTS.md。

用户明确要求同步的 [#21 原进展评论](https://github.com/Ricardo121380/only-my-pi/issues/21#issuecomment-5950149107)已保留原全文后追加 2026-10-15 交付与“没有，保留阻断并交付已核实材料”的决定；PATCH 一次，随后独立 GET 回读正文、issue OPEN/原 metadata 及分页 dependencies，见 `P/issue21-sync`。原 Apple 等引文条件、PangoXft 未确认接口及 Spec 两项阻断继续存在。没有重跑/重试 #21、放行其候选、删除依赖、修改 #19/#23，或提前创建新 kit。

## 独立两轴与交付边界

按 code-review Skill，对入口 HEAD `47adc12331fa1f17280aed21316f97b79e4121cb` 以来本轮六文件做独立两轴审查。用独立 index 冻结为 `9b0197058be81dd80ae778e9b1c875090754ecf5`，实际分支及 index 未动；`P/review-v3.json` 记录完整 diff 命令、提交和逐文件源码身份。两名探子只读审阅，未执行测试或修改，主线程负责实施及最终验证。审查后只补记结果与适用回归，不改驱动、合同、固定输入或生成结果。

- **Standards PASS：0 findings，0 明文规范违规，0 可行动 smell；最重项无。** 已按 AGENTS、CONTRIBUTING、相关 agent 文档、ADR-0017、领域词汇及十二项 smell baseline 核对冻结差异。历史合同/外部归属、输入和环境保护、证据层次均保留。
- **Spec PASS：0 findings；最重项无。** 当前 #22 的三项新生成、五模板复用、三个静态对应、111 宏/脚本、当前条件、双目录、双 Node、禁网、负例与后续交接均有对应证据。独立静态核对全部 111 路径、声明和来源指针，63 个固定成员与当前文件相同、111 完整声明与当前文件相同；另行抽查 Libtool 2.6.2 完整包的 Expat 重建基线、最终 v3 receipt 与代码身份，没有发现具体未闭合的当前必需材料条件。保留原补丁作者及历史调用未知不改为历史 PASS。

两轴最终结果保存于 `P/review-results-v3.json`。主线程随后回读适用回归已自然结束及 exit 0，并重新核对本轮代码/输入/输出身份；结果分别列于上节。#22 的材料切片验收 PASS，历史 UNVERIFIED、整体 licensing INCOMPLETE 及各后续 NOT_RUN 保持。当前 GitHub #22 仍 OPEN；本轮远程写入为用户明确要求的 #21 进展同步，没有关闭 #22 或改变 #23 依赖。

Standards：0 项，最重项无；Spec：0 项，最重项无。

本轮没有对新材料候选开展实际 Pi/浏览器、native 应用构建、Full、日常安装切换、部署或发行，也没有真实外部 Provider 调用。适用回归实际执行了仓库已有的 Pi/Host 与本地受控服务夹具；它们没有注入或运行本轮新 native/parser 材料，不能替代新材料在 G2-00-04 的 Pi/资源运行验收。
