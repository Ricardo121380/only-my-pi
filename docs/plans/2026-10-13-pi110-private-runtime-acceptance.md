# #65 / PI110-N04：Pi 1.1.0 私有运行时验收

日期：2026-10-13。范围：GP110-04 / US-088、US-125，只交付 Pi 1.1.0 输入；本轮止于 #65。总规格 #19 保持原正文。#73/#74 已回读 CLOSED / completed；#75 的原生前置执行前仅 #65 开放。

## 基线与输入身份

- 主仓分支 `codex/webui-phase1`，起点 `96f16207257ec451c7f0c418de8135ecf7896899`；原 302 个 dirty 文件按字节、模式与路径冻结，索引起初为空。
- 证据根：`LOCAL_WORKSPACE/artifacts/pi110-n04-20261013`，保存 `baseline.json`、`baseline.diff`、GitHub 正文/评论/依赖快照及失败日志；原有 `runtime-patches.mjs` 的 Web 补丁和 `private-runtime.mjs` 的 patch 数量改动在主工作树保留。
- 正式构建的干净源码快照提交：`2372a935c4eccf64d53fafffa72b2aa965c65a22`，独立 `source-snapshot` 仓库；从当前工作树逐文件复制，包含已有改动。`source-files-final.json` 固定实际文件集合与摘要，`source-origin.json` 固定主仓基线。该提交是构建输入，不是假称主仓 HEAD 或远程提交。
- 官方 Pi `@earendil-works/pi-coding-agent@1.1.0`：7,520,009 字节；归档 SHA-256 `09cd8a0a43dbb1d81a67346b09400b439ce71d818caba4e963ea958846a1aed4`，SRI 见 `contracts/release/pi110/inputs.json`。上游 manifest 原字节恢复并校验 SHA-256 `c662a36f8bc47843393a60dc8616a34dfcc8376e8fcc96dbc2f1020c60e38e2a`。
- 官方 1.1.0 包不带 shrinkwrap；OMP 提供新增生产锁，六个直接 Pi 包及 telemetry 均固定 1.1.0。锁摘要 `32a518cda0ecc86c95607cd2d56abd86f17aef51b7576fc8ca5f04415068a74c`，输入合同 `sha256:13e384c15ebe3fadc7ef10c363fc2e38bfeed1b2072cbc00de8e2d24bb58ff22`。历史默认 0.84.3、私有 0.85.1、旧 SRI、external 合同和已有运行时均保留。
- 实机 macOS 27.0 / Darwin 27.0.0 / arm64；Pi 支持矩阵实际验证 Node 22.19.0 与 24.19.0。Node22 文件 SHA-256 `0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1`；候选 embedded Node24 `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`。完整私有栈的 OMP 引导沿用固定 embedded Node24 约束；Node22 通过同一 Pi 树的公开检查、SDK、CLI 与原生能力核验，不把外部 Node22 冒充 embedded Node24。

## 实际准备与材料

调用正式公开 `createReleasePayloadStager().plan/apply`，保留默认源码清洁检查、完整 `defaultPrepare` 和私有准备链；没有直接拼接一个能启动的旧目录。

第一次 `stage-formal.mjs` 真实从官方 Node/npm/GitHub 来源取得归档。声明验证完善后，`stage-formal-final.mjs` 对同批已取得的 277 个 URL/归档重新做 SHA-256/SRI 校验，复用输入字节；重新独立 npm ci、构建、打包、提取及组装，非 npm 工具继续由正式工具链入口取得。`formal-plan-2.json`、`formal-downloads-2.json`、`formal-commands-2.json`、`formal-stage-2.log` 与 `formal-result-2.json` 保存参数、来源、退出码及结果。全部第三方生命周期脚本禁用。

