# G2-00-02：native 源码、补丁与固定构建输入进展

日期：2026-09-30。**源码/补丁/工具链快照、Rust lock/vendor 和隔离输入组装的技术子集已通过；G2-00-02 仍 PARTIAL，尚未整体验收。** 已有产品 Task 仍 20/44（S0 8/8、U0 6/6、U1 6/6）；F02/F03 保持 PARTIAL、G2-00 整体 NOT_RUN、Full NOT_RUN、U2 入口 BLOCKED，不进入 Electron。

10-01先前：[生产依赖图与材料收口复核](2026-10-01-webui-g2-00-native-closure-review.md)确认原4个macOS缺材料包在生产库规划路径。**随后用户批准窄适配，[locale技术验收/新kit冻结](2026-10-01-webui-g2-00-locale-adapter-acceptance.md)已完成**：双Node各38项回归、真实新旧Rust/环境/SVG语言模块通过，图改为160/177包，新lock/347完整vendor另冻，原输入保留。Windows/GIR/生成材料仍未收口，整项PARTIAL、Full NOT_RUN；不再等待该路线选择。下文保留09-30当批结果，不将历史72项改称10-01回归。

依据：[上批固定输入与内部顺序](2026-09-30-webui-g2-00-rebuild-inputs-progress.md)、[发行/Full 清单](2026-09-29-webui-u0-parser-full-integration.md)、[产品 Task 看板](2026-09-26-webui-optimization-tasks.md)。采用已选的固定输入新候选路线，不将新 lock、新工具链或新源码包冒充旧预编译 dylib 的历史构建证明。

10-01随后：[两Windows包完整来源/全文绑定子项已验收](2026-10-01-webui-g2-00-cross-platform-materials.md)，原始crate与完整vendor/固定源码逐项一致、两份原全文/完整归档另冻，双Node本批各24项通过。Windows旧0.3.9树不等价的记录仍保留；GIR/生成义务仍PARTIAL、Full NOT_RUN，下列09-30的6包缺口不改写成当前未处理集合。

## 1. 当前 Task

| 子项 | 实际状态 | 交付与剩余 |
| --- | --- | --- |
| 28 个固定 native 源树 | PASS 技术子集 | 深度 1 获取完整受跟踪树，而非全部 Git 历史；28,716 文件、623,208,295 字节，逐项核 Git blob、SHA-256、类型、执行位及安全链接；28 份固定源码归档 |
| 4 个固定 gitlink 子模块 | PASS 技术子集 | GVDB、dlg、gir、gir-files 共 252 文件；父 `.gitmodules` 摘要、子路径及固定 commit 全部绑定，未自动跟随未知子模块 |
| vendored libnsgif | PASS 字节定位子集 | 固定 libvips commit `24ad4d042940e6bf99a68871ba886ca8847c9c82` 下 `libvips/foreign/libnsgif/` 的 13 文件，含 COPYING；独立版本仍 UNVERIFIED，未运行浮动 update.sh |
| 6 补丁＋Darwin 内联修改 | PASS 实际应用子集 | 1 原补丁直接无偏移；4 仅重定位 hunk 坐标；libvips 补丁只补原文缺失的末尾 LF。正文不改，派生补丁再次严格检查/应用，无 offset/fuzz。12 个平台步骤、13 个文件修改均实际应用 |
| 固定工具链与 SDK | PASS 准备/快照子集 | 私有 nightly、Meson/Ninja、cargo-c、pkgconf 已准备；18 工具输入与版本、SDK 41,613 条/933,736,266 字节、Clang resource 363 条已快照；不是可分发 SDK 镜像或位级可复现证明 |
| 新 lock/vendor | PASS 技术子集 | 补丁之后实际 `cargo update --workspace`、`vendor --locked --versioned-dirs`；空 Cargo home 下 `metadata --frozen` 成功，lock 未变；353 vendor 包/18,381 文件/301,373,957 字节全部 checksum 通过 |
| 新隔离构建输入 kit | PASS 组装子集 | 29,336 源码/生成文件、353 vendor 包及补充许可材料；逐文件复制后重验。368 个发行包生成输入只新增、不覆盖固定 Git 文件；生成器/运行兼容性未由组装证明 |
| 5 组生成输入的 configure | PASS 严格冒烟子集 | 禁网副本实际配置/生成目标头文件；最初 WebP 脚本错误与 Expat 无效选项虽返回0，严格审阅仍拒绝；明确派生 overlay 修复后5/5通过，不是完整链接/嵌入证明 |
| 源对应/许可收口 | **PARTIAL** | 6 个 Rust 包仍有全文或固定来源缺口；GIR/混合生成材料及实际目标嵌入义务待审阅；完整 native 链接与构建未执行 |
| native 应用构建、PDF、默认接线/Full | NOT_RUN | 后续 G2-00-03 至 06，不用本批材料准备、冷 metadata 或 pkgconf 工具编译替代应用构建/安装 |

