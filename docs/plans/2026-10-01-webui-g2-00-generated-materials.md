# G2-00-02：xmlwf GFDL 1.1 与 gettext 生成材料绑定

日期：2026-10-01。**本批完成指定手册的官方 GFDL 1.1 全文保存、9个 gettext 辅助文件的原包对应，以及 Makevars 的3处精确派生对应；材料技术子项 PASS，G2-00-02 整项仍 PARTIAL。** 完整许可 INCOMPLETE、F02/F03 PARTIAL、Full NOT_RUN、U2入口 BLOCKED、产品20/44保持。未开始 G2-00-03、native应用构建、U2或Electron。

依据：[上一批来源及生成材料分组](2026-10-01-webui-g2-00-cross-platform-materials.md)、[内部执行顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)、[发行/Full清单](2026-09-29-webui-u0-parser-full-integration.md)。本批是现有生成材料收口，不增产品范围或分母，不替换原件、依赖或日常安装。

后续[逐输入notice材料清单子项已验收](2026-10-01-webui-g2-00-notice-inventory.md)：368项当前材料、111完整宏/脚本、12项静态规则及3项内容对应另冻476文件，双Node各25项和实际禁网/许可漂移负例通过。下文“111完整例外/12项尚未新审阅”是本批当时盘点，当前原文保留/规则定位已补；全部宏条款、Doxygen资产、GIR来源/加工/文档与实际分发义务仍未关闭，不能把本补充说明读作整项PASS。

## 1. Task结果与没有关闭的门禁

| 子项 | 本批事实 | 限制/剩余 |
| --- | --- | --- |
| xmlwf指定版本全文 | 官方 GFDL1.1文本18101字节，HTTP200；与当前XML/man声明分开绑定，完整版权头和原件保留 | 不把源码MIT或gettext手册的FDL版本替代它；具体分发形态/改编、notice呈现与透明副本安排尚未发行验收 |
| gettext原始输入 | 官方0.18.3源码包16171945字节，受限解包4873 entries/78683726字节；9文件逐字节对应 | 这是固定原包内容对应，不是当年运行gettextize或独立发布签名证明 |
| Makevars派生 | 原模板仅替换DOMAIN、COPYRIGHT_HOLDER、MSGID_BUGS_ADDRESS三个整行；精确得到当前2375字节文件 | 模板和项目配置的许可/版权范围另记，不把POT版权变量当作这个配置文件自己的授权 |
| 独立材料补充包 | 36文件；两固定Node实际禁网运行、复制后重新核摘要，补充包身份相同 | 另存 supplement，尚未合入新kit/F03/F04；原locale kit身份不变 |
| 整体生成材料与GIR | 本批有新来源证据，仍PARTIAL | 111项头注分组的完整宏/生成器例外、其余生成输入和GIR源/加工/文档义务仍需收口，不以关键词命中代替义务履行 |

此前21项 `OPEN_SOURCE_AND_OBLIGATION_BINDING` 中，9项现在补上gettext来源或模板派生对应，另外12项尚无本批新来源审阅；原Makefile已有单项notice，又补原包对应。这里不是“21项许可只剩12项”：这些新对应项的实际义务仍须落实，历史分类记录不改写为全部PASS。

## 2. xmlwf：保留精确版本与原作者声明

固定源提交为 `4b3f0b06f39fb5529cead381694f8929901bc273`。本批重比当前候选 `expat/expat/doc/xmlwf.xml` 与原固定Git导出：21330字节，Git blob `e7a2664b7e4244c917aad2abe01e739120ed5a04`、SHA一致；生成 `xmlwf.1` 11516字节另核当前源清单，未重跑DocBook工具。

