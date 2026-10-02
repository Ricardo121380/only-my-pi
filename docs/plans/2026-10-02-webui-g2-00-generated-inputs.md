# G2-00-02 / 工单 03：其余生成输入与分发条件

日期：2026-10-02。对应 [#22](https://github.com/Ricardo121380/only-my-pi/issues/22)、总规格 US-009/US-010；共同约束及测试边界沿 [总规格](2026-10-01-webui-remaining-spec.md)与[首批映射](2026-10-01-engineering-ticket-map.md)。**实现和限定材料验证已交付，工单完成状态仍为 PARTIAL。** 本批不能关闭 #22，也不放行 #23、整体 F02/G2-00、Full 或 U2。

## 范围与实现

新增[固定配方](../../contracts/release/parser-resources-v1/native-generated-inputs.json)、[材料探针 CLI](../../scripts/probes/webui-g2-generated-inputs.mjs)和[公开入口回归](../../tests/release-generated-inputs.test.mjs)。复用[原 368 项清单](2026-10-01-webui-g2-00-notice-inventory.md)，完整保留 476 文件的 notice supplement 及其中 Windows 以外的既有 gettext/xmlwf 绑定，不改原 kit 或历史材料。Windows supplement 独立保留，不重判为缺失。libexif 文档生成域继续属于 #20。

配方逐项记录八个输入、111 个完整宏/脚本和十个材料家族，区分文件自身声明、聚合宏的 include 输入、生成输出声明、包自身 notice 与实际分发条件。生成器版本取自固定材料，辅助脚本按自己的字节来源和 timestamp 记录；gettext 宏自身的 0.18/0.18.2/0.18.3 标记与供应包 0.18.3 分列，Libtool 的 Debian 后缀单独保留。

CLI 不联网或运行生成器。它核对固定配方、kit 元数据、已审核 overlay、原 supplement、独立 origins 的完整文件集合、来源/输出字节和执行位，在全部输入通过后才创建全新 output。原始输入只读，输出不能覆盖原证据，不能位于输入或源码内。单文件上限 32 MiB，累计读取上限 256 MiB，完整集合扫描有数量/深度上限；复制后重核整个新 supplement。缺输入、来源漂移、未审核 overlay 或额外文件退出 1；完整的 PARTIAL 台账退出 0，但报告中的 `status` 与 `issueCompletion` 仍为 PARTIAL。

## 八项输入的实际结果

| 输入 | 固定来源与本轮结果 | 仍未证明的事实 |
| --- | --- | --- |
| libffi ChangeLog | 完整发行文件、发行归档身份及 Makefile.am 的 `git log --no-decorate` dist-hook 保存 | 原 Git 历史图及原调用未取得，历史生成 UNVERIFIED |
| libffi PDF | libffi.texi、version.texi、PDF 规则、2021-04-25.21 的 texinfo.tex 全文与结果例外保存；pdfinfo 记录 19 页及 pdfTeX-1.40.25 | 原 TeX 引擎供应及执行输入未取得；本轮未渲染或再生成 PDF |
| libffi fficonfig.h.in | 固定 Autoconf 2.71、configure.ac、aclocal 与嵌套宏，禁网生成两次，与候选逐字节相等 | 原发行时运行环境仍 UNVERIFIED |
| libexif config.h.in | 固定 Autoconf 2.73 及完整相关宏，禁网生成两次，与候选逐字节相等 | 同上，不含 #20 文档归档 |
| WebP config.h.in | 固定 Autoconf 2.72 和当前已审核输入，禁网生成两次，与候选逐字节相等 | 原发行生成与当前 overlay 分列，不冒充恢复历史 |
| Expat expat_config.h.in | 固定 Autoconf 2.72、嵌套宏、get-version.sh、expat.h；最终两次禁网生成与候选相等 | 首轮漏带嵌套宏失败保留；原发行调用仍 UNVERIFIED |
| libarchive config.h.in | 固定 Autoconf 2.72、configure.ac/aclocal 及宏，禁网生成两次，与候选逐字节相等 | 原发行时运行环境仍 UNVERIFIED |
| Expat expat_config.h | 完整输出、autoheader 模板、configure 规则及包版权保存 | 原平台、编译探测、config.status 与替换过程未取得，UNVERIFIED |

五个模板的通过结论是**本轮确定输入的两次内容复现**，不证明原发行实际使用了同一工具环境。工具安装只在本批仓库外私有目录，构建和生成均禁网；没有安装全局工具、构建 native 应用或更换日常栈。宿主 M4/Perl/make 身份另留证，私有工具快照含其原 prefix，不作为可移植安装包。

spec、stdint、stamp-vti 三个既有静态对应重新核对并保留，仍分别只证明两行模板替换、固定宏分支内容、version.texi 复制相等；它们不证明历史配置、编译探测或日期生成。

## 111 个宏/脚本与分发条件

三版 Autoconf、四版 Automake 与 Libtool 2.4.7 原包经 HTTPS 获取，按完整归档摘要固定；既有 gettext 0.18.3 的原件及收据复制后重新核对。共保留 12 个版本化来源/比较包，完整源归档、指定源码、包声明及复制/例外原文均可离线检查。

| 内容对应 | 项数 | 判定边界 |
| --- | --- | --- |
| 与 HTTPS 或既有固定供应包成员逐字节相等 | 45 | 固定内容来源对应，不等于证明历史运行 |
| 只与 HTTP 镜像比较包成员逐字节相等 | 12 | 固定比较材料；供应认证未闭合 |
| 生成输出或其他历史来源未完全对应 | 54 | 分列生成器源码、包输入或明确 UNVERIFIED，不能合并为全来源 PASS |
| 合计 | 111 | 十个原材料家族完整保留 |

Libtool 2.5.4/2.6.2 与 Texinfo 6.8 的 GNU 镜像获取最终重定向到了 HTTP；归档和所有失败请求都保留，明确标为 `UNVERIFIED_HTTP_MIRROR_COMPARATOR_ONLY`。没有执行这些比较包中的代码，也不拿它们替代认证的历史工具供应。Debian Libtool patchset 与两个未对应的 GNU config 历史快照仍待取得；不因版本字符串近似而认定来源相同。

分发台账逐家族保存实际拟用途、适用前提、全文材料位置和履行状态：

- source kit 中的 Makefile、configure、聚合宏及 gettext/config.rpath 保留各文件声明和包输入 notice。
- Autoconf 分发例外要求随包含其配置脚本的程序分发；GPLv2 与 GPLv3 §7 附加许可分别记录。
- Libtool 文件自身的复制条件与嵌入的生成输出条件分开；例外要求随使用 GNU Libtool 构建的程序或库分发，native 应用构建与最终分发尚未执行。
- Texinfo 宏的 GPL3-or-later 与经 TeX 处理后的结果例外分开；PDF metadata 不能证明例外的执行前提。

当前本地 supplement 保存源与全文材料，**实际最终分发 NOT_RUN、条款履行 INCOMPLETE、例外准入 NOT_GRANTED**。保存完整文本或完成字节对应不能把这些字段改成 PASS。

## 验证与身份

证据根（相对项目父目录）：`artifacts/webui-optimization/G2-00-03-1002-2i5sh008/`。

| 检查 | 本轮结果 |
| --- | --- |
| Node 22.19.0 / 24.19.0 定向回归 | 各 14/14 PASS，三文件，0 fail/skip/cancelled；其中本批 CLI 回归 5 项 |
| 双 Node 实际禁网材料 CLI | PASS；同策略 loopback 连接为 EPERM；原输入与 checkout 写入由 OS 策略禁止 |
| 双 Node 报告及完整复制集合一致 | PASS，只剔除采样时间后完全相等 |
| 每 Node 七个实际负例 | PASS：同长度源字节、执行位、未审核 overlay、缺嵌套宏、许可全文漂移、生成输出漂移、额外文件均退出 1，未创建 output |
| 五个 autoheader 模板各两次生成 | PASS，与候选字节相等；Expat 首次失败独立保留 |
| 类型与 lint（Node 24.19.0） | PASS，四份 TypeScript 配置；lint 纳入本批新增文件，0 findings |
| 全量 Node 测试（Node 24.19.0） | PASS，1556 passed / 0 failed / 5 skipped；五项均要求 `OMP_TEST_STACK_PACKAGE`，本次未指定安装态栈 |
| 全量 WebUI 测试（Node 24.19.0） | PASS，11 文件、92/92 测试；属于本地组件检查，不是浏览器验收 |
| Standards / Spec 两轴评审 | Standards PASS：0 硬违规、2 不阻断的命名/测试重复建议；Spec PARTIAL：3 类已承认验收缺口、0 明确实现错误、0 范围扩张 |
| native 应用 / Full / U2 | NOT_RUN / NOT_RUN / BLOCKED |

新 supplement **1002 文件**，逐文件字节、SHA-256、执行位及全文件集合已经复制后实核，身份为 `sha256:29597c710e2adef1c5c4077ad631879e22e62c52556a2dd549c4524edfcd29a8`。配方身份 `sha256:614000559cfb01c742fe9394f3bd89abc3d9c5070a5d6c31971c28491cd9d318`；输入 kit 仍为 `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622`。本轮重读 464 个相关 source 文件，原 29336 项清单按摘要绑定；未宣称重读整个 kit。新 supplement 不是 kitId、binary/resource 身份或 stackId。

复跑入口：固定 Node 运行 `scripts/probes/webui-g2-generated-inputs.mjs <locale-kit> <prior-notice-report-root> <origins-final> <全新output>`。四参数使用绝对规范路径，来源和配方均固定。本批证据根的 `final-node22`、`final-node24`、`material-verification.json` 保存完整命令、退出码、报告和复制集合；`private-tools`、`autoheader-replay` 保存工具构建、两次生成及原失败；`acquired/requests.json` 保存获取与失败记录。

## 未完成项与后续边界

#22 仍需闭合其余三个输出的历史输入或明确的新生成候选、Debian/历史快照供应、HTTP 比较包的可信来源，以及新 kit/实际分发的条件履行。它们是工单验收缺口，不是已豁免的限制。对应项目前置未满足时，#23 与整体 G2-00 保持阻断；F02/F03 PARTIAL、完整许可 INCOMPLETE、Full NOT_RUN、U2 BLOCKED、产品 20/44 不变。

本次只提交本工单新增文件。既有工作树、原输入、其他 supplement、Windows/gettext/xmlwf 证据及失败记录保持；未修改远程 Issue、推送、发行、日常安装或用户数据。最终保护核对及提交身份见本批 closeout。