## 2. 实际源码与生成文件取舍

上批 inventory 身份仍为 `sha256:ee03d2514e727b07923e3cc5b1f1feb9ea899e4854e2569d2084248c3ed4a2fa`。新增 source policy 只准 `NATIVE_SOURCE_PREPARATION_ONLY`，许可 INCOMPLETE、Full NOT_RUN；没有放宽原 U0-only/default stager 门禁。

首次 bare `checkout-index` 缺少 work-tree 设置而失败；修正后 24/28 通过，其余 4 库被上游 CRLF 属性改变了 7 个文件的字节/大小。最终以优先级最高的 Git `info/attributes` 禁用 text/eol/ident/filter/working-tree-encoding 转换，保留受跟踪 `.gitattributes` 本身，28/28 原始 blob 验证通过。全部失败目录和 stderr 保留，没有覆写成 PASS。[Git attributes 官方规则](https://git-scm.com/docs/gitattributes)

5 份官方版本发行包另外保存并核摘要，严格解压后与固定 Git 树逐文件比较；HTTP 取得/本地摘要不是独立签名或历史 builder 验证：

| 组件 | 相同共同文件 | Git 中存在、发行包缺少 | 字节不同 | 发行包额外文件 | 本批处理 |
| --- | --- | --- | --- | --- | --- |
| libffi | 450 | 34 | 7 | 24 | README 标题、GNU config helpers 有差异，4 个 MSVC 文件仅 CRLF 差异；保留全部 Git 原件，只增加固定生成输入 |
| libexif | 142 | 45 | 29 | 83 | 29 个 PO 有实际键增删，不能归为仅格式；不覆盖 PO，排除 31 个 GMO/POT/stamp-po，完整发行包保留 |
| libwebp | 337 | 5 | 1 | 29 | gradlew.bat 仅 CRLF 差异，Git 字节保留；生成输入单独绑定 |
| expat | 147 | 24 | 0 | 26 | 对比范围是 Git 的 `expat/` 子树；kit 工作目录明确为 `sources/expat/expat`，不是误将仓库根当发行根 |
| libarchive | 1,446 | 30 | 0 | 237 | 原始 Git 树及固定发行生成输入都保留；缺失项/新增项不据此推定 whole-archive 等价 |

PO 只读核验解码续行/转义，按 context/msgid/plural 键比较：29 对均非等价，活跃键删除 125、新增 2,720，共同 35,705 键的 msgstr 修改为 0。主代理点验 en_AU 的 `1/%i` 与发行包 `1/%.0f`；具体历史成因及运行效果未验证。原构建选项关闭 NLS，因此 kit 延续 `--disable-nls`；不借此声称整个发行包等价。配置阶段须重新生成目标相关头文件，不以发行机器生成的头文件作为 Darwin 配置证明。[固定上游构建选项](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh)

GLib 两个内容相同的 pcre2 hunk 明确绑定 `glib/meson.build` 新位置 438/465，不按第一处匹配猜选。UltraHDR 两份 commit 补丁按已冻结顺序实际应用；不声称与旧浮动 PR383 字节等价。Linux-only 操作在 Darwin 标 NOT_APPLICABLE。旧 patch 失败及派生修改均单列，不将 6 份原始输入误写为原封不动全部通过。

## 3. 工具链与 Rust 闭包

- 实际选定平台 `darwin-arm64v8` / `aarch64-apple-darwin`；最低 macOS 11.0 与原 `-fno-stack-check -Werror=unguarded-availability-new -Os -fPIC` 不变。[固定平台配方](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/platforms/darwin-arm64v8/Toolchain.cmake)
- Rust 固定 `nightly-2026-09-29`，官方 manifest 与官方 SHA 文件一致。实际 rustc `1.101.0-nightly`、commit `c1070d69382b8d2f2eb65119c738a77d9e324c9e`；cargo `1.101.0-nightly`、commit `3d7cf6e937d6127d0f49881bf689c560b36d35c4`。私有 RUSTUP_HOME/CARGO_HOME，不改用户 stable；原两项 `-Z` 参数通过接受检查，不用 stable 丢弃参数或 RUSTC_BOOTSTRAP 代替。[官方日期固定机制](https://rust-lang.github.io/rustup/concepts/toolchains.html)
- Meson 1.8.3、Ninja wheel 1.13.0 以官方 PyPI 元数据/包摘要冻结，在私有 venv 断网安装；Ninja 实际版本为 `1.13.0.git.kitware.jobserver-pipe-1`。cargo-c `0.10.21+cargo-0.95.0` 的公开 ARM64 工具包与 GitHub asset digest 一致，4 个工具分别核摘要；这不是其独立构建签名验证。[cargo-c 官方发行](https://github.com/lu-zero/cargo-c/releases/tag/v0.10.21)
- pkgconf 2.5.1 固定 commit `4fc570f91d9d8d843ab32d2198a5c064538d8ffd`，以私有 Meson/Ninja 构建/安装，23 个编译步骤通过；`pkg-config → pkgconf` 仅建在该私有 prefix。工具测试未运行；其编译不是 libvips 应用构建。[pkgconf 官方构建说明](https://github.com/pkgconf/pkgconf)
- 本机 Apple Clang 21.0.0、CMake 4.4.2、SDK 27.0 及固定物理路径/文件摘要已记；SDK 与 Clang resource 的文件字节和链接清单已冻结，但未复制/再分发 SDK。继续构建前须验证这些内容没有漂移，版本字符串本身不够。
- 新 Cargo.lock 摘要 `sha256:5723e14ce316e9058c76257848e18ab52624c98d16f758b5f8a73b5007b2ab8b`，初始 lock 摘要 `sha256:e79e2a2735a0b5b151bb4133becd3008223fabedd34a8b787a872edab9854941`。实际解析 348 包（339 registry＋9 workspace），vendor 对应 lock 中 353 包；多出的 14 项单列，不能偷当 339 或全部当 runtime SBOM。[Cargo vendor/locked/frozen 官方说明](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html)

最终 lock 是**本轮已生成候选的冻结输入**；native 编译尚未进行，后续必须 locked/offline 并核 lock 不变，不能据此声称已验证最终 binary 的依赖闭包。

## 4. 许可材料实况

原 11 个 vendor 包未携带常规命名许可全文。4 个有固定 VCS commit 的树已获取；另查 6 个仓库的公开 tag，并以实际发布源文件核对，而非凭版本数字绑定。

- anes、defmt-parser、mutants、difflib 共补回 6 份固定上游全文，先核 Git blob/SHA/发布源码对应，再复制到独立 supplement，不改 vendor checksum。anes 实际在 `anes/` 子目录；difflib 无 tag，用本次发现的 HEAD 冻结为 commit `f035fb8e656f27119e23eca9d5b996df14f3885e`，发布源文件及原 Cargo.toml 实际一致后才采用其 LICENSE，不把浮动 HEAD 直接当证明。
- selectors 的固定源码头指向 MPL 2.0，取得官方 steward 的版本全文并保存 16,726 字节/摘要；明确标为版本许可全文，不冒充上游 Git 中不存在的许可证文件，也不是法律合规结论。[Mozilla 官方全文](https://www.mozilla.org/en-US/MPL/2.0/)
- 仍缺：block、malloc_buf、objc-foundation、objc_id 的对应版本树也没有常规命名全文；其中 malloc_buf 发布 manifest 另有 `.gitignore` exclude 差异，不能称全部文件相同。没有凭作者名补年份、复制其他仓库版权或合成“上游原文”。
- 两个 winapi 0.4.0 target 包没有 VCS pin。仓库 `0.3.9` tag 内虽声明 target 0.4.0，但实际 build.rs/import libraries 不等价；该树全文只是参考，不关闭两个包的来源缺口，也不声称它们已被 Darwin 应用嵌入。
- 32 树中 112 个 filename-based 材料候选已核字节，不是完整义务或嵌入审查。gir-files 未命中常规全文文件名，其 GIR 内嵌 notices/许可仍需核对，不能由名字检索推定“无许可”。

整个许可状态仍 INCOMPLETE。是否实际进入生产目标、哪些属于 dev/跨平台输入，要由后续具体构建图证明；在此之前不删 vendor、换依赖或豁免缺口来凑绿。旧材料/失败/归因记录保留。

## 5. 代码、验证与证据

本批新增配方 `native-source-policy.json`、`native-submodule-inputs.json`、`native-generated-compatibility-inputs.json`；source/patch/archive/configure-review 四个 helper；sources/submodules/patches/rust 四个 CLI；source/patch/archive/rust-cli/configure-review 五个测试文件。只修改本批自己的新增面及进展文档，没有改根依赖、默认 bootstrap/stager、既有 Host/WebUI 产品代码或全局配置。Rust CLI 还补了 spawn 失败及时收据/退出，避免编译器不存在时残留 240 秒计时器。

实际配置只在新的副本以固定 Clang/SDK、最低macOS 11.0、原 CFLAGS 和独立空 prefix 运行，进程使用 `(deny network*)`；未安装/编译这些库。首轮5个configure均退出0，但 WebP `configure:14870` 的 `-a` 行被误当命令、`:19252` 的 GNU式 `sed -i` 在BSD sed报错；Expat收到不识别的 `--without-libbsd`。新增严格诊断helper将原结果审阅为3 PASS/2 FAIL，原stdout/stderr和审阅结果都保留。

新增配方冻结2个WebP原文件的SHA与4个唯一替换：在 `configure.ac` 和发行生成 `configure` 同时补测试条件续行符，`sed -i`改为GNU/BSD均接受的 `-i.bak`，不关闭NEON或减少codec能力；仅在新副本应用，before/after与新overlay身份单列。Expat只从新候选参数移除原本无效的 `--without-libbsd`，其余配置不变；原上游脚本/冻结输入保留，实际Autoconf输入未发现该选项声明，空prefix配置LIBS为空。不据此声称完整目标永不链接libbsd，正式构建仍须依赖/链接检查。

两组派生配置再次在禁网环境运行，脚本错误和未知选项均消失；合并前三组严格结果为5/5 configure冒烟PASS。新overlay身份 `sha256:c5c0490749b0fcf88703e6c42689a4be46a671b52b4f5f6da086c8fea3cba6cc` 必须与原kit共同绑定，不能只用原kit身份构建后称相同候选。WebP可选工具因空prefix缺PNG/JPEG/TIFF等而警告，不是正式依赖验收；正式构建须用完整私有依赖重新配置，不能直接用该探针的生成物。

证据根：`artifacts/webui-optimization/G2-00-sources-0930-B3STbR/`，在 checkout 外、项目 artifact 内；不是发行 output、日常 prefix 或 clean 候选。

| 验证 | 结果 | 相对证据位置 |
| --- | --- | --- |
| source/patch/archive/rust-cli/configure-review 及既有发行拒绝相关回归 | Node22.19.0、24.19.0最终各72/72 PASS、0 FAIL、0 SKIP，9文件；早期65/68矩阵独立保留，不覆写 | `node{22,24}-regression.*`、`*-final-regression.*`、`*-configure-regression.*` |
| 实际新 CLI 负例 | 7/7 PASS：已有 output、checkout output、input alias 均拒绝；未取网络、未覆盖原证据或创建被拒输出 | `cli-negative/cli-negative.json`、对应 stderr |
| 固定源树/子模块 | 28/28、4/4 PASS，归档/文件清单都有摘要 | `exported-raw/sources.json`、`submodules/submodules.json` |
| 实际补丁与内联 | 6/6、12/12 PASS，包含原 check 失败、派生输入及 before/after 摘要 | `candidate-sources-v3/patches.json`、`derived-patches/` |
| 工具链 | 准备/快照子集 PASS；工具 pkgconf 编译 PASS；应用构建 NOT_RUN | `toolchain/profile/profile.json`、SDK/Clang resource 清单、`toolchain/pkgconf-build/` |
| lock/vendor | 冷 offline metadata 与 353 包/18,381 文件 checksum PASS | `rust-closure/rust.json`、`vendor-verification.json`、`source/Cargo.lock` |
| 源码包/材料/kit | 组装与字节子集 PASS；发行等价、许可和配置缺口保留 | `release-archives/*-correspondence.json`、`native-materials-inventory.json`、`rust-license-supplement/`、`remaining-review.json` |
| 新 kit 身份 | `sha256:eae35cb2fecda4fde5c2a1d6a3732bce755bbef123fcf22aa74cb3707d32f425`；不是 binary 或 stackId | `native-build-kit/kit.json`、source/vendor/overlay inventory |
| 严格configure与新派生配置 | 原3 PASS/2 FAIL保留，派生修复后合并5/5冒烟PASS；非完整依赖/库构建 | `configure-probe/`、`configure-candidate-v2/{initial-strict-review,overlay,configure-review}.json` |
| 范围核验 | baseline/最终 closeout 另记；日常指针和原用户文件须保持 | `baseline.json`、`closeout.json` |

具体再运行入口/隔离约束见四个 CLI 源码；inputs/outputs 必须规范绝对路径、outputs 未存在且在 checkout/输入树之外，不能在原证据 output 重跑覆盖。初始 Git 失败、CRLF 失败、gitlink 复制碰撞、缺 LF 补丁失败以及第一版 license correspondence 错误都保留；第二版明确 Cargo 发布生成 metadata/lock 与原 manifest 映射，不将失败改写成成功。

`lean-coding` 将改动限制在 native 输入准备，`research` 只用一手固定源码、官方工具/发行材料；本批探子只读，按单轮派发/等待收敛执行，主代理决定取舍、实施和最终核验。本阶段没有前端修改，不启用设计技能或收费模型。

## 6. 下一步与出口

**仍继续 G2-00-02 收口，不直接跳到 PDF/U2。** 5组混合生成输入的严格configure/目标头文件冒烟已通过，正式构建须共同绑定kit和兼容overlay、用完整私有依赖重新配置。下一步用实际目标/构建依赖图区分生产、dev、跨平台输入，保持完整vendor；补6个Rust文本/来源及GIR/生成材料义务审阅。需要改能力或依赖时先列证据和决策，不静默替换、降限或捏造全文。

上述必需输入/义务/配置闭合后才整体验收 G2-00-02，再进入 G2-00-03 PDF 资产闭包。新 native 编译/F01、默认接线与账本、Full 断网安装仍按 G2-00-04 至 06 分层验证，不切日常 active，也不顺带推定 Thin/其他平台/真实 Provider PASS。
