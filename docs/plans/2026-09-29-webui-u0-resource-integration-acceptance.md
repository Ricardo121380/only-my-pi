# U0-04 固定资源合同与隔离app注入验收

日期：2026-09-29。**F01固定内容合同PASS；F03隔离技术子集PASS、总体PARTIAL。G0-03仍FAIL、Full NOT_RUN，U0仍5/6、总计13/44。** 没有进入U1或Electron，没有默认发行接线或日常安装切换。

## 1. 实际交付

- [资源合同](../evidence/2026-10-18-local-development-history.md#local-6cc62f5d9429765b)：formatVersion 1，app内独立两树、Darwin ARM64、Node22.19.0/24.19.0、固定上限/原件派生策略、源码/原资源档案身份、完整文件/目录/链接清单、包来源与明确许可缺口。
- 两组精确manifest/lock：[文档](../evidence/2026-10-18-local-development-history.md#local-ed4c5ef8cf6ab86a)、[图片](../evidence/2026-10-18-local-development-history.md#local-05662b02d519cc37)；[saxes补充文本](../evidence/2026-10-18-local-development-history.md#local-10432c7f6b8b6f0f)保留原字节，tag来源尚待commit固定。
- [注入helper](../evidence/2026-10-18-local-development-history.md#local-1e2ee4d02bb62fa7)：完整树身份、写入前隔离校验、固定路径注入、不覆盖目标、精确允许链接、重验及失败清理；不回退开发依赖，只接受明确U0_REHEARSAL。
- [实际探针](../evidence/2026-10-18-local-development-history.md#local-32d11e67c0264a10)、[受管子进程runner](../evidence/2026-10-18-local-development-history.md#local-82c208797aa2bda4)、[13组单元测试](../evidence/2026-10-18-local-development-history.md#local-58fbac31c7565b70)。本轮使用lean-coding保持独立验证连接面，不提前改默认stager或添根依赖。

资源不是synthetic测试夹具：文档为pdfjs-dist6.3.289、yauzl3.4.0、saxes6.0.0、pend1.2.0、xmlchars2.2.0的实际资源；图片为Sharp0.35.5及准确的5个传递/native包。bootstrap私有manifest保留原实验名称及0.0.0，不冒称新的产品版本；实际vendor身份独立核验。单元测试里的两个fixture包则明确为合成内容。

| 树 | 实际npm包 | 文件/目录/链接 | 字节 | 完整树SHA256 |
| --- | --- | --- | --- | --- |
| documents | 5 | 592 / 38 / 0 | 35134944 | `715383deb9e9778aaae9cc33f52eae4be4d423278cca81b8e61dac152b20ae72` |
| images | 6 | 128 / 23 / 1 | 19723222 | `9db8be72d303bf8c284c4d9a3f75c1e388b2fc558cef120af98bf1606a1f56c0` |

摘要覆盖所有依赖/资产而非忽略node_modules的单包摘要。UTF-8路径排序，文件记录大小、完整SHA256与可执行位；目录及link目标进入摘要。仅准入`node_modules/.bin/semver → ../semver/bin/semver.js`，绝对/越界/悬空链接拒绝；不隐藏macOS sidecar。pdfjs完整worker/font/CMap/WASM等资源及许可文本保留，不以普通文字用例声称全部辅助资产已实际执行。

## 2. 当前运行证据

最终：integration.json（仓库外证据：`../../../artifacts/webui-optimization/U0/resource-integration-6jwdkc/integration.json`）、双Node测试原输出（仓库外证据：`../../../artifacts/webui-optimization/U0/resource-integration-6jwdkc/unit-matrix.json`）。初轮PuEOfA报告（仓库外证据：`../../../artifacts/webui-optimization/U0/resource-integration-PuEOfA/integration.json`）保留，但不替代补强后的结果。

| 实际环境 | 相关测试 | 文档断网回归 | 文档真实容量 | 图片兼容及Pi公开互操作 |
| --- | --- | --- | --- | --- |
| Node22.19.0 / Darwin ARM64 | 32/32 | 68/68（67＋1网络负例） | 11/11（10＋1网络负例） | 37/37（23正常、14预期拒绝） |
| Node24.19.0 / Darwin ARM64 | 32/32 | 68/68（67＋1网络负例） | 11/11（10＋1网络负例） | 37/37（23正常、14预期拒绝） |

32项仅含新13组资源测试及受影响的stager、deterministic archive、安全解包、source pack/doctor测试，不冒称全仓完整自动化。两Node均从**app重打包解压后的资源**运行，4个probe复制到仓库外并核对摘要；图片Sharp解析路径也断言落于解压资源树。图像使用明确H栈的真实Pi公开resize/read，非RPC/外部Provider或新Full。

新app资源归档`app-with-parsers.tgz`：35705163字节、2540项，SHA256 `1b9d2cc34d923c74b4addc0e452d22ebc66b43ed709e6daf4074b113a57b1928`。两树、锁、资产和contract在重打包及解包后逐项一致。app基底来自H的独立副本，原`artifact-identity.json`源码仍为`cb27c6a9ede6cdb8bbedd155bf74e29e1198210a`；没有把它改成当前HEAD或宣称新候选。

文档容量最大worker RSS为419344/440656 KiB；图片候选最大415472/421520 KiB，均在原512MiB监测门槛内。网络拒绝用真实loopback listener建立CONNECTED基线，macOS worker/descendant与实际图片加载拒绝EPERM/EACCES；父夹具/RSS监控在沙箱外。不是文件系统或硬内存OS沙箱，也不保证任意数据/并发总内存。公开Office旧4项与本轮未改变的解析器字节证据继续引用[文档记录](2026-09-29-webui-u0-document-coverage-acceptance.md)，本次没有额外宣称重新跑过它们。

## 3. 负例与独立复核收敛

新测试覆盖目标已存在/目标link、checkout/源树内输出、app越界/重叠、源/目标及父路径重定向、未准入/绝对/越界/悬空链接、文件/可执行位/目录/lock漂移、必需包缺失、平台/Node/未知purpose、路径/排序/摘要不合法，以及注入后丢资产/合同重定向/额外布局。

只读复核指出四项，主代理亲自修正并最终验收：

1. 原driver先mkdtemp/cp后才检查隔离；现入口在任何写入前检查父目录与源/checkout关系，新负例证明目录清单不变。
2. 原run非零退出/超时可能跳过进程组检查；现fresh detached group由runner独立持有，TERM→KILL→终态检查不因leader退出提前取消。真实合成leaf忽略TERM，leader退出0、退出1及超时三种场景均故障返回且组已消失；不接管或杀旧用户进程。
3. 原“根依赖未变”检查仅覆盖声明/lock；最终名称收窄，明确`installedCheckoutDependenciesMeasured:false`，不声称全量扫描根node_modules。
4. 补copy中途EACCES及最终身份回验失败的故障注入，证明只删除此次新建parser目标，源树及既有app文件字节保持。

另补数值上限/来源字段/明确未闭合许可元数据的版本校验，以及两份原**资源档案**SHA256实测。它们不是npm供应链tarball acquisition或native二进制对应证明；native许可/来源不能因本轮校验升级为COMPLETE。最终9组技术准备PASS，6次记入运行回执的受管组退出；版本及CONNECTED基线的运行调用另外完成组退出检查。旧Photon FAIL及本轮初次结果不覆写。

## 4. 回归边界与下一项

最终报告核对两棵源资源、原app单包内容、根package/lock、原默认stager/assembler/SBOM/private-runtime文件、用户Glacier审计及日常current-stack指针未变。app原有node_modules不在单包hash范围，根已安装依赖也未整树测量，不扩大该结论。未读凭据、未调用模型、未启动用户Host/预览或浏览器、未提交/推送/发布、未清理旧证据。用户审计原有+8/-0保留。

下一项按[内部清单](2026-09-29-webui-u0-parser-full-integration.md)：F02先补真实npm tarball/内容核验、native完整许可与source/patch/Rust最终lock、PDFJS资产映射及saxes commit固定；F04闭合ledger、双SBOM/notices/最终内容准入与默认stager接线；然后F05独立新Full断网安装、F06批次/PDF等剩余解析边界。不能把本次可加载归档当发行许可或旧Full安装PASS，不降低40MP/512MiB目标。
