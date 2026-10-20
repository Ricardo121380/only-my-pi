# U0-04：实际批次边界、PDF加密与四份native原文

日期：2026-09-29。**技术子集PASS：补齐16项解析边界与四份native原文；按当前已批准门禁，U0仍5/6、13/44，G0-03仍未通过。** Full与完整发行源码/许可闭包未完成，不能将本轮实验晋升产品或安装验收。阶段门禁路线已发卡片，尚未获得选择，不自动调整计划。

## 1. 本轮实际改变

- [文档实验探针](../evidence/2026-10-18-local-development-history.md#local-09a4f6ca9c34694e)增加实际批次预检，单材料20MiB、整批50MiB/10份。整批通过前不调用解析器；超量、旧格式、空批次均留实际调用数0及错误码。这里只是合成文档PoC，不是生产上传API或所有材料类型的集成。
- PDF使用解析器确认的`EncryptFilterName`拒绝加密；`PasswordException`归一为`ENCRYPTED_UNSUPPORTED`。不靠匹配`/Encrypt`字串，也不把“没有密码提示”当无加密。
- 新增真正zlib `/FlateDecode`内容流、Standard R2/V1真实加密流/O/U参数；正确用户密码、owner密码与错误密码作为夹具真实性控制。空用户密码的加密PDF单独验证。RC4-40仅为负例数据，不是安全存储建议或新产品解密能力。
- [断网驱动](../evidence/2026-10-18-local-development-history.md#local-30af436d2533866e)追加boundaries模式；沿用活跃监听器基线、沙箱/后代和实际解析worker拒绝联网。原回归/容量不删减。
- [边界审阅](../evidence/2026-10-18-local-development-history.md#local-29b62b6456c65a15)记录新源码摘要及原F01身份。F01资源合同不重写；旧集成绑定旧解析器，后续新Full必须重新绑定和验收。

使用lean-coding限制在实验、必要补丁及证据，research核对官方资料；三个默认单轮只读探子显式`fork_turns="none"`，全部终态后由主代理实施。没有追派或外包修改。

## 2. 复现 → 修复 → 双Node回归

先增加夹具/断言，不先增加PDF拒绝补丁。Node24修复前记录（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-boundaries-0929-Q7kqXA/reproduction.json`）精确复现两个失败：普通密码PDF错误未归一；空用户密码PDF被自动解开并提取正文。正确用户/owner密码可读出两页预期文字、错误密码被解析器拒绝，证明不是仅插入加密标记。

补丁后最终矩阵（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-boundaries-0929-Q7kqXA/verification.json`）：

| 验证 | Node22.19.0 | Node24.19.0 | 范围 |
| --- | --- | --- | --- |
| 原文档回归 | 68/68 PASS | 68/68 PASS | 67既有项＋实际worker网络拒绝 |
| 原实际容量 | 11/11 PASS | 11/11 PASS | 10既有项＋实际worker网络拒绝 |
| 新边界 | 17/17 PASS | 17/17 PASS | 16新增项＋实际worker网络拒绝 |
| 实际批次 | PASS | PASS | 20＋20＋10MiB三份有效PDF恰好50MiB；10份独立有效文件可逐份读取 |
| 拒绝发生于解析前 | PASS | PASS | 11份、50MiB＋1、单份20MiB＋1、空批次、旧格式；parserCalls=0，无结果 |
| PDF压缩与加密 | PASS | PASS | 两页文字/原页码；普通密码与空用户密码均无正文返回；真实性控制分列 |

总计每Node96项解析检查，另各有沙箱/后代2条网络基线负例，不能把两层相加为更多文档样例。容量最大采样RSS为412032/407968KiB；新边界最大144272/193680KiB，保持512MiB监测阈值。25ms采样仍不是硬内核内存隔离。驱动组14890/15348退出，修复前组也确认回收；没有借成功覆盖原OPEN_UNATTRIBUTED历史回收归因。

官方说明支持区分密码保护与加密：[qpdf encryption](https://qpdf.readthedocs.io/en/stable/encryption.html#password-protection)；PDF公共接口的[permissions说明](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html#getPermissions)只表示权限，不能独自判断加密。当前固定6.3.289的实际worker源`documentInfo`使用`xref.encrypt?.filterName ?? null`，本轮读取并沿实际加载路径验证；未以移动版文档代替固定版本行为。

## 3. 四份先前503原文补齐

Gitiles HTTP具体端点仍503；只读探子8次请求、11672响应字节均未取得正文，此过程结论单列。主代理转用**相同官方仓库/同一固定commit**的HTTPS Git对象协议，不使用第三方镜像，不重查25个tag或历史logs。

采集报告（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-boundaries-0929-Q7kqXA/native-git-rdeYwv/native-git.json`）、[审阅快照](../evidence/2026-10-18-local-development-history.md#local-a30e5be2ba566108)保存四份原文共9949字节：

| 来源 | 固定路径 | 已核对 |
| --- | --- | --- |
| [AOM 44d0a57](https://aomedia.googlesource.com/aom/+/44d0a57786f432d933ff64b653347c66f4d0fa1d/) | LICENSE 1316字节、PATENTS 5701字节 | tree blob、实际Git blob/长度/SHA-256；LICENSE另匹配此前审阅SHA |
| [WebP 4fa2191](https://chromium.googlesource.com/webm/libwebp/+/4fa21912338357f89e4fd51cf2368325b59e9bd9/) | COPYING 1496字节、PATENTS 1436字节 | tree blob、实际Git blob/长度/SHA-256；PATENTS另匹配此前审阅SHA |

完整阅读版权与专利文本，分别保留：AOM两条再分发条件与独立Patent License 1.0的Availability/Defensive Termination；WebP三条再分发/不背书条件与独立Additional IP Rights Grant。不是通用BSD模板、不是法律合规意见；未自动作出其他组件许可分支选择。

两个匿名fetch，depth1/小blob过滤；14个受管命令组全部退出，没有checkout或上游源码执行。命令采用私有HOME、关闭全局/系统Git配置、禁凭据/提示、每命令30秒与进程内单文件大小限制；不修改用户Git配置。采集报告生成前工作区实测2155560字节；这是本地对象存储量，**不是网络传输字节或总流量上限**。原503报告和原配方/deferred历史均不重写，由新快照补证。

## 4. 不能由本轮关闭的事项

1. F02仍PARTIAL：最终Rust lock、历史浮动patch、全部逐文件版权/许可分支、对应源码与PDF历史builder/toolchain/更上游生成输入不由四份原文补齐；不再重复相同历史API。
2. F04发行元数据/默认stager、F05独立Full安装、F06**总**收口仍NOT_RUN；本轮只补F06所需技术子集。新parser摘要是`58ece467…`，不能借旧F01的`ab47eb64…`称当前Full身份已成立。
3. PDF压缩流没有独立累计展开字节额度；正文/时间/RSS检查真实生效，但不能宣称解码器硬展开/硬内存沙箱。加密样例覆盖真实R2与两类密码行为，不声称所有security handler已逐一测试。
4. 批次只验证实际合成文档；生产U2仍须冻结上传快照、防源文件变化竞态、覆盖图片/文本混合、卡片与RPC模型实际内容。没有生产附件功能验收。
5. 当前门禁选择待答：保持原U0 Full门禁需另建固定源码/工具链候选；或用户明确调整为U0技术可行性验收，发行闭包作为U2集成前的强制门禁。未获答时沿原计划保持U0未完成，不自动豁免、换库或跨入U1。

没有修改生产Host/发布链、依赖声明/锁、日常指针、用户Glacier追加或全局配置；没有浏览器、新环境安装、原生构建、收费模型、提交/推送、旧产物清理或日常晋升。最终静态核验另留证，不新增上述层次的PASS。
