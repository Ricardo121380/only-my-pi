# G2-00：固定重建输入与发行前置进展

日期：2026-09-30。**G2-00已开始；本批重建输入冻结子集PASS，F02仍PARTIAL、G2-00整体NOT_RUN、Full NOT_RUN，U2产品入口仍BLOCKED。** U1已完成6/6，产品Task总计仍20/44；下列内部步骤不增加44项分母，不启动Electron。

后续进展：G2-00-02已开始，固定源树/补丁/工具链快照、lock/vendor及隔离kit的技术子集通过，源码生成输入与许可收口仍PARTIAL，尚未整体验收。[G2-00-02实况、最终回归与缺口](2026-09-30-webui-g2-00-native-source-progress.md)。下文48项矩阵/未安装工具等是G2-00-01当批事实，不作为G2-00-02当前工具状态。

10-01最新：在[原实际图与材料复核](2026-10-01-webui-g2-00-native-closure-review.md)之后，用户批准的[locale窄适配已技术验收](2026-10-01-webui-g2-00-locale-adapter-acceptance.md)。新图160/177包、新lock/347完整vendor与独立kit已冻，双Node各38项相关回归通过，原4缺材料macOS包退出新生产规划；原353包/旧失败保留。Windows/GIR/生成材料义务仍待收口，G2-00-02整项PARTIAL；不再等待路线确认，不开始G2-00-03/U2，也不将规划当作最终cargo-c链接。

依据：[当前Task看板](2026-09-26-webui-optimization-tasks.md)、[发行/Full清单F01–F06](2026-09-29-webui-u0-parser-full-integration.md)、[用户确认的门禁调整](2026-09-29-webui-parser-gate-adjustment.md)。采用已选的固定源码/工具链新候选路线，不无限重查旧run，也不把新构建推定为旧预编译二进制的历史材料。

随后本批[两Windows包完整源/全文绑定子项已验收](2026-10-01-webui-g2-00-cross-platform-materials.md)，双Node各24项及实际离线三方对应通过，supplement另冻，未改locale kit。215生成文档已映射43手册，GIR原件/加工链和生成例外仍PARTIAL；整项/Full/U2门禁不变，不把旧Windows未匹配记录当当前结论。

最新[生成材料原文/来源绑定子项通过](2026-10-01-webui-g2-00-generated-materials.md)：GNU官方GFDL1.1全文、gettext0.18.3完整原包与9个实际文件对应、Makevars3行派生及父目录GPL/独立notice另冻36文件；双Node各27项与实际禁网探针通过。只完成指定材料绑定，未落实全部转载/派生义务或合入新kit；111项宏/生成器例外、剩余12项新来源与GIR仍待收口，G2-00-02 PARTIAL。

后续[逐输入notice材料清单子项通过](2026-10-01-webui-g2-00-notice-inventory.md)：368项材料及111完整宏/脚本保留，12项静态规则和spec/stdint/stamp-vti三项内容对应；双Node各25项/实际禁网/许可漂移负例通过，476文件另冻。并非条款全通过或历史重生成；Doxygen归档资产、GIR来源/加工/引文及其余生成义务仍待收口，不改G2-00-02 PARTIAL或Full/U2门禁。

本轮[libexif固定文档材料绑定子项通过](2026-10-01-webui-g2-00-libexif-doc-materials.md)：106文件归档受限解包、实际Doxygen1.16.1、19源码页/1353展示行、9指定资产对应及6组件原声明/指定来源保存；双Node各9项、禁网和同长度版权漂移负例通过，239文件另冻。CSS完整组合、Graphviz14.1.2必要材料、其他生成数据与GIR仍PARTIAL，未重建整份文档、合入kit或变更Full/U2门禁。

## 1. 本批交付