- 最终候选：`LOCAL_WORKSPACE/artifacts/pi110-n04-20261013/candidate-2/payloads/full`。目录名 `full` 是现有准备器布局，本票没有 Full 安装验收或发布结论；thin 布局也不构成 Thin 重建验收。
- Stack ID：`sha256:5f14601295303c687aa9f90a736dee3382e0e718937311777ced133d54d3a57c`；distribution ID：`sha256:810fea52ae7182ee63a2e17b1cca11f9f177f23a40a92b6cf528630f34d85aa5`；材料摘要：`sha256:df6c5b8af13d638dd7f0e268706e9c0857a79f8dff401a7e7b4aafa41e6b9737`。
- 276 个 npm 原始归档、280 个安装实例逐项核对文件集合、字节及执行位；唯一归一化是 npm 对声明 `bin` 的执行位补齐。保留 upstream artifact ledger 与 patch 后树两个身份。
- 新 Pi MCP/codemode 包、QuickJS-WASI 3.6.2、5 个原生 WASM 扩展、Photon 0.3.4 WASM、Pi TUI 平台 addon 共 13 项重点资源纳入冻结合同和实际材料。PDF parser 的 QuickJS 不参与本票。
- fd 10.5.0、ripgrep 15.2.0 的官方归档、二进制、许可文本和工具链身份在候选及 runtime SBOM 内。Node 也进入声明。
- 材料记录 38,956 项，其中 35,327 个普通文件、502,214,634 字节，以及 280 个声明/许可文件。MCP 第三方 `LICENSES`、tslib CopyrightNotice、ignore 的实际 LICENSE-MIT 保留；缺根许可包有精确版本与 immutable 官方来源绑定。
- 九个原受控扩展的真实版本、路径及加载结果在每个 Node receipt 中；sandbox-runtime 为实际 darwin 合同 0.0.26，未借用 Linux 0.0.76 补证。六个 Web/permission 补丁分别核对实际包版本、原文件 SHA-256、唯一锚点，记录原/补丁后摘要、pi110-v1、Pi 版本及目标平台。

## C 与 P

| 证据 | 结论 | 实际内容 |
| --- | --- | --- |
| C / 针对性回归 | PASS | `targeted-3.log`，22 PASS / 0 FAIL；新输入缺失/漂移下载前拒绝，未知版本及平台/目标包版本拒绝，归档字节及 bin 模式检查，历史合同回归 |
| C / 类型检查 | PASS | 四个 tsc 项；首次、第二轮已通过，最终四项已通过，日志 `typecheck-final.log` |
| C / 实际候选拒绝 | PASS | `rejections.json` / `rejections.log`，16/16，通过 loadDistribution / inspectResolvedStack 检查资源、声明、用途、版本、平台、字节、执行位及 checkout symlink 回退；只改变独立副本并恢复 |
| C / 全量 Node24 回归 | 待最终记录 | `full-node24.log`，本轮仅运行一次全量；未满足条件不能记 PASS |
| P / Node22 | PASS | `acceptance-node22/receipt.json`，8/8 |
| P / Node24 | PASS | `acceptance-node24/receipt.json`，8/8 |

每个 P receipt 固定实际二进制、Pi 树与平台。八项分别为公开材料/声明检查、真实 Pi --version 与工具 --version、公开 SDK 构造及九个扩展（12 个入口）加载、QuickJS 主 WASM 和五个 .so 的实际执行、codemode Worker 真实执行及一次受控工具调用、原生 MCP stdio initialize/list/call 与子进程关闭、目标 native addon / Photon 合成图片 / esbuild 实际执行、真实 CLI 内置 codemode 的两次 loopback 模型协议接收及 42 结果。隔离 HOME、config、cache、临时 cwd，所有加载路径在候选内；不访问用户凭据、全局配置或剪贴板数据。

## 失败与边界

- 最初安装入口不支持 1.1.0、官方无 shrinkwrap、npm override 解析失败，均保留 red/解析日志后按固定输入修正。
- 首轮归档比对拒绝 Pi-AI bin 模式：确认为 npm 声明 bin 的 +x；只加入这一精确归一化规则，未放宽字节检查。
- 初轮负例 fixture 使用 macOS /var symlink 路径，被 canonical 文件检查拒绝；测试改为真实路径。
- 首轮 CLI 探针未关闭 stdin，两个 Node 均在读取 stdin 时超时；保留失败 receipt。修正探针关闭 stdin，并显式启用 builtin:codemode，最终同候选双 Node 真实执行通过。
- B / I / L、Full 软件门禁、parser 来源/构建、#26/#27 整体验收、日常切换、真实 Provider、远程 CI、push 和发布：NOT_RUN。两次本地协议接收不代表任何真实 Provider 证据或费用。
- 缺声明、资源或不匹配的候选在公开加载边界拒绝；不回退 checkout、旧候选或全局目录。既有 runtime 校验保持旧版本语义；主工作区已有受控 Web 补丁继续保留。

## 两轴评审与收尾

Standards：待独立评审。Spec：待独立评审。以本轮起点 `96f16207257ec451c7f0c418de8135ecf7896899` 为固定 diff 基线；只提交本票增量及 pi110-v1 必需的已核对 Web 适配器原字节；该适配器在本轮起点已有，未改其内容。旧版本的 Web patch 开关、patch 数量及 web-policy/index.mjs 既有改动留在工作区，发布快照保留原字节。

#65 关闭：待必需证据及两轴评审完成。#75 原生依赖：待 #65 关闭后再次远程回读；不删除六条历史原生边，不实施 #75。
