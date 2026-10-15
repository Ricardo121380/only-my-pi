# G2-00-02 / #21：固定供应输入与 GIR 技术重放，当前准入仍阻断

日期：2026-10-15。规格为 [#19](https://github.com/Ricardo121380/only-my-pi/issues/19) 与当前 [#21](https://github.com/Ricardo121380/only-my-pi/issues/21)。本轮结论 **PARTIAL / candidate admission BLOCKED；#21 保持 OPEN**。可复现性和来源文本对应已取得新证据；所有 GIR 引文与当前复制／加工条件尚未闭合，不能关闭本工单。

## 基线与证据身份

- 入口 HEAD：`9ae11933559296aaed95422e56191cc5473a9601`，分支 `codex/webui-phase1`。入口工作区含大量已有修改，已对 1,735 个 tracked/untracked 文件记录字节、大小、mode 或链接目标；原 index 为空。
- 本轮证据根：`LOCAL_WORKSPACE/artifacts/issue21-gir-candidate-20261015T051510Z`，下文简称 **P**。回执、完整归档与大体积输出保留本地，没有上传或制造远程材料链接。
- `P/preflight` 保存 #19–#23 正文、评论和 native dependency 回读。#20 已 CLOSED；#21 无本批前置；#23 对 #20/#21/#22 的既有关系未删除，#21/#22 仍 OPEN。
- 保留原 `G2-00-02-1002-exgdn48v/frozen-origins` 的全部 75 文件、原 kit 的 53 文件/40 GIR、旧 FileError 局部台账、历史 `UNVERIFIED` 和既有 `PARTIAL`。新路线使用独立合同 [native-gir-candidate.json](../../contracts/release/parser-resources-v1/native-gir-candidate.json)，未改旧合同或旧验收结论。
- 当前固定输入 `P/fixed-inputs-v2` 共 **491 文件、1,138,554,877 个被清单覆盖的内容字节**，完整 `manifest.json` 身份为 `sha256:7d74632f459e665763477177a028a425d45cf85d700bea60091f98e5f95ccc25`。大小不含 manifest 本身。每项摘要、大小与执行位由 manifest 绑定；包含原始供应归档、完整源码归档、请求回执、旧完整材料、私有工具和处理配置。

## 实际供应与加工

40 个 GIR 都从本次实际取得的原始归档成员重新读取；生成器不从旧加工后 GIR 补缺。13 个辅助文件保留完整旧字节、目录及 mode。每个原始 GIR 的供应归档、完整归档摘要、member、原始大小/摘要、目标平台和源码对应项目见 `materials/config/processing.json` 与 `generation-bindings.json`。

| 输入对象 | 固定供应事实 | 保留范围与边界 |
| --- | --- | --- |
| Linux 31 GIR | `ghcr.io/gtk-rs/gtk4-rs/gtk4@sha256:cda34579f0bfc1f8eeb9150b52bb3fbc69f3d7ce219f26468fe9ea9102bb22eb`，创建于 2025-12-29；manifest/config 和全部 5 layer 实际下载、逐摘要核对 | 完整层归档保留。这个镜像实际缺 Atk、GTK3 三件、PangoXft；原提取失败保留，未假称供应 36 件成功 |
| Linux Atk | Fedora Koji `atk-devel-2.57.0-1.fc43.x86_64.rpm` | 完整 RPM、SRPM 和 at-spi2-core 2.57.0 完整源码；加工结果与旧 Atk 完全相同 |
| Linux Gtk3/Gdk3/GdkX11-3 | Homebrew Linux x86_64 GTK 3.24.50 bottle，blob `sha256:9c268910b9653112e7f8b74b895ddd2939fa1dcaac4ceb110508e100179e616f` | 完整 bottle、固定 formula 和完整 GTK 3.24.50 源码；未用另一个镜像中较新的 GTK 3.24.52/Atk 2.60.6 替代 |
| Linux PangoXft | gtk3-rs 固定 manifest `sha256:dad3b701c118b966010e96d21ca42af0e2151901ae4b638c2f27a218c27ca249` 的完整末层 `sha256:d39d97d1989dd48f2865c3c7cdfc3160afc0eff8feb6e30566bf10117134934a`，实际 pkgconfig 为 Pango 1.57.1 | 作为完整固定 layer 成员供应，未声称已下载或执行这个镜像的所有基底层。新增接口元数据仍阻断准入 |
| Windows GLibWin32/GioWin32 | MSYS2 UCRT64 glib2 2.86.3-1，完整包摘要 `sha256:4c28bf93ab0ad77354ce41e6c15157d3b13f199dc4eb9580ac436411b4b79b6a` | `.PKGINFO/.BUILDINFO`、固定 PKGBUILD、全部相关补丁/hooks、完整 GLib 2.86.3 源码归档保留；旧 Windows 包版本未知 |
| Windows GdkWin32 | MSYS2 UCRT64 gtk4 4.20.3-1，完整包摘要 `sha256:2f55626bdf2356446e6f331d66fad5f80b7d9d295775826281ac2e4b26da04ec` | 固定 PKGBUILD、全部相关补丁、完整 GTK 4.20.3 源码保留；这三份 Windows 加工后 GIR 均与旧字节相同 |
| macOS GdkMacos | Homebrew GTK 4.20.3 arm64 Tahoe 完整 bottle，blob `sha256:b148c5fa5231680513700b3c6bbcebd78889be3dea019c90d5fe87dcc98a4e69`，固定 formula | 原 GNOME macOS job 5951505 artifact 已过期、实际 GET 404 留证；新 bottle 是独立供应，不能补写旧 job 身份 |

另保留 GLib、Pango、Pixbuf、HarfBuzz、Graphene、GTK4、gobject-introspection 1.84.0 等完整源码归档。Linux Git 源码提交在镜像构建窗口内选择，并逐节点核对实际供应 GIR 的注释文本；**文本对应不是旧镜像当时编译器、clone 时刻或源码提交的历史证明**。所有旧供应身份/历史 GNU manual edition 仍 `UNVERIFIED`。

公开入口为 `scripts/probes/webui-g2-gir-materials.mjs --candidate <absolute-fixed-inputs> <new-absolute-output>`。原 legacy 入口及其 `PARTIAL` 含义保留。新入口验证不可变 manifest、全部输入字节/mode、环境与工具后，复制完整材料，在实际禁网沙箱内从供应归档重新提取 40 个原始 GIR，执行原 `reformat.sh` 和 `fix.sh`。完整原始/派生对象分别保留；未知 overlay、转换或漂移在执行前被拒绝。

XMLStarlet 1.6.1 从完整官方源归档在本机私有目录编译，libxml2 2.9.13 / libxslt 1.1.35；configure、make、install 均实际禁网执行，配置、编译日志和私有二进制冻结。首轮工具源码解包 hardlink 失败及 out-of-tree make 失败保留；成功的 in-source build 无源码补丁。首轮公开 CLI 还暴露宿主 PATH 隐含 zstd 依赖，失败输出与回执完整保留。随后从完整 Zstd 1.5.7 源归档编译仅链接系统 libSystem 的私有工具，关闭 zlib/lzma/lz4 适配；未安装全局工具或改动 Homebrew 配置。构建中 md5/md5sum 不在固定 PATH 的警告保留，构建 exit 0；实际解压成功由随后双重生成证明。

## 独立生成与旧新差异

同一固定环境：Darwin 27.0.0 / macOS 27.0 build 26A428 / arm64；系统工具文件摘要、私有工具、固定 locale/TZ/Python 环境和沙箱 policy 全部绑定。

| 独立目录 | 实际 Node | 公开 CLI 结果 | 完整输出 |
| --- | --- | --- | --- |
| `P/replay-node22-v4` | v22.19.0，binary `0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1` | exit **2**，`PARTIAL_CURRENT_CONDITIONS_BLOCKED`，technical replay PASS | 2,269 文件 |
| `P/replay-node24-v4` | v24.19.0，binary `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1` | exit **2**，同上 | 2,269 文件 |

两次均从未加工成员实际生成，包含实际 XML 转换和 GTK3 D-Bus 注释所需的 gdbus-codegen 模板执行；不是复制第一次派生结果。完整输出清单摘要均为 `sha256:336c8380a3923400ed4fe666c85f994ecb9d240c129411aa9d65d3b6bb8b0475`。主线程另行读取两棵完整输出，比较所有文件字节、大小与执行位，**2,269/2,269 一致，总计 1,327,126,925 字节**。没有删除未知字段或只比较 GIR 子集。时间、绝对进程路径及 Node 身份仅在输出根之外的执行回执中，不影响生成对象比较。

53 个候选文件保持 **49 个 100644、4 个 100755**。50/53 与旧候选逐字相同，全部旧 XML 节点、既有文本及 C 签名保留；差异如下。

| 文件 | 精确差异 | 本阶段结论 |
| --- | --- | --- |
| GdkMacos-4.0.gir | 新增 doc namespace 及 `doc:format=gi-docgen` | 既有 namespace、shared library 和签名未变；新输入 GTK 4.20.3 是明确独立身份，旧 macOS 源版本未知 |
| Gtk-3.0.gir | 同版本 3.24.50，`gtk-print-backends` 的 supplier build default 从 `file,lpr,cups` 变为 `file,lpr` | 配置差异明确保留；不能从材料推导实际应用打印能力，实际构建/资源兼容留给 G2-00-04 |
| PangoXft-1.0.gir | 同 Pango 1.57.1，新 scanner 增加 FontMap 的 `Gio.ListModel`、4 个现存源码注释、doc format、screen default 0、RendererPrivate opaque=1 | 旧节点/C 签名/文档无删除，但新增接口元数据尚未确认，**接口准入 BLOCKED**；没有借此修改应用运行栈或默认 kit |

确切 owner 路径、全部前后属性、每项字节与摘要见生成的 `compatibility.json`。本轮没有替换原候选或将新材料注入当前 native kit。

## 文档、引文与当前条件

候选全部 **84,610 个 doc/doc-deprecated/doc-version 节点**已有逐项文本来源对应：84,604 项为声明位置/owner 对应源码的完整规范化文本，4 项为逐字节钉住源文件与文档的已核对 gtk-doc 元数据投影，2 项保留同源码包内所有完整文本匹配。共保留 1,642 个完整对应源文件及原头部，完整源码包同时保留，不以摘取文件替代完整包。原固定 `fix.sh` 删除的 28 个 raw 文档节点单列留证；没有为解决权利缺口新增删文档步骤。

这证明 **source text correspondence**，不证明全部第三方权利或历史生成身份。来源含 14 个 GTK3 生成 C 注释节点：用固定 GLib 2.87.0 gdbus-codegen、原 GTK3 XML 与原 Meson 参数新执行生成其对应文本，保留完整模板和生成 C/H；不冒称复现历史包里的 codegen 二进制。

外部来源上下文的 437 个完整文本分五组逐条阅读（77/106/78/85/91）；主线程回读确认 437 个全文均在当前候选存在。该集合是外链/归属线索的人工复核范围，**没有把关键词集合或机器文本匹配冒充 84,610 项全部人工阅读/法律许可审查**。不能据此签发 #21 AC3 PASS。

| 对象与承重原文 | 本轮核实 | 尚存当前条件 |
| --- | --- | --- |
| GLib FileError，`glib/gfileutils.c:132–138` 的 GNU manual 特别归属 | 原 25 项、归属全文、GNU texinfo、完整许可章节与 HTML manual 保留；原 `EXIST→EPERM` 实际对应也保留 | 历史所引 manual edition 及适用 permission 仍未知，不能用顶层 LGPL 或旧比较材料补造 |
| GLib RFC3986 URI grammar，`glib/guri.c:2842–2848,2870–2876` | 确有 ABNF 摘录；完整 RFC3986、RFC3667/BCP78 及 Internet Society 2005 notice 冻结 | 未把电子帮助短摘录例外直接套给当前材料/最终呈现 |
| GLib Windows application-data 长段，`glib/gutils.c:2725–2729` | 与 Microsoft CSIDL 的 spell-check/clipart/nonroaming 段对应；原文及 CC BY4.0 全文保留 | 当前比较文件不能证明历史使用版本；需在实际交付时保留相应归属、修改标记等适用条件 |
| Gio application ID restrictions，`gio/gapplication.c:1822–1873` | 明确写转载限制；固定 D-Bus 1.16.0 规范、完整归档 COPYING 与 AFL2.1/GPL2-or-later 全文保留 | 规范文件自身无 copyright/SPDX/许可声明，package 与文件的精确映射仍待核；未把作者名单当版权所有人 |
| Gtk4 VFL，`gtk/gtkconstraintlayout.c:1961–1990` | 有改写的 Apple grammar 与相同示例；Apple 原页及当前条款完整保留，GTK 自身的 GNOME/LGPL 头部另列 | **未取得允许当前复制/改写该外来部分的可核验证据**；没有推定 GTK 头部重新授予 Apple 权利，也没有作侵权判决。此项足以保持当前准入 BLOCKED |
| Graphene CSS/Graphics Gems，`src/graphene-matrix.c:2050–2056`、`src/graphene-euler.c:31–92,194–200` | 固定 CSS 2019 文档、其实际指向的 W3C 2015 Software and Document License、完整 Graphics Gems source/独立许可保留；先前错误的 2023 比较许可保留 | Euler 长段表达的外部出处、可能的 kernel DMA-BUF 改写仍未完成逐原文比对；不能只按数学事实/链接直接放行 |

GTK3/ATK/Pixbuf 对应头部存在 LGPL2/2.1 与不同版权所有人；Pango 同文件内还有 ICU/IBM 和 Tk 来源通知；HarfBuzz 为 Old MIT 并有子目录例外；Graphene MIT 与 Graphics Gems 独立许可分开。完整原文保留不代表它们可以统一归为仓库 MIT，也不自动解决例外文本的使用依据。

主要外部原文：[Apple VFL](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/VisualFormatLanguage.html)、[Apple 条款](https://www.apple.com/legal/internet-services/terms/site.html)、[RFC3986](https://www.rfc-editor.org/rfc/rfc3986.txt)、[RFC3667](https://www.rfc-editor.org/rfc/rfc3667.txt)、[W3C 2015 许可](https://www.w3.org/copyright/software-license-2015/)。事实核对与不确定性记录不是专业法律意见或完整许可签核。

`current-obligations.json` 对 53 个对象逐项绑定当前身份、用途、状态，并把各项义务与原文、适用前提、所需证据及 Gate 对应：#23 新 kit 聚合核验；G2-00-04 实际 build/Pi/resource 与其真实条件；G2-00-05 最终包/默认发行/ledger/双 SBOM/notices/源或重链接履行；G2-00-06 隔离 Full 和发行核对。当前前提不推迟到这些未来事件。

## 负例与验证

- 两种 Node 的受影响自动测试各 **12/12 PASS**（legacy 5、新入口 5、文档链接 2），回执 `P/targeted-node{22,24}-v2.json`。
- 本次完整固定材料的实际公开入口负例 **32/32 正确拒绝**：缺供应包、原始 GIR 漂移、供应包漂移、converter 漂移、额外 overlay、未知转换、执行位消失/部分漂移、用途拒绝、伪造 manifest PASS、成员/根别名、输入内部/checkout/外部旧 origins 与原 kit 输出。每次 exit1、错误码与输出未创建均留证，修改后的独立输入与失败日志保留在 `P/negatives-v2`；最终代码回执为 `P/negatives-v4-summary.json`。
- 同正式生成 policy 的实际网络负例：Node22/24 沙箱外正控制各收到 1 次；沙箱内分别 exit77/EPERM、独立服务各 **0 次接收**。未用配置声明替代禁网实测。
- 同 policy 实际尝试写入固定输入、旧 origins、原 kit、源码 checkout 四处均被 PermissionError 拒绝，未创建 sentinel。回执 `P/input-write-protection-v2.json`。
- 原 v1 输入与失败输出、工具构建失败、历史缺原始供应、过期 macOS artifact、所有 HTTP/TLS/404/timeout、首次 W3C 版本错配均保留。成功重放不改写这些红色证据。
- 入口基线 1,735 项中，本轮唯一修改的既有文件为 CLI，其余 **1,734/1,734** 的完整字节、大小与 mode/链接目标未变（`P/workspace-preservation-v1.json`）；原 origins 75 文件、原 kit 的 53 文件及 kit/source-inventory 身份、固定输入 491 文件已再次核对无漂移，完整最终输出另行逐文件核对（`P/final-independent-parity-v4-strict-v2.json`）。核验器两次因路径排序比较失败的脚本、断言及诊断保留，修正为统一按 path 字符串排序后核对完整清单，没有删减生成 JSON 字段。Standards/Spec 的最终结果见下节；没有运行全量应用测试、真实 Provider、Pi/浏览器、native app build、Full、部署或发行。

## 独立审查与关闭条件

使用 code-review Skill 对入口 HEAD `9ae11933559296aaed95422e56191cc5473a9601` 以来、本轮拥有的六文件变化做独立两轴审查。为排除其他既有 dirty 修改，冻结为 `P/review-v1` 的 `14397a5a2f97d9fed5c0e64b343780543a5a5f86...ffac90a6a81cc267d7a6d27985d0ec2283d34de6`；`P/review-v1.json` 记录真实源与冻结文件 SHA。两名探子均只读，主线程负责实施与最终运行验证；审查后仅补记本节结果，没有改变被验证代码、合同、工具或固定输入。

### Standards

**PASS，findings 0**：文档规范硬违反 0，可行动 smell 0。已按 AGENTS、CONTRIBUTING、验收分层约束与十二项 smell baseline 静态核对六文件及身份，未纳入其他 dirty 工作。该结果只评价冻结差异的 Standards，不替代 Spec 或完整许可准入。

### Spec

**PARTIAL，findings 2；新增代码／报告修正项 0**。两项均为已经披露的完成缺口：

1. AC3/AC6 要求全部 GIR 文档的引文、版权/许可原文与当前适用条件；84,610 项文本对应和 437 项上下文全文阅读不足以使它们 PASS，Apple VFL、GNU manual、D-Bus、Graphene 等事项仍待核。
2. AC8 与“接口合同改变先单列影响再确认”要求尚未满足；PangoXft 新增 Gio.ListModel 等元数据保持 BLOCKED，未注入旧 kit。

审查抽查双 Node v4、完整 parity、32 项拒绝与实际网络回执，未发现范围扩大、额外实质实现错误或把技术结果升级为关闭结论。两轴均已交最终结果，分别保存在 `P/review-results.json`。

| #21 AC | 本轮状态 | 证据或限制 |
| --- | --- | --- |
| 1：53/40 完整固定供应 | PASS_CURRENT_INPUT_IDENTITY | 完整供应归档/member/raw 摘要及目标平台；旧供应历史仍 UNVERIFIED |
| 2：实际离线加工与固定工具 | PASS_TECHNICAL_REPLAY_ONLY | XMLStarlet/Zstd 构建、原脚本执行、全部配置与原始/派生字节分开；不表示当前使用条件已满足 |
| 3：全部文档、引文与许可适用 | PARTIAL / BLOCKED | 文本对应完整，外来引文适用条件未完整核实 |
| 4：native/外围/完整源包义务区分 | PASS_SCOPED_OBLIGATION_SEPARATION | 完整归档、真实源头声明和各事件 Gate 保留，未按“不在库图”裁剪 |
| 5：supplement 与输入保护 | PASS_INVENTORY_AND_PROTECTION | 491 固定输入、2,269 完整输出、摘要/mode、原输入最终回读、失败记录 |
| 6：逐项状态与当前条件 | PARTIAL_CURRENT_CONDITIONS_BLOCKED | CLI 强制 exit2，当前缺口未推迟至后续 Gate |
| 7：两独立目录全部生成对象一致 | PASS_TECHNICAL_REPRODUCIBILITY | 最终代码双 Node v4 与主线程完整逐文件/mode 复核 |
| 8：旧新差异与本阶段接口兼容 | PARTIAL / BLOCKED | 50/53 字节不变；三项差异完整记录，新增接口元数据未获确认；真实 app/Pi/resource NOT_RUN |
| 9：公开入口、双 Node、禁网、负例、两轴记录 | PASS_SCOPED_VALIDATION_AND_REVIEW_RECORDED | 每种 Node 12 测试、32 次真实拒绝、网络独立接收计数、四处实际拒写；Spec 的两项阻断仍保留 |

Standards：0 项，最重项无；Spec：2 项，当前引文/复制条件及未确认接口变化阻止关闭。**#21 保持 OPEN/PARTIAL，整体 licensing INCOMPLETE、G2-00/Full/U2 不放行**。#22、#23 及后续 Gate 本轮不推进。

恢复验收所需的是可核验的外来引文当前使用依据及剩余逐项审阅，并对 PangoXft 明列的接口变化作出确认或取得合适的固定供应；普通的“继续执行”不能替代第三方使用依据。后续通过须使用独立新身份与新回执，不改写本轮红色和 PARTIAL 证据。

## 用户答复与本轮交付

2026-10-15，用户对 Apple VFL 引文依据的询问明确答复：“没有，保留阻断并交付已核实材料”。据此，本轮以已核实材料交付收束：#21 保持 OPEN/PARTIAL，当前候选准入保持 BLOCKED；该答复没有补充外来引文的使用依据，也没有确认 PangoXft 接口变化。

继续沿用上述固定输入、双 Node v4 输出、完整 parity、负例及两轴审查回执；本次只补记用户答复，不重新生成、不修改合同或运行代码、不改写既有验证与失败结论。#22、#23 及后续 Gate 保持原边界。
