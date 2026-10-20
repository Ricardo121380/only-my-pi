# G2-00-02：逐输入 notice 材料清单与静态生成对应

日期：2026-10-01。**本批完成368项逐输入材料清单、111个宏/脚本的完整字节与例外原文保留、12项剩余输入的静态规则定位，其中3项精确内容对应；材料核验子项PASS，G2-00-02整项仍PARTIAL。** 不是完整许可、历史生成过程、native构建或发行验收。F02/F03 PARTIAL、完整许可INCOMPLETE、Full NOT_RUN、U2入口BLOCKED、产品20/44保持；未开始G2-00-03、U2或Electron。

依据：[上一批xmlwf/gettext绑定](2026-10-01-webui-g2-00-generated-materials.md)、[原368项盘点与43个文档来源](2026-10-01-webui-g2-00-cross-platform-materials.md)、[内部顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)。历史分类/失败和原kit不覆写。

后续进展：[libexif文档归档材料绑定已完成限定核验](2026-10-01-webui-g2-00-libexif-doc-materials.md)，106文件受限解包、19源码页/1353展示行、9指定资产及6组件声明/来源另冻，双Node各9项与实际禁网通过。下文“未解包/待核Doxygen资产”是本清单当批历史事实；CSS组合、Graphviz必要材料和整份文档重建仍未完成，G2-00-02/Full/U2门禁不变。原配方、476文件材料包及报告不覆写。

## 1. 本批Task与出口

| Task内部子项 | 当前实际结果 | 仍未关闭的事项 |
| --- | --- | --- |
| 逐输入材料清单 | 368/368重新核当前候选字节/执行位；每项指向保留的完整文件与原发行身份 | 不是368项许可审核通过，字段明确保留INCOMPLETE与NOT_RUN |
| GNU宏/脚本原文保留 | 111/111完整文件保存，10个不重叠材料家族；包含聚合宏而非只截头300行 | 原工具完整来源/实际调用、嵌入片段的全部条款判定和最终例外条件履行仍需核对 |
| 前批来源纳入逐输入记录 | 215个文档链接43个原手册；10个gettext候选含Makevars及1个xmlwf逐项链接其不同声明/原文 | 不把父目录GPL覆盖单文件例外，不把xmlwf换成库MIT或其他FDL版本 |
| 剩余12项输入 | 全部定位模板/静态规则；spec、stdint、stamp-vti三项精确对应 | 其余9项仅规则/源定位；历史执行、部分文档输出/资产仍待核验 |
| 独立补充材料 | 437个源文件重新核验；476文件supplement复制后再核完整集合、摘要及执行位 | 不是重读全部29336源文件；未改locale kit，也未并入F03/F04 |

## 2. 111项的材料家族与不能省略的范围

以下数量不重叠，合计111。家族是材料审阅标签，不是自动给整文件、生成输出或最终应用重新授予许可。

| 家族 | 项数 | 保留的范围/限制 |
| --- | --- | --- |
| Automake Makefile.in | 35 | 生成器复制声明及包自身输入notice均保留；libexif部分文件另含LGPL-2.0-or-later与不同作者版权 |
| aclocal聚合宏 | 5 | 完整聚合内容及m4_include；顶端复制声明不自动覆盖各内嵌宏/输出声明 |
| Autoconf configure | 5 | 脚本的复制/分发/修改声明与完整内嵌材料；版本不是当前机器工具版本 |
| Libtool独立m4宏 | 20 | 自身复制条件及libtool.m4内嵌的输出GPL/例外分开保留 |
| gettext独立宏 | 9 | 每宏自身版权、复制声明和版本；不把gettext库/父包GPL应用为宏的统一条件 |
| GPL2-or-later＋Autoconf分发例外 | 22 | compile/depcomp/missing/ar-lib/test-driver/mdate-sh；例外前提是含Autoconf配置脚本的程序分发 |
| GPL3-or-later＋Autoconf分发例外 | 8 | config.guess/config.sub；保留GPLv3 §7附加许可原文及各自timestamp |
| GPL2-or-later＋Libtool分发例外 | 5 | ltmain.sh；同条款分发的前提是随使用GNU Libtool构建的程序/库一起分发 |
| Texinfo结果例外 | 1 | texinfo.tex为GPL3-or-later，例外针对TeX处理文档后的结果，不代表宏文件本身无条件许可 |
| config.rpath单文件复制声明 | 1 | 保留FSF原声明、Gordon Matzigkeit来源及“保存notice”条件；不改写成库许可 |

