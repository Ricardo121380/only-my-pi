# G2-00-02：生产依赖图与材料收口复核

日期：2026-10-01。**适配前当批结论：依赖图、材料范围复核和相关回归已完成；当时G2-00-02尚未完成，阻断于4个macOS生产依赖的对应许可材料。** 不是“6个缺口都是未使用包”。两个Windows target包不在本次Darwin库目标规划中，但完整vendor、GIR及源码包的分发材料义务仍保留。当批许可INCOMPLETE、F02/F03 PARTIAL、G2-00整体NOT_RUN、Full NOT_RUN，U2入口仍BLOCKED；产品Task仍20/44，不进入Electron。

**后续更新：用户已批准第5节的locale窄适配，技术验证及新kit已完成，见[窄适配验收](2026-10-01-webui-g2-00-locale-adapter-acceptance.md)。** 原4包退出新候选规划、双Node各38项及实际Rust差异通过；当前整项仍PARTIAL，剩余Windows/GIR/生成材料义务保留。本页以下内容是适配前当批证据，不把原165/182包、30项结果或当时等待选择改写为新候选结果。

依据：[前批源码/工具链/kit实况](2026-09-30-webui-g2-00-native-source-progress.md)、[内部步骤](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)、[发行门禁](2026-09-29-webui-u0-parser-full-integration.md)。本批没有替换依赖、修改原vendor、放宽许可门禁或开始native应用编译。

再后续：[Windows源码/许可文本绑定子项已收口](2026-10-01-webui-g2-00-cross-platform-materials.md)，完整发布文件与固定内容匹配树三方核验，supplement另冻；GIR与生成材料已有逐项来源分组，整项仍PARTIAL。下文保持适配前历史口径，不再把两Windows包“未找到对应”作为当前结论，也不称后批材料已进入发行链。

## 1. 实际执行及边界

源码仍为`codex/webui-phase1`、HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`及已有脏工作树；新基线冻结1456个既有文件。日常指针仍为`stacks/7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`，Asgard本批开始可用约817GiB。所有新执行输出在checkout外的新证据目录，不覆盖09-30材料。

- 新增[目标图探针](../evidence/2026-10-18-local-development-history.md#local-375f008af5ee740f)和[审阅helper](../evidence/2026-10-18-local-development-history.md#local-f58831d63d596c1e)，绑定已冻结kit/profile原文件SHA，而非只看版本标签；重验2356个rsvg文件、353个vendor包的18381个checksum文件，以及实际cargo/rustc字节。
- 两个Node均实际运行探针。每个metadata/unit-graph命令使用独立空`CARGO_HOME`、私有输出/目标目录，`--frozen`及vendored source替换；OS sandbox拒绝网络，拒绝祖先`.cargo`配置。最终lock仍为`sha256:5723e14ce316e9058c76257848e18ab52624c98d16f758b5f8a73b5007b2ab8b`。
- 上游目标为`librsvg-c@2.63.2`库：Meson wrapper使用`cbuild --locked --library-type staticlib`；关闭pixbuf/tests/convert等选项不变。cargo-c版本源码会隐式开启`capi`并选择lib，未指定target时使用Rust host。实际固定rustc host为`aarch64-apple-darwin`。[上游wrapper](https://github.com/GNOME/librsvg/blob/073326620abe168bb8be07d9c52595a5d19d1ecb/meson/cargo_wrapper.py)、[cargo-c版本源码](https://github.com/lu-zero/cargo-c/blob/v0.10.21/src/build.rs#L738)
- 用nightly Cargo的`build --lib --release --target aarch64-apple-darwin --features capi[，avif] --unit-graph -Z unstable-options`规划，不编译crate或执行build.rs；可运行rustc版本/target信息查询。根profile实际为opt=z、LTO=true、codegen_units=1、panic=abort、incremental=false。Cargo官方明确unit-graph不会实际构建，且比workspace metadata更能表达目标、features和host/build区别。[Cargo unit-graph](https://doc.rust-lang.org/cargo/reference/unstable.html#unit-graph)

**这仍是库依赖规划子集，不是cargo-c实际链接或runtime SBOM。** cargo-c工具含其自身Cargo0.95解析器，并修改root的crate type/name；本批nightly Cargo1.101图不能替代其最终构建。最终仍须G2-00-04实际构建/链接核验。AVIF沿用上游auto，分别规划有/无dav1d的两种结果，没有擅自选关闭分支。当前图只使用rsvg源输入，WebP兼容overlay不在本图执行范围；正式native构建仍须绑定原kit和09-30 overlay并重新配置完整私有依赖。

## 2. 生产与非生产输入：实测结果

| 分支 | 编译规划unit | 全部包 | registry包 | target-library规划包 | host/build规划包 |
| --- | --- | --- | --- | --- | --- |
| `capi` | 231 | 165 | 163 | 129 | 68 |
| `capi,avif` | 254 | 182 | 180 | 144 | 73 |

一个包可同时用于host和target，所以后两列不能相加当总数；`TARGET_LIBRARY_PLAN`不表示已证实嵌入最终dylib。未参与当前图的vendor未删除，也未改称“无材料义务”。两个Node的包名/版本/来源/角色/路径、unit数及lock归一化比较一致；workspace绝对pkg ID按各自隔离目录保留。

4个缺材料包在两种分支中全部属于target-library规划，其最短已见路径为：

```text
librsvg-c → librsvg → locale_config 0.3.0
                         ├─ objc-foundation 0.1.1 → block 0.1.6
                         │                      └─ objc_id 0.1.1
                         └─ objc 0.2.7 → malloc_buf 0.0.6
