# U0-04 图片候选兼容性、Pi互操作与资源包

日期：2026-09-29。**选定范围的图片候选检查：Node 22.19.0 / 24.19.0 各 37/37 PASS；每轮 23 个正常样例、14 个预期拒绝。** 正常样例的发送 PNG 经过 Pi 0.85.1 公开 `resizeImage` 与真实 read 工具后字节均一致。原始文件前后 SHA-256 一致。资源包打包/解压及断网加载通过，但第三方许可与 Full 发行闭包不完整，U0-04 尚未验收，U0 仍 5/6、总计 13/44。

## Task 子项与证据

以下是 U0-04 内的工作拆分，不增加原 44 个 Task 的计数。

| 子项 | 结果 | 尚待完成 |
| --- | --- | --- |
| 图片解码内存定位 | 已完成，见[上一轮研究](2026-09-29-webui-u0-image-memory-study.md) | 原尺寸 raw 路线的失败保留 |
| 编码、方向、动画、损坏与容量候选检查 | 两个支持 Node 各 37 PASS | 任意图片/生产并发不是本实验覆盖 |
| 实际发送内容与 Pi 公共入口 | 各 23 个 PNG 字节不变 | RPC、图片补充、真实 Provider 及 U2 产品链另验 |
| 原件/派生图与快照合同 | 已补入[接口合同](2026-09-26-webui-u0-contracts.md) | U2 实现及页面/恢复/清理验收 |
| 原生资源打包、解压、断网加载 | 技术检查 PASS，总状态 PARTIAL | native 第三方许可正文、来源与 Full 闭包 |
| 文档解析剩余范围 | 待补 | 部分提取/来源位置、批次材料、PDF压缩流等 |