- [原XML:9–18](https://github.com/libexpat/libexpat/blob/4b3f0b06f39fb5529cead381694f8929901bc273/expat/doc/xmlwf.xml#L9)保留8位作者及其实际年份，明确与Expat多数文件不同、使用GFDL1.1；[AUTHOR段:585–589](https://github.com/libexpat/libexpat/blob/4b3f0b06f39fb5529cead381694f8929901bc273/expat/doc/xmlwf.xml#L585)指定1.1，没有“or later”。不补造年份，不覆盖原man/XML。
- 完整获取[GNU官方1.1英文全文](https://www.gnu.org/licenses/old-licenses/fdl-1.1.txt)，标题为March2000，SHA-256 `1040f0fffcf5a73398512aaa3f7cf89b7e4bb8feb13c661ad71184e015c7fcb6`。版本固定不能由1.2/1.3替代；原文不做清理或拼接。
- 亲读全文：§2要求保留许可全文、版权及适用notice；§3对数量及Opaque/Transparent副本有条件；§4处理修改；§6/§7区分文档集合/独立作品合集；§10的后续版本选项以文档声明为前提。这些条款已定位，不等于本项目实际分发已经满足。
- 本次两份手册全文检索未找到明确的Invariant Sections及封面文字列表或“无”的句子；记录为“本次声明未明确列出”，不假造作者声明，也不把它扩大成整个Expat穷举结论。GFDL1.1 §1定义与Addendum的notice要求已保留，最终分发形式和呈现检查仍开放。

源XML、已发行man、完整license分别保存，保留可核对的输入；材料到手不冒充man重生成、透明副本/排版或法律合规验收。

## 3. gettext：从Origin线索到逐文件原包对应

原件来自[GNU官方gettext0.18.3源码包](https://ftp.gnu.org/gnu/gettext/gettext-0.18.3.tar.gz)，SHA-256 `36f3c1043df803565d4977c1efbd41e1ec0f0301acf5f057984406c34cb9f948`。摘要是本次HTTPS获取的固定字节身份，不是独立签名验证；获取不用认证、重试或自动重定向，不执行包内代码。

以下实际候选文件均与该包 `gettext-tools/` 下同名路径一致：`ABOUT-NLS`、`po/Makefile.in.in`、`po/Rules-quot`、`po/boldquot.sed`、`po/quot.sed`、`po/en@quot.header`、`po/en@boldquot.header`、`po/insert-header.sin`、`po/remove-potcdate.sin`。初步核对也记录runtime副本一致，但最终固定配方仅采用tools路径，不把目录许可混写。

| 材料/范围 | 原包中的一手依据 | 本项目处理 |
| --- | --- | --- |
| Makefile.in.in | 文件1–12行：Ulrich Drepper版权、该文件自由复制/使用声明、Origin0.18.3 | 保留完整头注；例外只归于这个文件 |
| tools子包 | `gettext-tools/COPYING:1`指向顶层GPL；顶层COPYING为Version3全文 | 两文件均保存，记录子包声明；不拿它覆盖另有特定notice的文件或手册，也不外推本项目库/最终应用变成GPL |
| 6个引号辅助文件 | `gettext-tools/doc/gettext.texi:7784–7789`逐名允许从po复制并说明gettextize安装 | 保存明确的复制说明和完整相关文件；不是Makefile那段无条件授权的自动扩展 |
| Makevars模板/配置 | `gettext.texi:7795–7805`说明项目变量；`misc/gettextize.in:697–715`要求按模板建立/更新 | 精确证明3行差异；未执行脚本，不声称恢复历史执行环境 |
| ABOUT-NLS/remove-potcdate及其他 | 原包字节、tools子包COPYING和实际复制规则625–626、673–734均保留 | 来源不再未知；逐文件notice/最终转载及派生产物范围仍需落实，不仅抄一个LGPL标签 |
| gettext手册自身 | `gettext.texi:12261–12292`要求文件/目录实际条款优先；手册FDL1.2-or-later/GPL2-or-later双许可 | 保存完整Texinfo、它引入的GPL/FDL/LGPL文本及版权，不与xmlwf的1.1或tools顶层GPL3混为一个notice |

上述行号全部指向此次固定官方源码包；它是可复跑输入，不以当前在线manual的新版本冒充0.18.3。libexif固定源 `.reuse/dep5` 同时绑定，其已列范围保留；不能用其POTFILES.in行授权未列的生成辅助文件。[固定libexif原元数据](https://github.com/libexif/libexif/blob/b2edc5a8adf4d1b79ce9413a9c9d8f3ab871c082/.reuse/dep5)

## 4. 实现、验证与复跑

新增[固定配方](../evidence/2026-10-18-local-development-history.md#local-be4fbd06374c1ea0)、[精确对应helper](../evidence/2026-10-18-local-development-history.md#local-2b38d999b6a36a28)、[离线探针](../evidence/2026-10-18-local-development-history.md#local-25ad188a665f69c9)、[8项回归](../evidence/2026-10-18-local-development-history.md#local-fd1b7cf87451df2e)。用途仅 `FIXED_TEXT_AND_GENERATED_INPUT_CORRESPONDENCE_ONLY`，不接默认stager或改原kit。

探针核配方/kit/源清单摘要，重哈希本批13个候选文件、19个原包文件、4份获取原件/收据；源清单29336是摘要绑定的条目数，**本批探针没有重读全部29336个源文件**。复用既有严格tar解包器，5500 entries/96MiB上限，拒绝越界/未知header/冲突，不在当前源目录解包。已有output、输入/checkout内部或祖先output、别名/链接文件、版本/摘要/mode漂移均拒绝。

两Node各 **27/27 PASS、0 FAIL/SKIP/CANCELLED**（本批8＋原parser resource19，共2文件）。先留缺helper的预期red，再实现；最终同源结果留存。Node22.19.0与24.19.0实际OS禁网probe各退出0；同一策略下loopback连接均EPERM，另一个实际将1.1改成1.3的输入在建output前以摘要漂移拒绝。测试不是完整native/浏览器/安装验收。

两结果只剔除采样时间并规范化隔离解包绝对位置后完全相同。36文件补充包摘要：**`sha256:75c4b06282ec89c040c66ba7b8b7173a260ac953037ce8c33b3cfed8b5c67a7c`**。每项复制后再核字节/执行位及完整文件集合，不仅核源文件；独立新身份不覆盖原locale kit或Windows supplement。

复跑命令：使用固定Node运行 `scripts/probes/webui-g2-native-generated-materials.mjs <locale-kit> <fixed-generated-inputs> <全新output>`；均为绝对规范路径，output不能在kit、获取根或checkout内。命令只接受本次固定输入/配方，不提供通用许可判定或任意发行准入。

## 5. 证据、保护与下一Task

证据根：`artifacts/webui-optimization/G2-00-generators-1001-hVNBvH/`，checkout外、非日常prefix。

- `baseline.json`、`closeout.json`：1475原文件、分支/HEAD、日常指针、原输入保护及本批改动范围。
- `fdl-1.1.txt`、`gettext-0.18.3.tar.gz`与各自receipt：2次实际有界公开GET，各1次、HTTP200、无认证/重试/重定向。网页工具超时另记，不冒充已取网页正文。
- `gettext-extraction.json`、`gettext-initial-correspondence.json`：受限解包结果、初始双目录比较及模板差异；不会改写成历史生成执行证明。
- `xmlwf-source-correspondence.json`：固定Git源/当前候选摘要、blob、copyright及适用声明定位。
- `fixed-generated-inputs/`、`frozen-acquired-inputs.json`：原件/收据复制后重核；`final-node{22,24}/`含独立解包及36文件supplement。
- `node{22,24}-final-{guard,regression,probe}.{json,stdout,stderr}`、`generated-parity.json`、`actual-negative.*`：实际命令、源码摘要、Node版本、退出码、禁网/正负例/同源一致性。`red.*`保留前置失败，不混计最终测试数。

**下一Task仍为G2-00-02：** 将已取得的GFDL/父目录GPL/单文件例外落实到逐输入notice和待合入清单；继续111项真实生成器/宏的完整许可例外与剩余12项来源，以及GIR原供应包、修改链和文档引文。必需材料闭合后才G2-00-03 PDF输入，再native新候选/F01与F03–F06；不无限重查已绑定的Windows或上述9项原包。

`research`让本批以官方原包、精确原文和固定代码为依据；用户规则优先，探子仅只读，派后等待，写文件和最终核验由主代理完成。xmlwf探子返回本地/网页超时的partial结果；gettext探子一次催收后仍未交终态，已中断，相关材料由主代理核对，不当PASS。`lean-coding`限制实现于当前固定材料绑定并复用既有解包器，没有新增依赖、通用法律判定器或无关全仓/前端改造。完整GPL条款履行和最终分发是否合规未在本批作法律结论；没有发布、日常晋升、全局配置、收费模型、浏览器测试或清理用户产物。