实际固定输入代表出处均在本批supplement的`source/`中：`ffi/ltmain.sh:13–29`、`ffi/doc/texinfo.tex:8–26`、`webp/compile:9–25`、`exif/config.rpath:5–11`、`ffi/m4/libtool.m4:7–33`、`exif/Makefile.in:4–21`、`exif/auto-m4/gettext.m4:1–18`。输出中的statementAnchors/declaredVersionHints只是检索入口，**完整文件才是保留材料，不声称正则穷举了法律条款**。

文件实际声明的Autoconf包括2.71/2.72/2.73，Automake包括1.16.5/1.17/1.18.1/1.19；ltmain包括2.4.7、2.5.4、2.6.2及Debian版本后缀。gettext宏各文件自身有0.18/0.18.2/0.18.3标记；不得统一填写成前批辅助文件来源包0.18.3。Texinfo宏保留2021-04-25.21。未运行这些脚本、宏或生成器。

完整GPL2与LGPL2文本复用固定libexif源库的LICENSES文件，并保存libffi的LICENSE-BUILDTOOLS；GPL3及指定GFDL1.1复用前批已冻结原文，连同父目录声明/源XML一并重新核字节。referenceTexts只提供全文材料定位，不自动赋予其他文件许可。本次3个GNU官方网页核验请求未取到正文，不将其当新网页证据，不因此替换已冻结原文或补造声明。

## 3. 剩余12项：静态来源不等于历史重生成

