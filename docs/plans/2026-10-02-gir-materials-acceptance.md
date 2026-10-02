# 02 / #21：GIR 供应、加工与手册引文材料

日期：2026-10-02。**固定文件、供应与加工账本、GLib 引文对应及独立 supplement 已完成本地验证；工单 #21 仍为 PARTIAL。** 尚未取得加工前供应字节和全部历史身份，不能关闭工单。G2-00-02 PARTIAL、完整许可 INCOMPLETE、整体 F02/G2-00 未通过、Full NOT_RUN、U2 BLOCKED，产品 Task 仍为 20/44。

范围来自 [#21](https://github.com/Ricardo121380/only-my-pi/issues/21)、[US-008 总规格](2026-10-01-webui-remaining-spec.md)、[本批任务映射](2026-10-01-engineering-ticket-map.md)及 [ADR-0017](../decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)。本次不修改原 kit、既有报告或其他材料工单的 supplement，不运行浮动 regen。审阅起点为 `c9b756ea6a0e065e9723fbdfa0905db3fecfefe8`，当前分支为 `codex/webui-phase1`。

本次只新增 [固定合同](../../contracts/release/parser-resources-v1/native-gir-materials.json)、[材料 CLI](../../scripts/probes/webui-g2-gir-materials.mjs)、[CLI 测试](../../tests/release-gir-materials.test.mjs)和本记录。证据根目录为 `LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-02-1002-exgdn48v`，以下称 `$runRoot`；原始材料、回执及失败日志均保留在仓库外。

## 固定输入与新补充包

| 输入或产物 | 固定身份 | 本次实际核验 |
| --- | --- | --- |
| locale kit | `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622` | 精确 kit receipt、完整 source inventory 原字节，以及其中 GIR 的全部 53 文件；wholeKitRevalidation=NOT_RUN |
| source inventory | `sha256:893ed818deef7d1c289febe11bf3aa908ba4acfd784c0711dd8daa721963f053` | 53 个对应条目的摘要和 Git 执行位均与当前源文件一致；其他来源文件没有重验 |
| 原 GIR review | `$runRoot/frozen-origins/prior-review.json` | 保留原报告全部字节；53 文件摘要与原报告逐项一致，不把旧版本线索升级为原供应证明 |
| gir-files 固定提交 | `6cef10cd64dfe5839e6693676852479fe7c9aac8` | 官方提交、Git tree、完整归档及 53 个 blob/mode/SHA-256 与 kit 三方一致；这是加工后的仓库快照 |
| 固定来源清单 | `sha256:c6b33c541b7e17eab77a9d9e3abca666ee5fd0a4100b1b6eb48b75f35ddae75e` | 74 个原材料文件及清单自身，共 75 文件完整复核 |
| 本次合同 | `sha256:dcace8f94c42e8a175abbd2cc3a501bb7fab98e246c19b4fa2497853ccda46cd` | CLI 内固定合同摘要；变更其 PASS/Full 声明不能绕过检查 |
| 新 supplement | `sha256:fca98e127d942ffad3ec9d5534a8e86c040a213aa189253cb14611f276783c5c` | 131 文件全部摘要、大小、执行位复核；Node 22/24 生成相同清单和身份 |

131 文件包括 `candidate/` 下 53 个当前文件、`origins/` 下 75 个来源/回执/原报告文件，以及 kit receipt、完整 source inventory 和合同。完整清单由实际输出回读产生，保存在 `final-node{22,24}/gir-materials.json` 的 `supplement`。输出文件再次读取后才记材料清单 PASS；输入检查失败在创建输出前退出。源包、supplement、kit 与未来 binary/stack 身份分别记录。

19 次有界公开 HTTP GET 均保存原响应、URL、状态、摘要及时间，没有读取凭据或执行下载脚本。来源中包括实际 403 日志响应及 GNU 手册题头路径的 404；失败回执没有删除或改成成功。签名核验未运行。原归档只做受限读取和 53 文件集合/blob/mode 对照，不把它称为原供应包。

## 40 份 GIR 的供应与加工链

机器合同和报告的 `rows` 对全部 40 份 GIR 各自保留 package、ABI namespace、常量线索、当前字节/摘要、供应脚本、适用 fix 命令行区间及该命令原字节摘要。ABI 版本、普通 VERSION 常量或键名匹配都不自动成为原包发行版本；没有常量的条目也不推定与同族文件来自同一构建。

| 固定配置中的供应路径 | 数量 | 本次固定的证据 | 尚未绑定的原输入 |
| --- | --- | --- | --- |
| `dl.py`：gtk-rs 容器的 `/usr/share/gir-1.0/` | 36 | 完整文件名清单、复制规则、CI 中的 `ghcr.io/gtk-rs/gtk4-rs/gtk4:latest` | 当时 OCI digest、构建来源/原包版本、36 份未加工 GIR 摘要；脚本缺文件只打印，成功 run 不证明每份均重新复制 |
| `dl-win32.sh`：MSYS2 ucrt64 | 3 | `GdkWin32-4.0.gir`、`GLibWin32-2.0.gir`、`GioWin32-2.0.gir` 的下载/解包规则 | 两个精确 gtk4/glib2 包版本、原包摘要及未加工文件；没有把当前版本查询当成历史版本 |
| `dl-gtk-macos.py`：GNOME GTK GitLab | 1 | project 665、`macos: [macosarm]`、`_build/gtk/GdkMacos-4.0.gir` 及 artifact 规则 | 当时 pipeline/job/source SHA/artifact 摘要和原 GIR；按最近更新 pipeline 找成功 job 不是固定版本 |

固定 CI 的顺序为 Linux 复制 → Windows 获取 → macOS artifact → `reformat.sh` → `fix.sh`。README 的 GNOME SDK master 路径保留为另一条文档路线，不能拿来替代此次实际 CI 的容器路径。[固定 CI](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/.github/workflows/regenerate_scheduled.yml)、[固定供应脚本](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/dl.py)。

`reformat.sh` 对全部 GIR 删除 `doc/@line`、`doc/@filename` 与 `source-position`。`fix.sh` 有 24 条固定 xmlstarlet 命令，涉及类型、ownership、annotation 和节点删除；合同只对命令涉及的文件建立行区间对应。未涉及 fix 的文件仍经过 reformat，不能据此称其原始字节不变。删除转换无法唯一逆推原 XML；历史手工修改及 xmlstarlet/libxml2 版本为 UNVERIFIED，实际原输入到固定 GIR 的离线重放为 BLOCKED。[固定 reformat](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/reformat.sh)、[固定 fix](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/fix.sh)。

已保存 [run 20569759517](https://github.com/gtk-rs/gir-files/actions/runs/20569759517) 与 job 59074482738 的完整公开元数据。run 使用 `ef7c8d351e5796ae223496d46d05d0d94d49ae50`；生成提交 `2d3eca5c177410cb3f2a48ced7b64809b0ee3c72` 有同一父提交，时间落在 run 窗口内。**对应关系是父提交与时间的推断**，未取得 Create PR 日志，不声称日志证明其创建 PR #277。当前 artifacts 接口回读 0 项，不意味着历史从未存在 artifact；logs 接口实际返回 HTTP 403，不解释为日志不存在。

## GLib 与 GNU 手册的具体引文

亲读 `GLib-2.0.gir` 的 FileError 归属说明及全部 25 个成员，按原字节区间和摘要保留，与 GLib 2.87.0 的固定提交 `837a6eca8e20340a7a6a81e82c3a6cb0dd70b8e0` 的 `glib/gfileutils.c` 逐段对应。**25 条及归属说明在只移除 C 注释前缀、XML 实体编码和折叠空白后全部相同**；这不是重跑 g-ir-scanner，也不是确定了历史供应提交。[固定 GLib 原文件](https://github.com/GNOME/glib/blob/837a6eca8e20340a7a6a81e82c3a6cb0dd70b8e0/glib/gfileutils.c)。

另保存 GNU 官方目录的完整 2.2.3 HTML 手册与 Error Codes 页面，以及 glibc-2.2.3 源提交 `fa39bea49e8023069711bded87d3d1398717bc1a` 的完整 `manual/libc.texinfo`、`manual/errno.texi`、`manual/lgpl.texinfo`。源码题头自身写的是 2.2 Beta/1999，这一原文与 tag、已发布 HTML 的身份分别保留，不推定 HTML 是由该提交确定构建。GNU 2.2.3 是取得的可比对材料，**历史被引用手册版本仍 UNVERIFIED**。[官方 Error Codes](https://ftp.gnu.org/old-gnu/Manuals/glibc-2.2.3/html_node/libc_17.html)、[固定源题头](https://github.com/bminor/glibc/blob/fa39bea49e8023069711bded87d3d1398717bc1a/manual/libc.texinfo)。

逐成员账本保留 GLib 文本、GNU 宏段的完整区间摘要与人工比较结论，没有只凭关键词或 API 名称认定许可：

| 与取得的 GNU 2.2.3 errno 原段关系 | 数量 | 成员后缀 |
| --- | --- | --- |
| 只折叠空白后相同 | 11 | EXIST、ISDIR、ACCES、NOTDIR、NXIO、LOOP、NOSPC、NOMEM、BADF、INVAL、PERM |
| 引号排版变化 | 1 | NOENT |
| 节选原说明 | 4 | MFILE、NFILE、AGAIN、INTR |
| 改写、缩写或附加 GLib 说明 | 8 | NAMETOOLONG、NODEV、ROFS、TXTBSY、FAULT、PIPE、IO、NOSYS |
| GLib 自身的通用失败说明 | 1 | FAILED；未冒充 GNU errno 原段 |

原 `EXIST` 文本实际对应 GNU `EPERM` 描述，而不是 `EEXIST`；它与 `PERM` 重复。本次保留原材料，记录该事实，没有修改候选内容或猜测历史意图。`FAILED` 在其他枚举中也有同名成员；最终区间限定在 FileError 父节点内。首轮区间错误被离线对应检查拒绝，其两侧失败日志留在 `candidate-node*.log`，成功的新运行另用 `final-node*`，没有覆盖失败证据。

对 40 文件中的来源/许可关键词做过有限定位，但没有完整审阅所有文档或确证没有其他引文。`documentationReview` 对 GLib 标为局部审阅，其余为 NOT_COMPLETE；此负面范围不会扩大成“除 GNU 之外没有其他来源”。引文探子催收后仍未交付已中断，本段运行与原文结论由主代理核验。

## 原声明、范围与分发条件

| 对象 | 实际保留的原声明 | 条件与完成边界 |
| --- | --- | --- |
| GLib 固定比较源码 | `gfileutils.c` 原版权/文件头、`COPYING` 原链接文本、其目标 `LICENSES/LGPL-2.1-or-later.txt` 全文 | 原链接 30 字节不当作全文；GLib 库/源码声明不自动覆盖文件中另行归属于 GNU 手册的引文 |
| 取得的 GNU 2.2.3 源手册 | 完整 `libc.texinfo` 的版权/复制许可、完整 `lgpl.texinfo`（GNU Library GPL Version 2, June 1991）及 errno 原章节 | 原复制许可要求原版权与许可保留；修改版本另须原样包含所指许可章节，并采用相同复制许可；翻译该许可章节有 FSF 准确性批准条件。不能直接套现代 GFDL 标签；这些条件的历史适用与实际履行仍待核验 |
| 加工后 40 GIR 与 13 辅助文件 | 全部原字节、Git blob、摘要及执行位；加工脚本原配置与来源回执 | gir 生成器 MIT 不覆盖其他供应方或内嵌手册。40 项原包/原文条件仍逐项未闭合 |
| 完整源包与当前 native 目标 | 全部固定 GIR 保留；当前库图本次未重测 | 不参与当前 native 库图不能豁免完整源包的必要材料，不据此删除文件或标为无义务 |
| 本次 supplement | 完整输入/输出清单、原报告及成功/失败来源响应 | 本地材料复核 PASS；actualRedistributionFulfillment=UNVERIFIED，未进入默认发行链或新完整 kit |

这些是材料与条件账本，不是法律审核通过或完整许可闭合结论。没有把工具许可、仓库声明或可比对原文当作所有生成字节的统一许可。

## 实际验证

| 检查 | 本次结果 | 仓库外回执 |
| --- | --- | --- |
| CLI TDD | 先 red 再 green；合同替换、输出覆盖、缺输入、别名/重叠、伪造 kit 的 5 个用例 | `tdd-red-output.json`、`tdd-red-kit.log`、`tdd-red-contract.log` |
| Node 22.19.0 / 24.19.0 相关回归 | 两侧各 24/24 PASS，0 FAIL/SKIP/CANCELLED；5 个新增与 19 个 parser resource 回归 | `focused-runs.json`、`focused-node*.log` |
| 实际禁网探针 | 两侧 PASS；131 文件同一身份，报告除时间外完全一致 | `offline.sb`、`final-runs.json`、`parity.json`、`final-node*/gir-materials.json` |
| 同策略网络负例 | 两侧 loopback 连接均 EPERM | `network-guard-runs.json`、`network-guard-node*.log` |
| 同长度许可漂移、缺 GIR、执行位漂移、未列来源文件 | 两侧各 4 场景拒绝，exit 1、无输出；原材料只读，负例使用独立副本 | `negative-runs.json` 及各场景日志 |
| root / safety / Host / WebUI typecheck | PASS | `typecheck-results.json`、`typecheck-*.log` |
| 仓库 lint / secret scan / 文档链接 | PASS；1,327 个 tracked 文件，0 findings；文档链接 2/2 | `static-checks.json`、`lint-final.log`、`secret-scan-final.log`、`docs-final.log` |
| 仓库全量 Node 测试 | package.json 的 `node --test` 正式入口一次：1,551 PASS、5 SKIP、0 FAIL（共 1,556） | `full-default-node24-receipt.json`、`full-default-node24.log` |
| Web 全量自动化 | 92/92 PASS，11 个文件 | `full-web-node24-receipt.json`、`full-web-node24.log` |
| Standards / Spec 双轴评审 | Standards PASS；Spec PARTIAL，a=3、b=0、c=0 | `standards-review.md`、`spec-review.md`、`review.diff`；仅本次四文件，不含其他 241 文件的改动 |
| 原输入及既有工作树保护 | PASS；241 既有工作树文件、56 原输入、75 frozen origins 文件的字节/大小/执行位保持；既有工作树完整权限保持 | `baseline.json`、`input-protection.json`、`final-protection.json` |

禁网由 macOS `sandbox-exec` 的 `(deny network*)` 实际施加，同一策略负例确认网络连接遭拒；profile 同时禁止写入原 kit 与 frozen origins。新 CLI 没有网络请求、进程派生、原生构建或上游工具执行。每文件最多 16 MiB，累计读取最多 256 MiB，集合最多 256 文件，遍历最多 512 条目及 16 层；不安全相对路径、链接、别名和非普通文件拒绝。此处的实际禁网证明仅覆盖材料 CLI，不是 Full 安装。

首轮较广 Node 回归显式列出根目录 `tests/*.test.mjs`，结果为 1,520 PASS、5 SKIP，但未涵盖包内测试；该回执只记 preliminary 子集。核对 package.json 后，执行上表的正式默认发现入口，取得完整 1,551 PASS。两个日志均保留，由 `suite-scopes.json` 区分；Web 全量只运行一次。5 个 SKIP 是原套件的跳过条件，本次 5 个新增测试全部实际运行通过。typecheck、lint 和套件 PASS 不替代原供应材料、实际重放、浏览器或 Full 的门禁。

两位独立探子仅做静态评审，冻结 diff 的 SHA-256 为 `06c3c9ff172943521361f87b23dc7a03e3507f59275a8b60ec03ffb3516ecb00`。Standards 未发现硬性规范违反或实质性 Fowler 气味。Spec 的 a=3 对应 AC1 原供应字节/版本 PARTIAL、AC2 实际离线加工重放 BLOCKED、AC3 完整引文及适用许可条件 PARTIAL；b=0 表示未发现未请求的范围扩张，c=0 表示未发现把缺口包装成完成或其他错误实现。静态评审没有运行测试、联网或独立核验仓库外回执，不新增运行 PASS；本记录此后只补入评审结论，合同、CLI 和测试均未改变。

在仓库根目录使用现有 Node 22/24 二进制，`$freshOutput` 必须为仓库、kit、origins 之外的新路径，父目录存在且规范：

```sh
/usr/bin/sandbox-exec -f "$runRoot/offline.sb" "$nodeBinary" \
  scripts/probes/webui-g2-gir-materials.mjs \
  LOCAL_WORKSPACE/artifacts/webui-optimization/G2-00-locale-1001-EpCrn4/verified-node22/native-build-kit \
  "$runRoot/frozen-origins" "$freshOutput"
```

退出 0 只表示 `validation=PASS_FIXED_GIR_MATERIALS_AND_COMPARATOR_LEDGER_ONLY`；同一报告明确给出 `status=PARTIAL`、`issueCompletion=PARTIAL`、`originalSupplierInputs=NOT_ACQUIRED`、`actualOriginalToGirReplay=BLOCKED`，不能作为 #21/F02/Full 的 PASS。

## #21 逐项验收与仍需输入

| 工单完成条件 | 本次结论 |
| --- | --- |
| 53 固定文件/40 GIR 逐项原供应包、版本、字节和摘要 | 固定候选与供应路线账本 PASS；原供应字节/版本 PARTIAL，40 项均未冒充已冻结原包 |
| 原输入到 GIR 的工具、配置、改动及离线重放 | 固定规则/行区间 PASS；历史工具/手工改动 UNVERIFIED，实际重放 BLOCKED |
| 手册引文、原版权/许可及逐项范围 | GLib FileError 对应和取得的 GNU 原材料 PASS 子集；历史手册版本、其余 GIR 文档及适用条件 PARTIAL |
| 当前目标、外围生成输入、完整源包义务区分 | 保留完整材料范围；未借库图缺席或生成器 MIT 豁免 |
| 独立 supplement、完整清单/回执/摘要/执行位/保护与拒绝 | 正负例 PASS；最终保护结论见上表 |
| 逐项状态与实际分发条件，缺口保持阻断 | PARTIAL；实际履行 UNVERIFIED，#21 不关闭，#23 前置未解除 |

仍需原 run 的日志或等价固定材料，才能核实容器 digest 与原始 36 GIR、两个精确 MSYS2 原包，以及 macOS job/artifact/原 GIR；随后还须固定加工工具/手工修订并实际重放。历史 GNU 手册版本及其他 GIR 的对应来源/文档条件也未齐。公开日志 403 是访问阻碍，不是用户拒绝或认定材料不存在。本次已询问已有材料位置；未收到路径不能据此选择替换候选或宣称闭合。

取得原输入之前，已授权的独立材料实现、负例、评审与提交继续完成。若决定改用新生成候选，需要另行明确其范围、固定新输出身份并保留本次全部历史证据。新完整 kit 汇总属于 #23，本次不改变其依赖或自动进入下一 G2 步骤。native 应用构建、Full 安装、实际 Pi、真实 Provider、浏览器、日常晋升和公开软件发行本轮均 NOT_RUN。
