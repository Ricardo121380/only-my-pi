# G2-00-02：Windows 源对应与生成材料分组

日期：2026-10-01。**两个 Windows 0.4.0 包的完整发布文件、上游源树及许可全文绑定子项已验收；GIR 与混合生成材料取得新的逐项来源记录，整体仍 PARTIAL。** G2-00-02 未整体验收，完整许可 INCOMPLETE、F02/F03 PARTIAL、Full NOT_RUN、U2 入口 BLOCKED；产品 Task 仍 20/44，不进入 PDF 下一项、U2 或 Electron。

依据：[locale 窄适配验收及当前候选](2026-10-01-webui-g2-00-locale-adapter-acceptance.md)、[原材料复核](2026-10-01-webui-g2-00-native-closure-review.md)、[内部顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task 看板](2026-09-26-webui-optimization-tasks.md)。本批继续现有材料准备，不改变依赖、分发范围或许可审阅标准。

随后本批[xmlwf/GFDL与gettext原包绑定子项已验收](2026-10-01-webui-g2-00-generated-materials.md)：官方1.1全文、9个原包文件、Makevars3行派生和36文件supplement另冻，双Node各27项及实际禁网通过；原kit不改。下文“尚未绑定全文/辅助来源”是本批历史盘点，当前不再作为未取得结论；条款实际履行、其他生成例外/GIR及整体门禁仍未闭合。

## 1. 当前 Task 与出口

| 子项 | 本批结果 | 仍需工作 |
| --- | --- | --- |
| 两 Windows 包的来源/全文绑定 | **PASS 技术材料子项**；原始 crate、完整 vendor 与对应上游文件三方核验，原全文及完整源码归档单独保存 | 补充材料尚未并入新 kit/F03/F04；不声称 Windows SDK 原生成器、import library 重建或法律审核通过 |
| GIR 输入来源与文档义务 | **PARTIAL**；53 固定文件与当前候选一致，40 GIR 的包族、ABI namespace 与版本常量逐项记录 | 追回真实源版本/SDK 或 CI 身份、手工修改链和文档/第三方引文的许可绑定 |
| 368 混合生成输入 | **PARTIAL**；368 当前字节绑定，215 文档逐项映射到43个原手册与完整头注；生成规则/例外分组 | 其余153项及生成器例外继续逐文件审阅；分组与头注存在不等于义务完整履行 |

这是原 G2-00-02 的内部收口，不增加44项分母。原353包 kit 与 locale 新347包 kit 均不修改或覆写。

## 2. 两 Windows 包：从错误 tag 对应到完整文件对应

原 `winapi-rs 0.3.9` 树仅有相同 target version 声明，但 `build.rs` 和 import libraries 不同，仍保留为不等价的历史记录。本批取得两个 crates.io 公开发行元数据快照及原始 `.crate`，分别核对原包 SHA 与现有 vendor 的 package checksum；解包复用[既有受限解包器](../../packages/release-stack/safe-extract.mjs)，限制1600 entries/64MiB，不运行脚本。

| 发布包 | 官方 created_at（UTC） | 完整发布文件 | 原始 manifest/源码/import library 对应 | import libraries |
| --- | --- | --- | --- | --- |
| winapi-i686-pc-windows-gnu 0.4.0 | 2018-01-18 00:55:38 | 1391 | 1390/1390 一致 | 1387/1387 一致 |
| winapi-x86_64-pc-windows-gnu 0.4.0 | 2018-01-18 00:55:12 | 1420 | 1419/1419 一致 | 1416/1416 一致 |

每包额外1项是 Cargo 发布生成的规范化 `Cargo.toml`：同样与原 `.crate` 和 vendor 逐字节相同，但不伪称 Git 原文件。发布 `Cargo.toml.orig` 对应各平台的 Git `Cargo.toml`，没有再接受版本号例外。