所有引用行号/完整来源文件摘要见[固定配方](../evidence/2026-10-18-local-development-history.md#local-72382d39a7bd05fe)与最终报告的remainingInputRules。

| 当前输入 | 新核验 | 明确限制 |
| --- | --- | --- |
| ffi/ChangeLog | Makefile.am:156–159的dist-hook以Git log生成 | 原发行历史/调用未建立，不只凭顶端commit认定完整输出重建 |
| ffi/doc/libffi.pdf | libffi.texi:16–42自身MIT-style文档声明；Makefile.in:423–446的PDF规则及Texinfo结果例外 | 未渲染或重生成；不是G2-00-03的PDF解析资产验收 |
| ffi/doc/stamp-vti | **与现存version.texi精确相等**；Makefile.in:447–460最终复制规则 | 只证实保留内容的静态复制；8 August 2026的mtime/日期生成未重现 |
| ffi/fficonfig.h.in | configure.ac:6及文件首行autoheader来源 | 工具/宏输入及输出重现未验 |
| exif/config.h.in | configure.ac:13及文件首行autoheader来源 | 同上 |
| exif/doc/libexif-api.html.tar.gz | doc/Makefile.am:19–36的Doxygen与归档规则；保留Doxyfile.in/footer/README及own notice | 未解包该文档产物、检查其中JS/CSS/assets或重生成，不将库许可推广到第三方资产 |
| exif/libexif/_stdint.h | **与m4m/stdint.m4:37–43的固定分支精确相等**；configure.ac:114调用 | 是宏分支内容对应，不证明历史编译探测；宏自身LGPL notice保留 |
| exif/libexif.spec | **libexif.spec.in仅替换Name/Version两个整行即逐字节相等** | 保留2002 Mark Pulford版权及LGPL-2.0-or-later；不是历史config.status证明 |
| webp/src/webp/config.h.in | configure.ac:775及文件首行autoheader来源 | 未重现全部宏/工具环境 |
| expat/expat/expat_config.h | 文件首行configure→模板声明、configure.ac:110 | 原发行平台/编译器配置与具体替换过程未建立 |
| expat/expat/expat_config.h.in | configure.ac:110及文件首行autoheader来源 | 未重现全部宏/工具环境 |
| archive/config.h.in | configure.ac:87及文件首行autoheader来源 | 同上 |

不是“12项许可只剩9项”：3个精确对应也保留实际条款/最终分发审阅；GIR原供应包、加工链和文档引文没有因此关闭。

## 4. 实现与实际验证

新增[配方](../evidence/2026-10-18-local-development-history.md#local-72382d39a7bd05fe)、[窄对应helper](../evidence/2026-10-18-local-development-history.md#local-109ec9ea8e9f4000)、[离线材料探针](../evidence/2026-10-18-local-development-history.md#local-19faf80995c5327c)、[6项回归](../evidence/2026-10-18-local-development-history.md#local-49bb2b7cb98cd8a5)。复用已有verifyGeneratedFile，不增加依赖、通用许可证判定器或默认发行接线。

探针先绑定kit/源清单、原368项盘点及前批最终report/supplement的原文件摘要，再读取指定源与完整原文。输入只读；单文件32MiB、读取预算128MiB。规范绝对路径、无链接/别名；已有/嵌套/祖先output拒绝。所有输入/对应检查完成后才创建新output；复制后重核完整集合、字节及执行位。

首次实跑因原盘点仍保存WebP原发行长度579349、当前已验收overlay长度579355而失败，未创建output。修正为分别记录两种身份，仅接受已审核的`webp/configure`这一个差异；增加拒绝其他路径、未审核overlay、第三种长度与执行位漂移的回归。原失败留证，不改原盘点或kit。

- Node22.19.0与24.19.0最终各 **25/25 PASS，0 FAIL/SKIP/CANCELLED**：新增6项＋原parser resource19项，2文件；未重复全仓测试或借用上批27项计数。
- 两Node实际OS禁网探针退出0、`PASS_FIXED_PER_INPUT_NOTICE_MATERIAL_INVENTORY_ONLY`；同策略loopback连接EPERM。代码/参数相同，只去除采样时间后报告完全相同。
- 两Node实际GPL3文本替换为同长度GPL2版本行负例均拒绝，exit1且未创建output。拒绝点为固定摘要漂移，**不是宣称版本语义解析器被测到**；原许可未改动。
- 368个noticeMaterial、215个文档来源、10个gettext源/模板和1个xmlwf全文链接均指向已复制材料；各材料复制后重新核验。

476文件补充包身份：**`sha256:d403cc43b370d6187b24c5edec8f53897a313a475de368b3777c3011101b4572`**。逐输入清单身份：`sha256:36e6b292561f63e38716d51bc1f381a184878915d10fdc570e1b73524b1f47ed`。这两个身份不是新kitId、stackId、二进制或完整许可证明。

复跑：固定Node运行 `scripts/probes/webui-g2-native-generated-notices.mjs <locale-kit> <G2-00-materials-1001-WEjX3M> <G2-00-generators-1001-hVNBvH/final-node22> <全新output>`。输入/输出使用绝对规范路径；不接受任意源材料或发行用途。

## 5. 证据、保护与下一项

证据根：`artifacts/webui-optimization/G2-00-notices-1001-5JoWe2/`，checkout外、非日常prefix。

- `baseline.json`、`baseline-kit.json`、`closeout.json`：1480个原文件、HEAD/分支/日常指针、4项kit元数据及范围保护。初次基线脚本因未设置变量失败、未写文件，随后改为显式路径；最终kit基线另存，未掩盖首次空metadata字段。
- `red.*`、`node22-initial-*`、`node22-review-*`：缺实现预期失败、原发行/overlay长度失败及中间通过结果，均非最终测试计数。
- `final-node{22,24}/generated-notices.json`、476文件`supplement/`、`node{22,24}-final-{guard,regression,notices}.*`：最终同源实际验证、版本、命令和退出码。
- `notices-parity.json`、`node{22,24}-actual-wrong-license.*`、`wrong-license-generated/`：双Node一致性、实际负例与独立夹具；负例output没有创建，原正文和输入包保留。

**下一Task仍在G2-00-02：** 优先核libexif文档归档里的Doxygen资产/notice及源对应，再追回GIR真实供应包/版本、固定加工链与GNU C Library手册引文；继续必要的生成工具来源和剩余输入闭包。对已保留111个宏/脚本原文不再只做关键词盘点或重复拉包。来源/实际义务闭合后，将Windows、xmlwf/gettext及本批材料按审阅清单形成新kit身份，再G2-00-03；原locale kit不覆写。之后才native新候选/F01与F03–F06，全部门禁PASS才进入U2。

`research`让材料来源限于固定一手代码与已取得原包；`lean-coding`让实现只覆盖本次固定清单、3个窄对应和必要输出保护。探子只读：较宽两任务催收后仍无终态已中断；窄任务提供4处例外定位，另一任务因猜测宏路径错误未完成，主代理定位真实`m4m/stdint.m4`并亲读复核。方案取舍、文件修改和最终验证由主代理完成，没有把未返回/错误当PASS。没有修改全局配置、用户数据、依赖、默认stager、日常安装或服务；没有收费模型、发布、浏览器验收或用户产物清理。