```

两个`winapi-{i686,x86_64}-pc-windows-gnu@0.4.0`均不在这两张图中。它们依然是保留的完整lock/vendor输入；先前winapi-rs0.3.9树与发布import libraries不等价的记录仍有效，不能据图中缺席关闭源码包再分发材料缺口。

## 3. 材料核查结论

| 项目 | 本批证据 | 状态与限制 |
| --- | --- | --- |
| 4个macOS包 | 重新扫描对应固定上游树的13/3/13/5个文件及发布manifest；均只见Steven Sheldon作者与MIT声明，无常规命名全文或完整grant匹配。malloc_buf manifest额外exclude差异保留 | **生产材料BLOCKED**，不是认定无许可/违法，也不由声明合成版权年份或上游原件 |
| block/foundation/id后续许可PR | 官方[block#14](https://github.com/SSheldon/rust-block/pull/14)、[foundation#13](https://github.com/SSheldon/rust-objc-foundation/pull/13)、[id#7](https://github.com/SSheldon/rust-objc-id/pull/7)本次观察均Open、未合并 | 候选/参考，不当作原维护者已采纳、对应旧发布版本的许可证明；不是穷举全部历史的阴性结论 |
| malloc_buf后续全文 | 2020年后续提交有[MIT全文](https://github.com/SSheldon/malloc_buf/blob/d9a3e539642bd90e07df458d226b19cdfa606863/LICENSE)，[PR#3](https://github.com/SSheldon/malloc_buf/pull/3)已合入；旧版本0.0.6的明确绑定未见 | 全文存在不等于旧版本材料已闭合；保留参考身份，不冒充0.0.6原件 |
| 固定gir-files | 53文件/40GIR、82470个doc块；本批文本规则命中92个许可/版权等关键词doc块、73种文本；29个GIR有生成声明，无文件级license元素或SPDX命中 | API枚举/属性说明不是文件许可；GLib.gir有借用GNU C Library manual版权声明。gir仓库MIT不能无依据覆盖另一仓库。文本规则不是完整XML/法律审查 |
| GIR角色 | README说明用于生成gtk-rs crates；`librsvg-rebind/regen.sh`传入gir-files；两张实际库图均不含librsvg-rebind | 生成/外围输入与运行库分列，不运行更新/regen，不据此豁免若分发完整源包时的材料义务 |
| 368生成输入 | 全部重验大小/SHA；首300行逐项留存notice关键词。5个Autoconf生成许可、70个Automake notice保留条款、40个GPL特殊例外、41个GPL文本/引用命中 | 分类可重叠，257项未归入上述模式，不表示其无许可。保留原文和例外；不以顶层库许可一概覆盖，不证明历史生成器来源或最终嵌入 |

材料证据是技术核验，不是法律意见。前批4个Rust包6份上游全文和selectors的MPL steward全文继续保留；完整native/GIR/生成输入义务仍INCOMPLETE。本批Web观察是直接一手页面核对，不宣称已下载页面字节、取得独立签名或恢复全部历史。

## 4. 代码及回归

新增两个测试文件：[图审阅回归](../evidence/2026-10-18-local-development-history.md#local-2f594c0357445de8)、[CLI负例](../evidence/2026-10-18-local-development-history.md#local-1296815cb740d1bc)。覆盖host/target双归属、到缺材料包的路径、未知schema/pkg/index/platform、错误根目标/feature/profile、失配AVIF、连接范围、循环终止，以及输入漂移、既有output/输入别名/越界output拒绝。原configure严格拒绝与parser U0-only发行拒绝测试一起运行。

Node22.19.0、24.19.0最终各**30/30 PASS、0 FAIL/0 SKIP/0 CANCELLED**，4个文件，显式`--test-reporter=tap`；这不是重新运行前批72项或全仓测试。两个Node均实际导出两分支图，不仅回放fixture。初轮CLI fixture把output放在profile输入目录下，被正确拒绝；修正fixture布局后回归通过，未弱化边界。Node24初次默认reporter非TAP，旧计数收据虽子进程退出0仍标失败，原件保留；改为显式TAP后另存新收据，不覆盖原结果。

首版真实探针的AVIF图被不含AVIF的metadata审阅拒绝，收据PARTIAL保留；修正为每分支匹配features的metadata后取得新通过记录。正式最终输出绑定探针/helper源文件摘要，没有将后改代码推称为初次运行版本。

证据根：`artifacts/webui-optimization/G2-00-closure-1001-1gw3iK/`（checkout外；非发行output/日常prefix）。主要文件为：

- `baseline.json`、最终`closeout.json`：既有工作树/日常指针/原kit/profile/lock/overlay保护及范围核验。
- `target-graph-v1/`：初次AVIF metadata失配保留；`target-graph-v2/`：首次修正成功；`target-graph-final/`、`target-graph-node24/`：最终同源探针、commands/stdout/stderr、分支审阅及lock。
- `graph-parity.json`：双Node规划结果归一化一致；`node{22,24}-final-regression.{json,tap,stderr}`：最终30项回归。
- `rust-production-materials.json`：4树字节/声明/对应和当前上游参考；`gir-materials.json`：完整清单/命中文本与范围；`generated-notices.json`：368字节/生成头注/例外。

`lean-coding`限制新增面为现需的目标图探针/测试和文档；`research`只用固定源码及一手资料。探子只读，结果经主代理定点复核；生成文件探子催收后仍在途已中断，不把未交卷当完成，主代理仅核查上述明确的生成输入/头注子集。未修改根package/lock、产品Host/WebUI、全局配置、日常指针或默认发行链；未运行浏览器、收费模型、native应用编译或Full安装。

## 5. 收口前的必要路径决定

**当前停止自动换依赖；不是继续无限获取同一组缺文件。** 在保持全部原依赖的路线下，仍需明确对应上述旧发布版本的原作者材料，或由负责此门禁的人明确新的材料审阅标准。没有依据不把参考文本改写成发行PASS。

建议下一步选择**候选内的locale macOS窄适配技术验证**，而非换Sharp/libvips、关闭SVG/AVIF或调整容量限制：

1. 确认授权后，只针对`locale_config 0.3.0`的macOS系统locale获取和target依赖做新候选overlay；保留CGI→Unix→macOS初始化次序、locale规范化以及其余API。现有`src/macos.rs`获取的是`NSLocale.currentLocale.localeIdentifier`，不是用户语言偏好数组，不误换为“第一偏好语言”。
2. Apple官方说明`CFLocale`与`NSLocale`可桥接，`CFLocaleCopyCurrent`获取当前逻辑locale且有明确所有权规则；可研究使用系统CoreFoundation C接口消除旧ObjC wrapper链。**这是待验证推断，不是已实施/已证明完全等价**；必须做新旧系统locale、环境变量覆盖、字符串/所有权及SVG `systemLanguage`差异验证。[CFLocale](https://developer.apple.com/documentation/corefoundation/cflocale?language=objc)、[CFLocaleCopyCurrent](https://developer.apple.com/documentation/corefoundation/cflocalecopycurrent()?language=objc)
3. 若技术验证成立，单列新增patch、对应源/原许可、最终lock/vendor及新kit身份；旧输入保留，新candidate不继承旧摘要。重新检查实际图和全部新依赖材料，不把移除4包自动等同完整许可PASS。
4. 若不成立，保持阻断并报告具体语义/实现风险，不静默退为固定en-US、只读LANG、去掉SVG条件处理或放宽来源门禁。GIR/完整源包范围与生成义务也仍须收口，再整体验收G2-00-02后才进入G2-00-03。

该方向涉及已冻结候选的依赖变化，超出“把现有材料补齐”的纯取证边界，**本批只给证据与建议，未自动实施，等待用户选择**。另一条路径是严格保留原依赖并等待/取得上游对应材料；对外联系或发布另需具体授权。