本轮源代码：主仓 `4ba9ee4`、`codex/webui-phase1` 上新增的实验脚本，[归一化候选](../evidence/2026-10-18-local-development-history.md#local-4b974ef2c1516392)和[兼容性探针](../evidence/2026-10-18-local-development-history.md#local-ef8873682f166796)。Pi 从隔离 H 栈加载，Sharp 0.35.5 从上一轮独立依赖树加载；项目根依赖、生产 Host 与日常安装未替换。

证据目录（相对工作区 `artifacts/webui-optimization/U0/`）：

- `image-compat-0929-U36z8S/compat.json`：Node24 最终 37 项；另含原件 `fixtures/` 和实际派生图 `derived/`。
- `image-compat22-0929-Mq1X4T/compat.json`：Node22 最终 37 项。
- `image-compat-0929-bmvQvm/compat.json`：首轮 32/33，动画夹具错误的失败保留。
- `image-package-0929-CkQqz7/package.json`、`package-postcheck.json`：资源清单、包身份、断网实际调用参数及结果。
- `image-package-0929-54VqVK/failed.json`：首次资源清点拒绝 npm `.bin/semver` 符号链接的失败。

兼容性复现形式：`<固定Node> scripts/probes/webui-u0-sharp-compat.mjs <sharp-deps绝对路径> <H栈绝对路径> <新建空证据目录绝对路径>`。探针只调用本地图片工具，不发起模型请求。

## 候选处理规则

1. 仅静态 PNG/JPEG/WebP；先按真实 signature 检查格式，20MiB 原文件与 40MP 原尺寸门禁保留。metadata 阶段只读头信息，像素解码使用独立的 40MP 限制。
2. EXIF 方向校正，等比例、最长边 2000、不放大小图，转换 sRGB/8位 PNG 并保留 alpha；发送版本去掉原 EXIF/ICC。原件保留原数据与元信息。颜色转换、缩放与16位转8位可能改变像素，不能称原件无损保真。
3. 2000 是本轮候选工程默认值，与固定 Pi 的文件工具默认尺寸一致；上一轮 2048 raw 容量实验保留为历史证据。本轮实际产出有效 PNG，不再仅导出 raw 内存块。
4. 发送 PNG 的 base64 大小必须严格小于 4.5MiB。超限返回 `DERIVED_BYTES_LIMIT`，产品卡片需展示原因并让用户处理范围/材料；不额外循环降质、自动转 JPEG 或自动换模型。该限制是候选应用预算，不代表所有 Provider 的限额。
5. APNG 扫描完整有界 PNG chunk 序列，拒绝 `acTL`，不只扫描文件开头。多帧 WebP 经实际 metadata 检查拒绝。动画的第一帧不作为已完整支持的材料发送。

API 一手依据：[Sharp autoOrient](https://sharp.pixelplumbing.com/api-operation/#autoorient)、[输出格式与metadata](https://sharp.pixelplumbing.com/api-output/)、[metadata](https://sharp.pixelplumbing.com/api-input/)；结论以固定版本实际运行结果为准。

## 样例覆盖与精确断言

| 类别 | 数量/每个Node | 核验 |
| --- | ---: | --- |
| PNG RGBA、palette、16位、灰度、透明；JPEG baseline/progressive/CMYK；WebP lossless/lossy | 10 | 有效静态发送PNG、尺寸、metadata移除、原件摘要及Pi入口；部分样例另核对完整像素 |
| EXIF 2–8 | 7 | 七种旋转/镜像逐像素独立坐标映射；不是仅核对宽高 |
| 三种真实40MP纯色容量 | 3 | 原尺寸8000×5000、输出2000×1250、全RGBA摘要与明确期望一致 |
| 三种40MP合成截图 | 3 | 原/派生尺寸、非纯色熵/动态范围、Pi字节保持；实际查看PNG派生图 |
| 空文件、SVG伪PNG、格式错配、三种截断、PNG坏zlib载荷、20MiB+1、APNG、多帧WebP、发送体积超限、三种40.008MP | 14 | `ok=false`与精确错误码；关键门禁另断言发生阶段 |

截断样例断言错误码；其 input/metadata 阶段是回执观察值，没有全部写成阶段断言。PNG损坏样例保留有效chunk/CRC但破坏压缩内容，确实在 decode 阶段被拒绝。APNG含两帧控制与payload，动画标记位于5000B文本块之后；WebP夹具先断言确实 `pages=2`。

首轮 WebP 两个相同帧被编码器合并，产生了静态文件，不能证明动画拒绝。改为不同帧、加入夹具页数断言后通过；失败报告保留，没有改为接受动画来消除失败。

PNG/JPEG/WebP、EXIF正常样例最终原件与派生摘要在两个 Node 版本逐项一致。只读独立核验确认测试断言与回执一致；没有重新代替主代理执行验收。

## 内存与真实Pi边界

| 输入 | Node22 worker maxRSS KiB | Node24 worker maxRSS KiB |
| --- | ---: | ---: |
| 40MP PNG纯色 | 135344 | 141712 |
| 40MP JPEG纯色 | 86880 | 92560 |
| 40MP WebP纯色（各轮最大） | 415040 | 421440 |
| 40MP PNG合成截图 | 136032 | 142096 |
| 40MP JPEG合成截图 | 86992 | 92800 |
| 40MP WebP合成截图 | 255648 | 261520 |

Node24最大约411.6MiB，Node22约405.3MiB；512MiB门槛与10秒超时未提高。每个worker采用25ms RSS采样与自身maxRSS高水位，主动终止并等待close。`SIGKILL`表示测试驱动完成后结束worker，不是自然退出证明。父生成器、Pi内部worker线程与并发服务的总内存不在这个单worker数值里；这仍不是OS硬内存边界或性能分位数。

Pi固定栈中的调用链源码：`pi/dist/core/agent-session.js:841–850,900–906` 将 RPC user images 直接加入消息，可经扩展 input hook 改写；`pi/dist/utils/image-resize-core.js:3–9,35–58` 则先解码，再对尺寸/体积达标图片返回原字节。`pi/dist/core/tools/read.js:63–85` 使用图片处理入口。上述是隔离安装栈路径；不把开发依赖副本当该栈证据。

本轮每个正常派生PNG经公开 `resizeImage` 断言 `wasResized=false`、base64相同，再经 read 工具断言 image block/MIME/摘要相同。这覆盖实际文件工具互操作，**尚未覆盖 RPC/扩展/Provider 最终请求**；材料准备层在U2负责模型图片能力、身份绑定及最终内容一致性。

合成截图已实际打开核对大字、色块、细字与布局；这是一个可检查的质量样例。熵/动态范围不等于OCR、小字可读性、照片或任意ICC色彩的质量验收，U2还需实际用户材料预览和具体模型路径验证。

## 原生资源包与发行缺口

实际安装6个npm包；lock另有26个未安装optional包，不列为本机已打包组件：Sharp0.35.5、`@img/colour`1.1.0、detect-libc2.1.2、semver7.8.5、darwin-arm64 native Sharp0.35.5与libvips1.3.4。

资源清单129条（含一条经精确核验的npm相对链接）、19723222字节，tgz8438264字节；逐条解压身份一致。第一次全拒符号链接遇到 `.bin/semver → ../semver/bin/semver.js`，修正仅允许该准确路径、目标及解析后的包内文件；没有开放任意链接或忽略记录。

Node22/24使用解压后的依赖目录运行小PNG。实际 `sandbox-exec` 禁网环境中主动TCP连接返回 `EPERM`，原生模块仍加载并处理成功。`package-postcheck.json`记录Node路径、cwd、依赖/输入/候选代码路径、源码与归档SHA-256、退出码。容量矩阵与小图断网加载分别留证，不把小图成功重复计为40MP验收。

已有五包许可正文及 `@img/colour` 内四个打包MIT组件文本均随资源保留；libvips README有29个库/许可声明、versions有28项，缺libnsgif版本。本地没有libvips完整第三方许可文本、对应源码包/补丁或确切构建提交。动态依赖/RPATH及ARM64加载已经核对，但这些技术结果无法补全上述发行材料。

因此资源报告明确 `PARTIAL / licensingClosure=INCOMPLETE / Full=NOT_RUN`。下一步须补齐原生组件可追溯许可与来源，并将文档/图片资源纳入选定Full的应用包、资源账本、SBOM、notice与包检，再从实际隔离安装路径复验。U0-04其他解析范围仍见[解析研究](2026-09-26-webui-u0-parser-study.md)；不以本轮局部PASS关闭G0-03。