- 新增[输入配方](../evidence/2026-10-18-local-development-history.md#local-337cc74fd07640ca)，绑定sharp-libvips构建提交`ebb95f8add54eee8bed840e3fb587e4cbec857d7`、Darwin ARM64目标、两份已有源pin/审阅快照、3个上游文件及6份有序补丁的大小、SHA-256和Git blob摘要。只准`NEW_CANDIDATE_INPUT_COLLECTION_ONLY`，修改为许可闭合/Full通过/发行用途即拒绝。
- 新增[清单与归档helper](../evidence/2026-10-18-local-development-history.md#local-49e25ec972b4a7c3)及[离线探针](../evidence/2026-10-18-local-development-history.md#local-d5039564f52b286c)：完整保存构建脚本、versions、固定notice与全部补丁，不只抽取13处`sed`片段；静态展开28个下载定位，不解释/运行Shell。输入摘要、外部补丁步骤、UltraHDR候选顺序漂移均失败。
- 本批4份公开补丁原文取得HTTP 200：GLib、MozJPEG、librsvg、libvips C++ soversion；每项仅1次GET，手动拒绝重定向、15秒限时、512KiB响应上限，总计4次、21487字节，不使用认证或重试。2份UltraHDR补丁复用旧证据，重验大小/两种摘要，未升级为已应用补丁。
- 原脚本含5个外部补丁步骤，UltraHDR步骤拟由2份固定commit补丁替代，所以新候选输入是6份，而非6个历史步骤。应用结果及与历史浮动PR383字节的等价性未验证。GLib只将同一固定Gist revision定位到原文域名，没有改为main。
- 固定28项版本/源commit，另记录libnsgif的vendored目录及独立版本UNVERIFIED。28个版本化archive地址仅是待获取定位，全部保留`archiveSha256:null / UNACQUIRED`；固定commit文本不等于完整源码包到手。

一手依据：[固定上游完整构建脚本](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh)、[固定版本表](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/versions.properties)、[固定notice](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/THIRD-PARTY-NOTICES.md)。补丁原文/URL/摘要见获取收据；本地Git blob计算不冒充独立签名、服务端对象或历史builder验证。

## 2. 验收与证据

证据根：`artifacts/webui-optimization/G2-00-inputs-0930-gTpBlW/`（仓库外、项目artifact内；不是发行输出或日常prefix）。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 新增边界测试 | 9项PASS：用途/平台/URL、源码快照/字节漂移、补丁顺序、未知Shell展开、目录碰撞/别名及非可执行归档 | [测试源码](../evidence/2026-10-18-local-development-history.md#local-53db7a7f258983a4) |
| 双Node相关回归 | Node22.19.0、24.19.0各48/48 PASS、0 SKIP；4个测试文件，含原native/source材料及U0-only发行拒绝门禁 | `node{22,24}-regression.{json,tap}` |
| 实际离线输入归档 | 两Node都归档3个完整上游文件＋6补丁；28源码定位、13内联操作、5外部步骤；相同inventory摘要 | `bundle-node{22,24}/{inventory,probe}.json` |
| 实际CLI负例 | 已存在output、checkout内output、source目录别名均拒绝；未覆盖原bundle或创建负例output | `cli-negative.json`及对应stderr |
| 工具链准备 | 当前PATH有cmake/cargo/rustc/rustup/clang/python3，未找到meson/ninja/pkg-config；只查PATH，不推定整机不存在，未安装或执行编译工具 | `toolchain-presence.json` |
| 范围/静态核对 | 日常active指针未切，根package/lock及已有工作树内容未由本批改写；diff检查通过 | `baseline.json`、`closeout.json` |
| native构建/实际patch应用 | NOT_RUN；此批仅归档和静态定位，不运行上游脚本 | 清单内`remaining`及`upstreamCodeExecution` |
| 默认接线/双SBOM/notices/Full断网安装 | NOT_RUN；F02未闭合，不放行F04/F05 | 沿用原门禁，不改默认stager |

两个实际清单的`inventorySha256`相同：`sha256:ee03d2514e727b07923e3cc5b1f1feb9ea899e4854e2569d2084248c3ed4a2fa`。它绑定本批配方及原文输入，不是新dylib、stackId或完整许可证明；`recipeSha256`使用解析后固定JSON值的摘要，两个源审阅快照另核对原文件字节摘要。

探针参数依次为：旧`native-source-7VF7L0`根、本批`public-patches`根、旧`source-materials-MrVmws`根、新的不已存在的隔离output目录，均须绝对规范路径。读入已有证据、核验后生成新目录，禁止覆盖旧证据或在checkout写output；复跑不再联网。

## 3. 内部执行顺序

下列拆分执行F01–F06，不新增产品范围或改变U0/U1验收口径。

| 内部项 | 当前状态 | 交付与出口 |
| --- | --- | --- |
| G2-00-01 固定重建输入 | 本批子集已验收 | 完整上游脚本/notice/versions、6补丁、有序替代方案、28源码定位及缺口；不是可运行离线构建配方 |
| G2-00-02 native完整源码与构建闭包 | 材料收口中；locale、Windows、指定生成、notice清单及libexif限定文档绑定子项PASS，整体PARTIAL | 原28源树＋4子模块、补丁/工具链/353 vendor/kit和5组configure保留。locale新图160/177包、347 vendor与38项；Windows三方绑定/24项；xmlwf/GFDL、gettext/Makevars绑定/27项；368项notice/111完整宏/12规则/3内容对应/25项分别留证。最新libexif106文件、19源码页、9资产/6组件、双Node9项及239文件另冻；CSS/Graphviz必要材料、GIR来源/文档及其他生成实际义务仍待收口，不合入原kit或补造全文 |
| G2-00-03 PDF辅助资产/构建闭包 | 待开始 | 核验QuickJS等实际输入、fonts/CMap及义务；新PDF预算worker/两辅助模块及实际URL/font/CMap覆盖纳入候选，不能拿文字样例等于全资源覆盖 |
| G2-00-04 新候选与F01身份 | 待前两项 | 生成/绑定新native候选及资源合同；重验图片/实际Pi/容量/RSS、PDF预算及资产加载，不继承旧dylib验收 |
| G2-00-05 F03/F04接线与发行账本 | 待F02、候选身份 | 默认stager接线、parser acquisition/ledger、双SBOM/notices及最终pack精确对账；缺源码/许可/资源须拒绝，不能放宽U0-only门禁凑通过 |
| G2-00-06 F05/F06 Full验收与收口 | 待F01–F04 | 隔离clean候选/新output及prefix，断网安装，从安装资源实际回归；全部必需证据闭合才G2-00 PASS、开始U2-01。不切日常active，不顺带称Thin/其他平台PASS |

## 4. 风险与边界

1. 发布包/tag地址可能变化。下一项必须取得完整包及摘要、核对源对应关系；URL定位和`UNACQUIRED`不升级为字节冻结PASS。
2. 原脚本仍含floating nightly/cargo-c、`cargo update --workspace`以及从main取notice。本批保存这些事实并另固定notice字节，未修改/运行构建流程；新工具链与最终lock须以实际记录证明。
3. 6补丁只固定输入身份。无偏移应用、UltraHDR顺序及平台条件尚未实测；失败时调整新配方并形成新身份，不改写历史记录。
4. 完整许可/版权与Rust传递材料、PDF构建资产义务尚缺，F02仍PARTIAL。文本/摘要对应是技术证据，不提供法律合规结论。
5. 只新增probes/配方/测试及进展文档，未接默认发行、未改根依赖、未调20MiB/40MP/512MiB边界、未调用收费模型、未装全局工具或切日常stack。`lean-coding`将实现限制在输入冻结面；`research`只用一手来源，探子只读定位，修改、取舍及最终核验由主代理完成。

**当前继续G2-00-02收口，不是U2-01或Electron。** 其技术子集PASS不解除完整发行及U2入口门禁；整体验收后才G2-00-03。
