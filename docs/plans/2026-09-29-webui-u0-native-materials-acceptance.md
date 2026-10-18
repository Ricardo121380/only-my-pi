# U0-04 F02：native 固定版本原文与历史输入可得性

日期：2026-09-29。**本步确认25个固定源版本，实际保存47份许可/来源原文；完整许可及构建闭包仍PARTIAL，G0-03仍FAIL。U0保持5/6，总计13/44。** 不进入U1/Electron，不接默认Full或切日常安装。

## 1. 交付与实测结果

按照[Full内部清单](2026-09-29-webui-u0-parser-full-integration.md)继续F02；此前[PDF158项对应及回收补强](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)不重做、不覆盖。使用lean-coding保持解析资源/生产代码不变，research用于一手材料核对；五个单轮默认角色探子均`fork_turns="none"`、只读，全部终态后由主代理采集、实施与最终核验。

| 产物 | 行为与证据 |
| --- | --- |
| [固定原文配方](../evidence/2026-10-18-local-development-history.md#local-673977b45ac0b821) | 25个官方repo/tag/commit；49个已定位原文的路径/长度/Git blob，41个另有预期SHA-256；两条未取得全文的路径显式deferred，不猜填摘要 |
| [helper](../evidence/2026-10-18-local-development-history.md#local-5098848ed003cbad) | 实际28个native版本键逐条匹配；拒绝未知repo/路径/身份、重复及漂移；标签对象与peeled commit分别检查；许可、链接目标、版权样本、专利授权分列 |
| [采集探针](../evidence/2026-10-18-local-development-history.md#local-8a2fa89f51048fe1) | 24次精确`git ls-remote`＋mozjpeg短提交官方API；64 GET/单响应512KiB/累计4MiB/20秒边界；不跟重定向、不自动重试、不认证；所有有界HTTP响应原文以wx保留，包括503/403 |
| [12项新回归](../evidence/2026-10-18-local-development-history.md#local-bc3d2654de9b5a83) | 版本/源/路径/摘要/基数、基准与peeled tag、base64与高位字节、重定向/503、请求/字节边界、既有证据不覆盖；合成文本不冒充真实上游许可 |
| [审阅快照](../evidence/2026-10-18-local-development-history.md#local-22a4853329924f3c) | 绑定配方、实际采集报告、执行时代码与最终代码、双Node只读复验及全部缺口；不改F01历史声明或前批source快照 |

主探针报告（仓库外证据：`../../../artifacts/webui-optimization/U0/native-closure-0929-SVDYrc/native-materials-9Cvod7/native-materials.json`）：**59次显式GET、616375响应字节、47份固定源原文**，包括36份许可正文、2份作者清单、5份版权/授权源文件样本、3份许可选择/说明及1份链接目标。覆盖23个新增库的主要版权许可文本，不宣称这23库的全部文件/义务完成；此前三库和vendored nsgif材料保留，未混入本批新采集数。

25个源身份均确认；其中mozjpeg `0826579`完整commit为`08265790774cd0714832c9e675522acbe5581437`，不是未经解析的短标识。24个git受管组实际退出，最终双Node再次确认旧组不存在。Git传输字节及底层HTTP次数**未测量**，不能把59/616375称作整轮全部流量。

探子的查找和主代理7次预查（仓库外证据：`../../../artifacts/webui-optimization/U0/native-closure-0929-SVDYrc/preliminary-lookup.json`）另列，不计入59次。预查WebP PATENTS曾200并自算摘要，但只有工具stdout、未保留原文；最终采集503，因此不算已留存材料。当前四个失败路径为AOM LICENSE/PATENTS、WebP COPYING/PATENTS；HTTP503正文保存，**不是许可正文、不是永久不存在结论**。不自动增加重试或换未经核实镜像。

## 2. 必须保留的许可差异

逐条固定链接、完整摘要和实际文件位置在配方/报告中；以下主文本辨识不代替法律意见或最终发行选择。

- [Expat](https://github.com/libexpat/libexpat/tree/4b3f0b06f39fb5529cead381694f8929901bc273)的根与`expat/COPYING`内容不同，分别保留；libexif额外8份LICENSES正文按固定blob取得，不以一份通用LGPL覆盖。
- [GLib COPYING](https://github.com/GNOME/glib/blob/436d47a723da97fbe67057f6b51dcf49a244fd4a/COPYING)只是30字节symlink目标；保留真实`LICENSES/LGPL-2.1-or-later.txt`和源文件授权样本。Pango/proxy-libintl的COPYING为Library GPL v2正文，不误标为v2.1；源文件的or-later声明另外保留。
- [FreeType选择声明](https://github.com/freetype/freetype/blob/0a0221a1347e2f1e07c395263540026e9a0aa7c7/LICENSE.TXT)与FTL/GPLv2正文都保留；项目尚未实际选择许可分支。附带BDF/PCF/gzip等材料仍须审阅。
- [Cairo](https://gitlab.freedesktop.org/cairo/cairo/-/blob/018b3424a10ecd37450360f21454ecf0f3007e17/COPYING)包含选择入口和LGPL2.1/MPL1.1两份正文；[Highway](https://github.com/google/highway/blob/2607d3b5b0113992fe84d3848859eae13b3b52c1/LICENSE)包含Apache/BSD选择与CC0例外。当前没有把选择要求或未进入产物的辅助代码全算成最终发行许可。
- [mozjpeg](https://github.com/mozilla/mozjpeg/blob/08265790774cd0714832c9e675522acbe5581437/LICENSE.md)需保留IJG/BSD与SIMD相关许可，README.ijg完整保存；SIMD逐文件许可还缺。lovell/libimagequant的COPYRIGHT另含独立permission notice，不替换为通用BSD模板。
- [fontconfig](https://gitlab.freedesktop.org/fontconfig/fontconfig/-/blob/0f236723a3c26bd9745e32ba2b3ee21e5f809295/COPYING)、libpng、harfbuzz、libarchive、libtiff、libxml2的根文本均指向额外版权或条款，已保存主原文，尚未全部逐文件展开。尤其libtiff LZW条款不能省略、libarchive占位作者不能当具体作者清单。

Git源树原文不等于build实际下载release tarball的字节；GNOME镜像tag不直接证明tarball内容相等。构建inline修改、静态嵌入组件/Rust传递组件和对应源码仍是独立工作，不以“25个源pin”替代。

## 3. 历史构建输入：新增证据与边界

实际公开API和固定workflow原文均保存于主报告metadata及对应response文件：

| 检查 | 当前结果 | 不可推导的结论 |
| --- | --- | --- |
| [run36315646015/attempt1](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/attempts/1) | 绑定`ebb95f8add54eee8bed840e3fb587e4cbec857d7`；success | 不证明最终lock、当时patch字节或全部源码已保存 |
| [jobs](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/attempts/1/jobs?per_page=100) | 16项；Darwin arm64 job108609814186 success，upload步骤success | upload成功不等于artifact现在可得或包含DEPS |
| [artifacts](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/artifacts?per_page=100) | HTTP200、total_count=0、完整空页 | 不断言私人留存、其他渠道或历史全无材料 |
| [attempt logs](https://api.github.com/repos/lovell/sharp-libvips/actions/runs/36315646015/attempts/1/logs) | HTTP403；匿名权限不足，未读取凭据、未跟signed下载 | 不是日志内容为空；也不证明日志必含最终lock/patch摘要 |
| [Release](https://api.github.com/repos/lovell/sharp-libvips/releases/tags/v1.3.4) | 唯一asset为npm-workspace.tar.xz，86852556字节；仅metadata | 没下载此包，不能称其内容已审阅或完整源码包 |

[固定workflow](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/.github/workflows/ci.yml#L75)只上传`*.tar.gz`、retention-days=1；[posix脚本](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh#L490)归档include/lib/json/notices，不是完整DEPS源码。两者可解释为什么当前空artifact与“没有完整source收集步骤”相容，但不证明精确消失时刻或日志内容。

准确区分Cargo行为：[官方cargo-update说明](https://doc.rust-lang.org/cargo/commands/cargo-update.html)的`--workspace`不是无条件升级全部传递依赖；工作区之外通常沿用已有lock，仅不存在的包另解析。固定脚本在修改manifest/feature后运行该命令，仍须取得最终lock或可核验新构建，不能用tag初始lock或今天一次重新解析冒充当时结果。两份UHDR固定commit patch仍只是候选变更，不是历史浮动PR响应的已证实字节。

## 4. 下一条可执行路线

继续同一F02，按“明确缺口→有界取证→固定原文→逐来源/义务审阅”推进，不再重复已完成PDF158项字节定位或25库tag解析。

1. 补剩余PDF QuickJS/font/WASM精确构建输入、授权及必要源文件；native先补四个取文失败项，以及已指明的逐文件版权/例外。只读GET可在后续独立有界批次进行，失败不得自动扩量。
2. 历史native输入维持PARTIAL；没有额外公开留存证据时，**不继续无限重跑日志API或用86MB npm workspace代替源码闭包**。若要联系上游或使用额外账户权限，另核对具体授权；当前未发消息或读凭据。
3. 准备可核验重建的固定输入清单，与继续采用现有预编译包比较，再决定是否实施。重建必须冻结28库源码归档/摘要＋vendored nsgif、五个外部patch/全部inline修改、最终Rust lock/vendor、dated nightly/cargo-c/compiler与构建工具、许可分支/notices/必要链接材料；新dylib摘要意味着新F01候选并重验F03/40MP质量/RSS，不能悄悄替换当前资源。

| 路线 | 收益 | 成本/当前前置 |
| --- | --- | --- |
| 保留现有预编译，补现成材料 | 不扰动已测图像质量/内存与F01身份 | 历史lock/patch仍未取得，完整版权/source义务仍需闭合；没有新证据不能晋升 |
| 有界、可核验新构建 | 新构建输入可自行固定与保存，不伪造历史结果 | 重新准备native/Rust工具和源码，生成新候选、完整回归及对应源码；尚未运行，无可信时间/RSS估算 |
| 更换解码候选 | 可能减少发行依赖面 | 原Photon40MP已失败；新库必须重验三格式质量/Pi互操作/512MiB，不能默认认为更便宜；本轮未选或实施 |

环境只读检查：构建卷835GiB可用，CommandLineTools/Apple clang21.0.0，PATH可见cmake/cargo/rustc/rustup；`command -v`未找到meson/ninja。不声称全磁盘无工具或Rust已满足精确版本，也没安装工具、执行原生构建。推荐先完成仍可独立取证的PDF/版权材料，并固化重建前置；精确历史输入无法闭合时保持阻断，不猜填、不静默换库或降40MP/512MiB目标。

## 5. 收口验证与保留边界

最终双Node记录（仓库外证据：`../../../artifacts/webui-optimization/U0/native-closure-0929-SVDYrc/verification-final.json`）：Node22.19.0/24.19.0均**20/20**（新12＋既有源绑定8），三文件语法通过；Node22只读复验（仓库外证据：`../../../artifacts/webui-optimization/U0/native-closure-0929-SVDYrc/offline-v22.19.0-LSTjrN/revalidation.json`）/Node24只读复验（仓库外证据：`../../../artifacts/webui-optimization/U0/native-closure-0929-SVDYrc/offline-v24.19.0-jY1nCE/revalidation.json`）重算59响应/47原文/25pin、F01整树及受监测release文件，fetch调用0、24个git组均确认不存在。这里是本地已保存字节重放，不是OS断网Full安装。

收口把Gitiles解码从ASCII转为UTF-8并补高位字节拒绝回归，避免ASCII转换掩盖非法编码；原采集执行时摘要与最终代码摘要分别保存，报告不重写。最终实际Gitiles材料均503，因此真实成功解码路径为NOT_RUN，只有明确合成回归通过。

没有新依赖安装、native构建、patch应用、默认发行接线、全量项目测试、前端/浏览器或Provider验收，也没有日常晋升、清理、提交/推送或全局配置修改。原Glacier审计+8/-0及日常指针保留；本步验证不关闭原回收历史归因OPEN_UNATTRIBUTED，不代替后续F04–F06。