准确内容对应的固定源提交为 **`9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa`**，tree `8146a2db00f01713763b925d8b5a8f13bf917f7a`。完整获取5902个受跟踪文件、112224221字节，Git blob/大小/执行位/SHA核验，归档7383306字节。该提交时间晚于 crate 发布，**证明的是完整内容对应，不是原始发布提交或发布者签名**。[固定源码](https://github.com/retep998/winapi-rs/tree/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa)、[i686 原 manifest](https://github.com/retep998/winapi-rs/blob/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa/i686/Cargo.toml)、[x86_64 原 manifest](https://github.com/retep998/winapi-rs/blob/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa/x86_64/Cargo.toml)

发行元数据与发布源码均声明 `MIT/Apache-2.0`；实际 `build.rs`/`src/lib.rs` 保留开发者版权与双许可指向。保存上述匹配树的完整 [LICENSE-MIT](https://github.com/retep998/winapi-rs/blob/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa/LICENSE-MIT) 和 [LICENSE-APACHE](https://github.com/retep998/winapi-rs/blob/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa/LICENSE-APACHE)，不补造年份，不拿后续更新的版权行替换原件。后来的[维护者打包修复](https://github.com/retep998/winapi-rs/commit/fa4e2c5a6dc495c71e6031bdde2e52870ebf6fdf)说明其主动把全文加入平台目录/include 清单；本批只把它作为遗漏机制的佐证，不用其后改 manifest 冒充原包。

第一次定位的发布前提交 `30ed8e3b86f4a8a55e68865843c19800f57bcd7f` 与全部库/源码一致，但 manifest 仍为0.3.2；其 PARTIAL 对应报告保留，未改写成 PASS。随后查 manifest 历史得到上述完整匹配树。公开 API 的 `0.3.4` tag 查询404也保留，未声称找到了该 tag。

## 3. 实现与验证

- 新增[固定配方](../evidence/2026-10-18-local-development-history.md#local-60bab7a3c128f1f1)、[三方文件集合审阅](../evidence/2026-10-18-local-development-history.md#local-6728fbcc9d5f6290)、[离线探针](../evidence/2026-10-18-local-development-history.md#local-fe336ca481eef687)与[回归](../evidence/2026-10-18-local-development-history.md#local-40b491e7533a1eb6)。配方固定新 locale kit 文件身份、上游 commit/tree、完整清单、源码归档、两份许可和两个原包/metadata/checksum 身份。
- 探针重新检查完整5902个上游文件、两包全部2811个发布文件及 vendor 文件集合；唯一不映射 Git 的规范化 manifest 仍核对原发行字节。额外文件、缺文件、库漂移、原 manifest 漂移、mode/link 异常均拒绝，不向 vendor 添加 LICENSE 或改 checksum。
- 在全新输出复制两份全文、完整上游归档、两个原始 `.crate` 及元数据快照；复制后再次核实际摘要。这个7文件 supplement 有独立身份，并未原地加入 locale kit，因此其原 kitId 不变。
- 路径必须规范、无别名；已有 output、checkout/输入内或祖先 output 拒绝。没有网络/工具调用或 native 编译逻辑；实际运行额外由 OS 禁网。

Node22.19.0 与24.19.0各实跑最终同源探针，均 `PASS_TWO_WINAPI_SOURCE_AND_LICENSE_TEXT_BINDINGS`。两个结果去除时间/隔离绝对输出位置后完全一致，supplement 身份为 **`sha256:9bb49b579a3aa7000ee95ed03febe9446488ddd15454389df48069e974dea45a`**。

两个 Node 的最终相关回归各 **24/24 PASS，0 FAIL/SKIP/CANCELLED**：新增5项与原 parser resource 的19项，共2文件；原 U0-only/default release 拒绝继续成立。先保存新增回归缺实现的预期 red，再实施；早期成功运行与补上复制后摘要检查的最终运行分目录留证，不借用旧38/72项计数。本批不是全仓、cargo-c、浏览器或 Full 验收。

## 4. GIR：版本线索与实际缺口

重新核53文件的固定字节，并与 locale kit 的 source inventory 对应；40 GIR 全部记录 `<package>`、namespace ABI、shared-library 及 header version 常量。方法是属性/常量的有界文本提取，不是完整 XML 或法律审核。

- `GLib-2.0.gir` 的常量指向 GLib **2.87.0**，`Gtk-4.0.gir` 指向 GTK **4.21.4**，`HarfBuzz-0.0.gir` 指向 **12.3.0**。这些是 header 版本线索，不把 namespace 的2.0/4.0/0.0当发行版本；也不能把当前 native 源树的 GLib2.90.0/HarfBuzz14.5.0全文直接当成准确来源对应。
- 固定 [README:11–32](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/README.md#L11) 使用 SDK master，允许手工文件早于上游发布；[dl.py:46–50](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/dl.py#L46) 只从安装目录复制；macOS脚本按最近成功CI取 artifact，不固定commit；这些不证明旧运行容器/上游构建身份。
- [reformat.sh:6–9](https://github.com/gtk-rs/gir-files/blob/6cef10cd64dfe5839e6693676852479fe7c9aac8/reformat.sh#L6) 删除 doc filename/line 与 source-position，`fix.sh` 另改 API。准确绑定需追回原件及这条加工链，不能要求最终 GIR 直接等于上游初始 XML。
- `GLib-2.0.gir:8763` 的错误码文档指向 GNU C Library manual 的独立版权；尚未绑定具体手册版本/条款。生成器 [gir 自身 MIT](https://github.com/gtk-rs/gir/blob/88f37d4165a8ec4a85c219bb3de247f285594b67/LICENSE)不自动覆盖另一个仓库或内嵌文档。亲读其文档生成教程只确认输入/转换用途，未找到本次可用的跨仓许可依据。

两张 Darwin 生产规划不含 librsvg-rebind 的事实保留；未运行更新/regen，不以不参与当前图为由豁免完整材料包的义务。

## 5. 368 生成输入：从关键词盘点到源材料映射

所有368项绑定当前 source inventory；唯一相对原 generated overlay 改字节的项是已验收的 WebP configure，核其新候选身份，不把旧摘要套到新脚本。

| 不重叠分组 | 项数 | 当前依据/限制 |
| --- | --- | --- |
| libarchive 生成文档 | 215 | 五类各43项；逐条 Makefile 规则映射43个原手册，原件与 Git、发行树共同文件摘要一致；保存逐手册完整头注，生成未重跑 |
| 前批头300行规则命中 | 111 | 保留实际 Autoconf/Automake/GPL 例外原文线索；原分类可重叠，不冒充全文/全部宏许可闭合 |
| 文档目录的生成 Makefile | 5 | 定位 `doc/update.sh`；生成器及构建文件许可不由顶层库许可一概覆盖 |
| 测试 list.h | 5 | `Makefile.am` 明确由 DEFINE_TEST 名称排序生成；未重跑或把测试名索引当完整实现 |
| install-sh | 5 | 文件含 X Consortium grant、姓名使用限制及 FSF public-domain 修改声明，保留全部，而非仅写 MIT 标签 |
| 其他明确单项 | 6 | libffi.info grant、空 ChangeLog.git、INSTALL copying notice、mkinstalldirs public-domain、gettext Makefile 自由使用说明、xmlwf GFDL1.1指向；存在说明不是许可链全通过 |
| 尚无本批完整来源/条款绑定 | 21 | 完整文件列表另记；含生成 header、gettext 辅助文件、文档压缩包/产物等，不按文件名断定无许可 |

215项对应链条包括固定提交 `27cbc7827172698143e440801fc0ba39ccb4f1f5` 的 [doc/update.sh](https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/doc/update.sh) 静态生成规则。未运行 groff/awk/ps2pdf，也未渲染/验证44份 PDF，不能声称位级重生成或 PDF 资源能力验收。

关键区别：`archive_entry.3` 头注与 `mtree.5` 的 UC Regents 条款不同；后者含姓名/贡献者不用于背书的条件，不能统一抄一个 BSD2 摘要。Expat `doc/xmlwf.xml:17–18` 及生成 `xmlwf.1:358–359` 明确使用 **GFDL 1.1**，不是库 MIT；全文与具体转载条件尚未绑定。本批不把“未绑定”扩大成已穷举整个 artifacts、确认没有全文。

## 6. 证据、保护及后续 Task

证据根：`artifacts/webui-optimization/G2-00-materials-1001-WEjX3M/`（checkout外、不是发行 output/日常 prefix）。

- `baseline.json`、`closeout.json`：1470个已有文件、源码/日常指针/输入与本批范围。
- `*-version.json`、公开查询 `*-receipt.json`、两个 `.crate`：官方元数据、获取摘要/边界与原包。主线程10次有界公开HTTP GET、2次固定Git获取，无认证/重试；网页工具失败/探子未覆盖不推称已完成核查。
- `winapi-2018/`及其 PARTIAL 对应、`winapi-034/`及完整固定源码/归档、`fixed-winapi-inputs/`：原先定位与最终内容对应分别保存。
- `final-node{22,24}/winapi-materials.json`、7文件 `supplement/`、`node{22,24}-final-{winapi,regression}.*`、`winapi-parity.json`：最终同源实际运行、完整对应、24项回归及双Node一致性。
- `generated-source-obligations-final.json`：368项、215源规则、43完整头注及开放分组；早期文本标签版保留，最终将“组件缺全文”改为准确的“尚未绑定全文”，不冒充全范围阴性检索。
- `gir-origin-review-final.json`：53项与当前候选对应、40属性/常量清单及精确缺口；原盘点保留。

使用固定 Node 的可复跑入口是 `webui-g2-native-winapi.mjs <locale-kit> <fixed-winapi-inputs> <全新output>`，输入路径须绝对规范。该探针只认可本批固定配方，不接受任意 kit/许可 PASS/发行用途；原默认发行门禁不改。

**下一 Task 仍在 G2-00-02：** 先补生成文件的完整例外/原文集合、xmlwf GFDL1.1与gettext辅助来源，再追回 GIR 原供应包/版本与文档义务。Windows 已匹配的来源/文本不重新无界搜索；后续集成补充材料须形成新 kit 身份，不能覆写 locale kit。必要材料全部闭合才 G2-00-03，再实际 native/F01与F03–F06。无收费模型、浏览器、日常服务重启/晋升、全局配置、发布或清理。

`research`限制来源于固定代码、官方仓库/registry；按用户规则探子只读、主线程等待收敛。两探子因自身检索错误返回部分结果；生成材料探子催收后未交卷已中断。主代理亲自复核关键原文并实施、运行最终验证，不将未覆盖项或中断当 PASS。`lean-coding`限制新增代码于两Windows包现需的可复跑材料核验，不额外造通用许可判定器。
