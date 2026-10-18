# G2-00-02：locale macOS 窄适配验收

日期：2026-10-01。**用户已批准的 CoreFoundation 窄适配已实现，差异验证及新候选输入冻结的技术子集 PASS。原来4个缺许可材料的macOS包已退出新候选的两张生产规划图；不是靠删除原材料、关闭SVG/AVIF或降低门禁。G2-00-02整项仍 PARTIAL，完整许可 INCOMPLETE、F02/F03 PARTIAL、Full NOT_RUN、U2入口 BLOCKED。** 产品Task仍20/44，不进入PDF下一项、U2或Electron。

依据：[原目标图及路线建议](2026-10-01-webui-g2-00-native-closure-review.md)、[源码/工具链基线](2026-09-30-webui-g2-00-native-source-progress.md)、[内部顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)。用户随后明确“按推荐的 locale 窄适配路线推进”，解决的是该依赖适配的授权/方向，不是许可豁免或发行放行。

## 1. 实现与范围

- 新增[固定配方](../evidence/2026-10-18-local-development-history.md#local-524475a1f7e49ca8)、[适配源码](../evidence/2026-10-18-local-development-history.md#local-8ef90e052f9668f4)、[离线候选探针](../evidence/2026-10-18-local-development-history.md#local-8429dd3db210ba55)、[严格编辑/图差异helper](../evidence/2026-10-18-local-development-history.md#local-55d021c0d3cb5395)和[回归](../evidence/2026-10-18-local-development-history.md#local-0cf0b35192eac3ca)。原固定kit目标图探针、原vendor checksum、全局配置、产品Host/WebUI和默认发行门禁不改。
- 在新kit的`overrides/locale_config/`中保留原0.3.0版本/API/其余平台实现及MIT全文。仅替换`src/macos.rs`、移除`src/lib.rs`的ObjC宏导入、从两个manifest移除macOS ObjC依赖。workspace用明确的`[patch.crates-io]`路径override；不伪造新的registry包、checksum或上游Git版本。
- 获取`CFLocaleCopyCurrent()`的拥有引用，用`CFLocaleGetIdentifier()`的借用字符串，在父locale仍存活时复制完整UTF-8字节，再由Drop释放父对象。不使用preferredLanguages、固定en-US、只读LANG或`strlen`；CFStringGetBytes保留内嵌NUL并拒绝不完整/有损转换。[Apple CFLocale说明](https://developer.apple.com/documentation/corefoundation/cflocale?language=objc)、[Apple桥接与所有权规则](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFDesignConcepts/Articles/tollFreeBridgedTypes.html)
- **有效输入语义与故障行为分开：** 保留原`LanguageRange::from_unix`及CGI→Unix→macOS优先级；系统返回空指针、非法编码或原normalizer不接受的标识时，改为返回None并沿原初始化fallback处理，取代原unwrap panic。没有宣称非法OS数据也与原版完全相同；没有新增locale格式支持或改变SVG默认语言来源。
- 实际固定rsvg代码的默认语言来源是`glib::language_names()`，然后用locale_config解析语言范围，而非`Locale::user_default()`直接读取macOS。两部分分别验证；不把本次provider验证当作GLib或完整渲染验收。[固定rsvg语言入口](https://github.com/GNOME/librsvg/blob/073326620abe168bb8be07d9c52595a5d19d1ecb/rsvg/src/accept_language.rs#L298)、[systemLanguage代码](https://github.com/GNOME/librsvg/blob/073326620abe168bb8be07d9c52595a5d19d1ecb/rsvg/src/cond.rs#L103)

## 2. 源对应与输入保护

代码仍是`codex/webui-phase1`、HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`及既有脏工作树。本批基线1461个既有文件，日常指针仍`stacks/7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`；开始时Asgard约817GiB可用，未清理旧材料或切换安装。

原crate自带VCS pin实际获取为[固定locale_config提交](https://github.com/rust-locale/locale_config/tree/a939b563dccc22b0b7e1271ab9b8e673132f6d3a)：15个受跟踪文件、Git blob/大小/类型/执行位与SHA核验，完整固定源码归档另存。发布包的10个源码/文档文件逐字节一致，其中`Cargo.toml.orig`对应上游`Cargo.toml`；另外2项是Cargo发布生成的manifest/VCS metadata，不声称它们与上游文件逐字节一致。MIT全文与原文件一致，未根据作者名捏造年份。[原MIT全文](https://github.com/rust-locale/locale_config/blob/a939b563dccc22b0b7e1271ab9b8e673132f6d3a/LICENSE)

新path crate不携带旧registry checksum或声称当前修改属于原commit的VCS文件；这些原件留在隔离`original-locale/`及原vendor中。新kit另携带完整上游15文件作为材料，原许可与修改前/后摘要、适配模板摘要、源码清单和新增路径override共同绑定。

两个Node各实际重验旧kit的29,336源文件、353个vendor包的18,381个checksum文件，再在新副本工作；结束前再次检查旧树/vendor未变。核实际cargo/rustc/clang/ld字节，绑定原SDK inventory并重验本接缝的223个CoreFoundation/Foundation物理头文件与link stub。**不是重新核验全部41,613个SDK文件，也不是分发SDK或位级可复现证明。** 所有Cargo/clang/测试子进程使用私有输出/空Cargo home、OS禁网、最低macOS11.0；未使用用户Cargo配置或RUSTC_BOOTSTRAP。

## 3. 实际验证

Node22.19.0与24.19.0各独立执行同一最终探针；每个探针39条有界命令，commands/stdout/stderr和源码摘要均留证。Rust固定nightly-2026-09-29，不更换工具链。

| 检查 | 每个Node的实际结果 | 口径 |
| --- | --- | --- |
| 原locale crate测试 | 16/16 PASS | 实际编译原Rust实现，不仅用替代oracle |
| 新locale crate测试 | 21/21 PASS | 原16项＋5项：空指针、完整UTF8/内嵌NUL/补充平面字符、非法UTF16、容量负值/编码溢出、正常及normalizer失败路径的拥有引用释放 |
| 初始化差异 | 9/9 PASS | CGI优先、坏CGI回退、LC_ALL优先、LANG、messages覆盖/语言fallback去重、坏变量回系统、C触发原fallback、空CGI；每组新旧stdout一致，10种normalizer向量也比较 |
| 当前NSLocale/CFLocale | PASS | Foundation oracle两者原标识均`zh_CN`，实际新旧Rust provider均`zh-CN`；每次都与oracle标识经原Rust normalizer后的结果比较 |
| SVG语言模块 | 原版12/12、新版12/12 PASS | 完整未改`accept_language.rs`/`cond.rs`：原10项＋2项locale/消息覆盖与不匹配向量；logging/error周边最小shim，GLib环境入口若被调用即panic，不能以mock冒充PASS |
| 新standalone链接 | PASS | `otool -L`只有CoreFoundation和libSystem，没有Foundation；`nm -u`无检查的ObjC调用/retain/release符号；实际Mach-O minos11.0 |
| Node相关回归 | 38/38 PASS，0 FAIL/SKIP/CANCELLED | 5文件：新窄适配、原目标图/CLI负例、严格configure诊断和U0-only发行拒绝；不是全仓或前批72项 |
| 双Node一致性 | PASS | 新kit、lock、overlay、图/包/角色/路径、unit features/profile/依赖边、系统/环境结果与输入清单一致 |

SVG测试不是Cairo渲染或真实GLib环境路径验收；standalone locale编译不是librsvg/cargo-c/libvips应用构建。macOS11.0只是本机编译/链接的deployment target，没有在macOS11机器上运行。未写用户全局语言偏好，仅测当前系统locale和私有子进程环境；未穷举所有区域/日历设置。原crate的edition2015/deprecated/lifetime警告保留，没有借机升级或重构。

## 4. 新旧实际依赖图

| 选择 | unit旧→新 | 全包旧→新 | registry旧→新 | target规划包旧→新 | host/build旧→新 |
| --- | --- | --- | --- | --- | --- |
| capi | 231→226 | 165→160 | 163→157 | 129→124 | 68→68 |
| capi,avif | 254→249 | 182→177 | 180→174 | 144→139 | 73→73 |

两图均仅移除`block@0.1.6`、`malloc_buf@0.0.6`、`objc-foundation@0.1.1`、`objc@0.2.7`、`objc_id@0.1.1`。前批缺材料的是其中4个，不是把objc也误称缺全文。locale_config仍为0.3.0，来源变为明确local path；没有新增Rust第三方包，新增链接来自系统CoreFoundation。存续units的features、profile、target及去除该链之后的依赖边全量比较一致；不只看包数。host/target角色可重叠，表中后两列不相加当总数。

原完整353包vendor保留。新lock实际只需要347个registry包，因此新kit另复制这347包的**全部原文件与原checksum**，18,319个checksum文件均通过；两Windows包仍在，不剪dev/跨平台包来豁免材料义务。原0.3.0变为额外11文件path override，不混进registry checksum数量。

首次cargo重新vendor裁掉666个metadata/原manifest/文档等文件，完整性检查拒绝该候选，原失败保留。后续将Cargo生成的裁剪目录单独留证，逐项要求其package checksum和存续文件摘要与原输入一致，**最终kit按新lock包集合复制完整原包**，补回所有被工具省略的文件；没有接受材料损失或改写registry checksum。

## 5. 冻结身份与证据

| 对象 | 最终身份 |
| --- | --- |
| 新kit | `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622` |
| locale overlay | `sha256:e3b77d93f431675290d07e63cf69ead2bd5d665011fdb94aa2955403261b9cbb` |
| 新Cargo.lock | `sha256:e833a1a0a962991f04f99d072ecc6b0c8d5d236b35f1fbd27144f57f8902373a` |
| adapter源码 | `sha256:c3f533022f0f12ebdb5127540c6626a94c9e238faaaf3ccbed4f7f86cd724931` |
| 固定上游文件inventory | `sha256:7efdfd4ffd308fe51574362d42721989dff36e54b3626375d1457a58a89111c4` |

kit相对旧源清单仅4文件变化：rsvg的manifest/lock及已审阅WebP configure/configure.ac；另外新增独立locale override和源材料。它同时绑定原base kit、原工具链profile、已审阅的WebP/Expat配置overlay和本次locale overlay。不是旧预编译dylib来源、stackId或许可PASS；正式构建须用该新输入及完整私有依赖重新配置，不复用空prefix探针生成物。

证据根：`artifacts/webui-optimization/G2-00-locale-1001-EpCrn4/`（checkout外、非发行output或日常prefix）：

- `baseline.json`、`closeout.json`：1461文件基线、最终范围/源码/日常指针及旧输入保护。
- `locale-upstream/{source.json,files.json,source/,*.tar.gz}`：固定原源码、Git核验、归档和原MIT。
- `candidate-v1/`：裁剪vendor拒绝；`candidate-v2/`/`candidate-v3/`：先前技术迭代，不推称为最终版本。
- `sdk-preflight-rejection.json`：此前SDK matcher只认Versions/A，对实际Foundation Versions/C在输出/构建前拒绝；仅观察收据，不冒充当时未保存的完整stderr字节。修正并增加回归，不跳过SDK输入检查。
- `verified-node{22,24}/locale-candidate.json`：最终探针源摘要、39 commands、全部新旧Rust/locale/SVG/图/link收据和原始stdout/stderr。
- `verified-node{22,24}/native-build-kit/`：source/override/vendor/补充许可/上游材料inventory、locale-overlay.json、kit.json及完整输入副本。
- `node{22,24}-locale-run.*`、`node{22,24}-verified-regression.*`、`locale-parity.json`：实际入口退出码、38项TAP/绑定文件摘要与双Node归一化一致性。初轮37项另存，不称本轮38项。

可复跑入口：使用固定Node运行`webui-g2-native-locale.mjs`，6个规范绝对路径参数依次为**旧base kit、固定profile.json、原configure overlay.json、旧通过目标图目录、固定locale上游证据根、全新output**。拒绝别名、既有output、checkout/输入内output、祖先Cargo配置、输入/源码/vendor/工具/SDK漂移。无网络获取；上游只获取过1次固定commit，复跑复用其核验后的源码。原固定kit探针不改成可接收任意新kit。

## 6. 当前门禁与下一项

随后本批[两Windows包完整源/许可全文绑定子项已验收](2026-10-01-webui-g2-00-cross-platform-materials.md)，双Node最终各24项、实际离线三方对应通过；材料另存在supplement，原locale kit身份不改。以下1–3项保留为locale收口当时的下一项；当前Windows绑定已完成，仍须集成补充材料及完成GIR/生成义务，不把本页38项与后批24项混算。

**locale技术路线已收口，不再等待此路线确认。** G2-00-02仍继续以下材料收口，而不是跳G2-00-03：

1. 两Windows registry包的旧固定来源/全文绑定与完整source/vendor包义务仍保留。当前Darwin规划缺席不等于可分发整个源包时无义务。
2. GIR生成输入的来源/内嵌文档notices，以及368混合发行生成文件的实际义务/必要范围仍未完成审阅；不以gir仓库MIT覆盖gir-files，也不以顶层库许可覆盖生成器例外。
3. 后续G2-00-04还须实际cargo-c构建/链接确认新候选、SVG图片/资源/RSS/预算回归及新F01；当前nightly Cargo图不是cargo-c0.95解析器/最终二进制SBOM。F03–F06接线、账本、完整notices与Full安装另验。

这些事项继续按已批准计划执行；未取得具体证据不标完整许可PASS，不联系上游、发布或改变材料审核标准。本批无收费模型、浏览器、全局安装、日常服务重启或清理。`lean-coding`限制改动于窄适配/必要输入核验；`research`采用固定上游与Apple一手资料。两只读探子催收后仍在途已中断，无终态结果，不将其结果列作验收依据；实现、源码核验与最终验证由主代理完成。
