# U0-04 图片解码内存定位与归一化候选

日期：2026-09-29。结论：Photon 路线的 40MP PNG/WebP 在解码结束时，整个 worker 的 RSS 已超过 512MiB，不是后续完整 RGBA 导出才触发的问题。隔离安装的 Sharp 0.35.5 将同一 40MP 输入缩放为长边 2048 的派生图，在 Node 22.19.0 / 24.19.0 各通过 6 项容量检查；输入原文件前后 SHA-256 一致。

后续已补2000长边实际PNG候选，两Node各37项兼容性与Pi公共入口检查通过，发送合同与原生资源包技术验证已补；native许可/Full及其他解析范围仍缺。最新状态见[候选验收](2026-09-29-webui-u0-image-compat-acceptance.md)，下文保留本轮2048/raw实验历史。

**这是归一化候选的局部 PASS，不是原尺寸解码输出、生产接入或 Full 验收通过。G0-03 保留 FAIL，U0 仍 5/6、总计 13/44。** 2048 是实验参数，尚未替代产品图片质量与发送范围合同；不能将缩放后成功称作无损读取 40MP 原图。

## 证据与复现

- 证据目录：`LOCAL_WORKSPACE/artifacts/webui-optimization/U0/image-memory-0929-kTvZ8r/`。
- 输入沿用 `../capacity-0929-BpxL1H/image-fixtures/` 中真实 8000×5000 和 8000×5001 PNG/JPEG/WebP 载荷，不是只改头部的伪大图；均为合成纯色静态图。
- [Photon 探针](../evidence/2026-10-18-local-development-history.md#local-f1c707d5ef328256) 新增解码前、解码后、裁剪后 RSS/maxRSS，以及仅检查尺寸的诊断模式。`diagnostic24.json` 为 OBSERVED，不把重现失败记成验收 PASS。
- [Sharp 候选探针](../evidence/2026-10-18-local-development-history.md#local-2395d314b7a14217)：独立 worker、20MiB 输入、40MP 解码门禁、10 秒超时、512MiB RSS 监控。worker 在 macOS `sandbox-exec` 禁网策略下运行，父驱动及 RSS 监控在外；采样加 worker 高水位仍不是 OS 内存硬限制。
- 执行形式：`<固定 Node> scripts/probes/webui-u0-sharp-images.mjs <证据目录>/sharp-deps <上一轮目录>/image-fixtures <新报告绝对路径> normalize`。报告禁止覆盖已有文件。

## 根因定位

Node 24 的 `dimensions-only` 诊断不做裁剪或原图 RGBA 导出：

| 输入 | 解码后 worker maxRSS（KiB） | 512MiB 门禁 |
| --- | ---: | --- |
| PNG 40MP | 535024 | FAIL |
| JPEG 40MP | 496288 | PASS |
| WebP 40MP | 529552 | FAIL |

512MiB 为 524288KiB。结论只覆盖整个 worker（含 Node/WASM 基线及解码分配），不能拆算成“解码器自身占用超过 512MiB”。原 Photon 小型回归 `photon-regression24.json` 仍为 11 PASS，未将候选替换进原探针默认路径。

## 候选结果

最终报告包含每个输入的 SHA-256 与 `sourceUnchanged: true`；分别 6 PASS、退出码 0。输出为 2048×1280×4，共 10485760 字节，核对完整输出 SHA-256，不是仅核对尺寸。

| 40MP 输入 | Node 22 maxRSS KiB / 耗时 ms | Node 24 maxRSS KiB / 耗时 ms |
| --- | ---: | ---: |
| PNG | 159728 / 414 | 164736 / 473 |
| JPEG | 92560 / 106 | 98400 / 102 |
| WebP | 424416 / 238 | 430608 / 236 |

来源：`normalize22-2.json`、`normalize24-3.json`。三种格式的 40.008MP 输入均在 `decoding=false` 时返回精确 `PIXEL_LIMIT`。最大实测约 420.5MiB，仍保留原 40MP/512MiB 门槛；耗时为单次夹具结果，不是性能分位数或任意图片的上界保证。

透明 PNG/WebP 的固定 RGB=127、alpha=127，在缩放预乘/反预乘量化后 RGB=126、alpha=127；JPEG 保持 RGB=127、alpha=255。全输出摘要与明确的这些期望一致。不能称无损，后续须评估真实截图、细小文字、透明边缘与方向处理。

### 保留的失败与修正

- `sharp24-1.json`：最初引用旧内部入口不存在，修正为包公开入口 `createRequire(...)("sharp")`，没有将模块加载失败当容量结果。
- `sharp24-2.json` / `sharp22-1.json`：直接导出全分辨率 RGBA 路线仍失败；Node 24 WebP 594720KiB。
- `sharp24-3.json`：改为全图 stats 后，Node 24 WebP 675152KiB，仍失败。
- `normalize24-1.json`：内存达标，但透明图像摘要期望忽略量化而失败；核对 native pipeline 的预乘/反预乘及独立计算后修正期望，没有删除摘要断言。
- `normalize24-2.json` / `normalize22-1.json`：候选首次各 6 PASS；只读独立复核建议加入原文件前后摘要，已补入并形成上述最终报告。旧报告全部保留。

## 依赖与边界

Sharp 仅安装于本轮 `sharp-deps/`，使用独立 npm 缓存/配置路径、`--ignore-scripts --no-audit --no-fund`；未更改项目根依赖、日常栈或生产 Host。与原文档解析依赖的安装不同，本实验需要平台可选 native 包，不声称禁用了全部可选依赖。

隔离 lock 元数据：Sharp 0.35.5 / Apache-2.0，darwin-arm64 native 包 Apache-2.0，libvips 包 1.3.4 / LGPL-3.0-or-later。lock 中列出的其他平台可选包不代表本机均已安装。许可正文、完整传递组件清单、分发义务、SBOM 与 Full 闭包 **尚未验收**，上述元数据不能代替分发审查。

一手 API 依据：[constructor](https://sharp.pixelplumbing.com/api-constructor/) 的 `limitInputPixels`、`failOn`、`sequentialRead`；[metadata / stats](https://sharp.pixelplumbing.com/api-input/) 区分元数据读取与像素分析；[安装文档](https://sharp.pixelplumbing.com/install/) 说明平台原生依赖。实际实验固定版本和本机输出优先于后续可能变化的文档。

## 下一项及验收限制

1. 补候选损坏、伪格式、方向、动画及不同编码/透明度语料，验证精确拒绝原因与缩放质量；不能借用 Photon 的负例证明 Sharp 负例也通过。
2. 明确原件与派生图的保存、预览、发送及来源合同：不能静默替换用户附件或把 2048 实验值直接冻结为产品限制。U2 显示实际发送内容，原件保留与历史快照要求不变。
3. 候选成立后再完成 native 依赖许可与 Full 打包闭包、支持 Node 矩阵及离线加载；目前没有生产替换或日常安装晋升。
4. U0-04 的文档部分解析/来源位置、批次材料预算、PDF 压缩流等其他缺口仍保留，见[解析研究](2026-09-26-webui-u0-parser-study.md)。G0-03 未闭合前不进入 U1。

本轮只修改实验脚本与证据文档；没有收费模型调用、发布、全局配置修改或删除历史产物。
