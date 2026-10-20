# U0-04 实际容量与断网验证

日期：2026-09-29。**文档容量与解析worker断网检查通过；图片容量失败，G0-03仍未通过。** U0保持5/6、总计13/44，不进入U1，不将独立资源包当Full发行验收。

## 本轮改变

- `webui-u0-documents.mjs`增加`capacity`及`offline-*`模式；使用真实默认预算生成合成文件，每例记录输入字节、维度、耗时、采样RSS、退出及精确错误。失败不阻止其余容量样例留证。
- 新增`webui-u0-parser-offline.mjs`：复用仓库已有macOS `(deny network*)`策略，复制探针到仓库外，显式使用先前解包的解析依赖；对活跃loopback监听器先验证未隔离时CONNECTED，再验证沙箱与其后代EPERM，实际解析worker也独立验证EPERM。
- `webui-u0-images.mjs`新增真实40MP/40.008MP的PNG/JPEG/WebP编码载荷。移除验证阶段整张RGBA导出到JS的额外复制，改检查解码后1×1像素及尺寸；容量样例核对像素值。此改动**未解决所有容量失败**，不改512MiB阈值。
- 使用lean-coding仅改实验探针和报告，未增加依赖、修改生产入口/配置或日常栈。未启动Full构建，未读取私人文档，未调用外部模型。

## 实测

环境：macOS arm64，Node22.19.0/24.19.0；候选H内Pi0.85.1/Photon0.3.4，已解包资源为pdfjs-dist6.3.289/yauzl3.4.0/saxes6.0.0。构建卷检查约837GiB可用，没有清理数据。

| 场景 | Node22 | Node24 | 精确范围 |
| --- | --- | --- | --- |
| PDF200页/201页 | PASS | PASS | 200个位置/末页正文正确，201报PAGE_LIMIT |
| PPTX200张/201张 | PASS | PASS | 声明顺序、末页位置/正文正确，201报SLIDE_LIMIT |
| XLSX200000/200001单元格 | PASS | PASS | 非空数值、首尾坐标；超限CELL_LIMIT |
| ZIP10000/10001条目 | PASS | PASS | 正常正文可提取；超限ENTRY_LIMIT |
| 展开200MiB/多1字节 | PASS | PASS | 真实压缩内容展开计数；超限EXPANDED_LIMIT |
| 断网文档回归 | 39＋1 PASS | 39＋1 PASS | 39项原回归＋实际worker联网拒绝 |
| 断网文档容量 | 10＋1 PASS | 10＋1 PASS | 上述10项＋实际worker联网拒绝 |
| 小图片回归 | 11 PASS | 11 PASS | PNG/JPEG/WebP解码、坏头、坏载荷、像素前置门禁 |
| 真实40MP PNG | FAIL | FAIL | MEMORY_LIMIT，采样534112/534768KiB，未提高阈值 |
| 真实40MP JPEG | PASS | PASS | 采样431200/462208KiB，尺寸及解码像素检查通过 |
| 真实40MP WebP | FAIL | PASS | Node22采样530496KiB触发MEMORY_LIMIT；Node24采样504272KiB通过，不据一次成功承诺稳定裕量 |
| 真实40.008MP三格式 | PASS | PASS | 均在decoderStarted=false时PIXEL_LIMIT，不是只改文件头 |

断网容量批次最高采样RSS：Node22为391120KiB，Node24为441760KiB；单例最长673/589ms。另一次未隔离Node24的20万单元格采样447040KiB。只适用于本机合成样例，非复杂大表/所有生产者性能保证；25ms采样不是硬内存上限，可能过冲。图片10秒worker时限保持原值，未用增加时间/内存预算隐藏失败。图片生成父进程不受worker预算限制，生成开销不混算为解析耗时。

## 失败与修正

1. `offline-node24-1.json`：整个驱动进入沙箱，监控`/bin/ps`的spawn被拒EPERM。已改为仅解析worker受网络沙箱限制，RSS监控留在父进程；不是放开worker网络。`offline-node24-2.json`通过后补实际worker联网断言，最终以3为准。
2. `images-capacity-node24-1.json`：PNG/WebP超内存。已从实际绑定源码确认`get_raw_pixels()`执行全量`.slice()`复制，40MP对应160000000字节额外JS输出，探针无须导出整图。
3. 更换成解码后像素样本检查后，`images-capacity-node24-2.json`仍有PNG失败；Node22又发现WebP失败。剩余峰值尚不能精确归因于解码器内部、WASM内存或crop实现，不声称根因全部解决。失败worker均被回收，拒绝行为正常，但这不等于40MP目标容量已达成。

## 证据与下一项

仓库外目录 `../artifacts/webui-optimization/U0/capacity-0929-BpxL1H/`。保留所有失败，不覆盖：

- `capacity-node24-1.json`：10项未隔离容量。
- `offline-node24-3.json`、`offline-node22-1.json`：最终断网报告，各指向独立的回归/容量细节文件。
- `images-capacity-node24-2.json`、`images-capacity-node22-1.json`：最终图片容量失败；`images-regression-node24-1.json`、`images-regression-node22-1.json`为回归。

**G0-03=FAIL（已证实图片容量失败），Full安装层仍NOT_RUN。** 下一步优先区分解码与验证阶段的内存峰值，评估在原40MP/512MiB目标内可行的解码路径；若必须改变目标，需明确讨论，不自行降上限。之后补部分解析/位置提示、真实加密容器与PDF压缩流、批次材料预算及Full许可/SBOM/资源闭包。现有Full链未纳入这些实验解析依赖，不能直接构建一个不含它们的旧包冒充完成。
