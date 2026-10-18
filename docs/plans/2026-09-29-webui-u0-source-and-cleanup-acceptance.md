# U0-04 F02：固定来源材料与进程回收补强

日期：2026-09-29。**本批回收回归 PASS、PDF 158 个待审资产的固定源字节对应 PASS；完整来源/许可闭包仍 PARTIAL，G0-03 保留 FAIL。U0 仍 5/6，总计 13/44。** 不进入 U1/Electron，不接默认发行链或切日常安装。

后续追加：[native材料与历史输入可得性验收](2026-09-29-webui-u0-native-materials-acceptance.md)新增25个固定源pin/47份原文及四份503/日志403证据；本页历史采集计数与回收结果保持原范围，不用后续材料覆写。

## 1. 本批交付及边界

依据[Full 接入清单](2026-09-29-webui-u0-parser-full-integration.md)继续 F02，并处理[上批验收](2026-09-29-webui-u0-acquisition-acceptance.md)新增的进程组风险。主代理实施及最终验证；四个单轮只读探子分别定位 PDF/native 来源、核验回收和来源声明，使用 `fork_turns="none"`、默认角色，等待终态后收敛，未追派、未让探子修改代码。

| 交付 | 实际内容 |
| --- | --- |
| [回收 runner](../evidence/2026-10-18-local-development-history.md#local-82c208797aa2bda4) | 单调时钟计时；有界 `EPERM` 复查；最多 128 条探测详情及丢弃计数；成功 leader 的探测异常进入统一失败/清理路径 |
| [资源回归](../evidence/2026-10-18-local-development-history.md#local-58fbac31c7565b70) | 原回收断言不放宽，失败打印完整 detail；新增 6 项涵盖时钟前跳、暂时/持续未知、发信号前未知、成功探测异常、spawn 失败；共 19 项 |
| [固定源绑定 helper](../evidence/2026-10-18-local-development-history.md#local-f3bf483bcf6bb664)及[8 项回归](../evidence/2026-10-18-local-development-history.md#local-4632dfec7350dd4f) | 同时核对 F01 SHA-256/长度与固定源 Git blob/长度；锁定两个 QuickJS 路径和 78 组普通/legacy 图标；未知组/状态/漂移拒绝，不推定许可 |
| [有界材料探针](../evidence/2026-10-18-local-development-history.md#local-8c8e2dd0c38139ba) | 固定 tag/commit/原文摘要、保存许可/初始 lock/候选 patch；24 请求、总响应 4 MiB、每次 20 秒、无重定向/重试，不执行下载代码 |
| [来源审阅快照](../evidence/2026-10-18-local-development-history.md#local-159d46e4e64e3e95) | 独立绑定原 F01 合同、资产配方、实际报告及执行代码摘要；F01 历史字段和此前失败报告不改写 |

最终材料报告：source-materials.json（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/source-materials-MrVmws/source-materials.json`）。5 条检查通过，总状态 PARTIAL；17 次公开 GET 均 200，响应合计 **534,251 字节**。首轮 16 GET/393,022 字节的报告（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/source-materials-U4tyV6/source-materials.json`）保留；复核后补固定 gulpfile blob/复制入口断言、输入根路径和准确状态声明再执行最终轮。

没有读取私人材料/凭据、安装依赖、应用上游 patch、运行 native 构建、调用收费 Provider、改全局配置、提交/推送或删除旧证据。探针证明所监测的 release 文件与日常指针前后相同，**不是根已安装依赖全树测量**；默认 stager 的启用状态在本探针中为 `UNVERIFIED`，不从“未变化”推断“本来未启用”。项目默认接线仍沿用 F04 未实施的既有核验，不由这个探针晋升。

## 2. 回收失败：已修什么，未证明什么

### 实际观察与原因边界

1. 上轮 Node24 的 30/31 失败回执没有原 PGID/完整 detail，保留原始失败（仓库外证据：`../../../artifacts/webui-optimization/U0/parser-acquisition-pX63wg/unit-matrix-before-correction.json`）。原测试有 leaf-ready IPC 同步，不能无证据归因为启动竞态。
2. 本轮新增墙钟前跳负例，补丁前实际失败，捕获 `cleanupError=EPERM`、`processGroupExited=false`、组 97175/leaf 97176；底层 syscall 没有注入 EPERM。red 回执（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/clock-red-node24.json`）保存 detail。稍后的只读 `ps` 已找不到两个 PID；这支持短暂退出态的可能性，**不证明当时已退出或确定内核原因**。时钟是受控注入，不是声称机器实际发生时间校正。
3. 原 runner 使用 `Date.now()` 计算等待 deadline，前跳可能缩短等待；任何探测 EPERM 都立即抛出，未利用已有等待窗口继续确认。Node 的 [performance.now 文档](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performancenow)与[高精度时间规范](https://www.w3.org/TR/hr-time-3/)支持用单调时间测量时长；所读 Node 文档当时为 24.21.0，实际运行是 22.19.0/24.19.0，不混淆版本。
4. Apple 公开 [XNU killpg1 实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1606)在组不存在时返回 ESRCH，同时有 zombie 过滤及无可发信号成员时的 POSIX EPERM 分支。这是**可能机制的源码依据**，未绑定当前 macOS 27.0/26A428 的精确 kernel 源码，也不是原 30/31 的已证实归因。该 API 的固定 main commit 获取经网页工具失败，未将失败响应当来源。

### 补丁及不变量

- 只管理本次新建 detached 组，不扫描或接管旧任务/用户服务；spawn 失败没有已创建 PID，不发清理信号。
- 对已创建组，只有 syscall 的 ESRCH 确认消失；EPERM 记录 `alive:null`，在**原有**等待窗口复查，不当作退出或清理成功。
- 发 TERM/KILL 前的探测未知仍立即失败，不凭未知状态盲发信号；持续 post-kill EPERM 在原 2 秒窗口结束后仍为 `processGroupExited:false`。
- 保持 TERM 宽限参数、KILL 2 秒和成功 leader 1 秒观察窗口；不增加重试、延长上限或放宽旧回收断言。
- 成功 leader 等待出现非 EPERM 异常时保留 `leaderProbeError`，随后安全核对/清理本次拥有组，仍拒绝任务结果；不因最终组消失掩盖探测异常。

暂时/持续 EPERM、发信号前 EPERM 和 EIO 回归是**明确标注的合成 syscall 观察**，信号仍仅送往真实新建夹具组；不能冒称持续真实权限拒绝也能自动回收。发信号前拒绝后的夹具由原 syscall 独立核对再清理，不在 runner 中添加绕过。

补丁前无时钟/syscall 注入的9 例诊断摘要（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/group-before-fix-node24.json`）全部回收；补丁后 Node24（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/group-after-fix-node24.json`）、Node22（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/group-after-fix-node22.json`）各 9/9 回收，均保存实际组探测详情及按该新 PGID 过滤的 `ps` 空结果，本轮没有自然 EPERM。诊断仍 PARTIAL，只关闭已可复现代码缺陷及当前回归，不伪造原失败归因。两次 shell 引号错误发生在 JS 启动前，留在调用失败记录（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/group-diagnostic-invocation-failures.json`），不是进程回收失败；修正引号后才运行上述诊断。

## 3. PDF 固定源字节对应：158/158

`pdfjs-dist@6.3.289` 的[官方 npm metadata](https://registry.npmjs.org/pdfjs-dist/6.3.289)与 [v6.3.289 tag](https://github.com/mozilla/pdf.js/tree/v6.3.289)都绑定 `1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56`；npm URL/SRI 必须与 F01 一致。

| 范围 | 本轮结果 | 尚未闭合 |
| --- | --- | --- |
| QuickJS JS/WASM 2 个文件 | 实际 SHA-256/长度与 [固定 external/quickjs](https://github.com/mozilla/pdf.js/tree/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/quickjs) Git blob 逐条一致 | QuickJS 精确源提交、依赖/编译器/构建输入及完整 notices；固定预编译文件不等于重建源码闭包 |
| 其他图标 156 个 | 固定 [web/images](https://github.com/mozilla/pdf.js/tree/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/web/images) 78 个源文件，逐个对应普通/legacy 两份实际字节 | 逐资产来源/权限完整审阅；不据包 Apache 主许可自动填满 |
| README 与复制入口 | README 固定 blob；gulpfile API blob/raw bytes/实际复制入口断言均通过 | 复制逻辑只证明预编译资源从哪里进入包，不证明全部编译来源或授权 |

158 个安装路径对应 **80 个源路径/80 个 Git blob**。逐条 SHA-256、长度、源路径/blob/链接保存在报告；[固定 QuickJS README](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/quickjs/README.md#L9)明确说明生成 JS 为 MIT，但没有直接点名 WASM。保留此强度差异，不把该句升级为逐文件 WASM 授权；[gulpfile 复制分支](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/gulpfile.mjs#L737)未随 QuickJS 分支选取专用 LICENSE。

此前“196 文本/头部映射＋158 未解决许可组”不改写为全部已许可；新层只把这 158 项的**固定源字节定位**关闭。354 项中字体、其他 WASM、打包代码来源与分发义务仍按 F02 保留，不能把 source 定位 PASS 混成法律合规 PASS。

## 4. native 材料：新增原文，不冒充历史输入

本轮保存并逐条核对固定 Git blob/SHA-256 的 **5 份许可全文＋1 份初始 lock**：

| 组件/版本/固定提交 | 保存内容 | 实测字节 |
| --- | --- | ---: |
| libvips 8.18.7 / `24ad4d042940e6bf99a68871ba886ca8847c9c82` | [LICENSE](https://github.com/libvips/libvips/blob/24ad4d042940e6bf99a68871ba886ca8847c9c82/LICENSE) | 26,530 |
| librsvg 2.63.2 / `073326620abe168bb8be07d9c52595a5d19d1ecb` | [COPYING.LIB](https://github.com/GNOME/librsvg/blob/073326620abe168bb8be07d9c52595a5d19d1ecb/COPYING.LIB)；[初始 Cargo.lock](https://github.com/GNOME/librsvg/blob/073326620abe168bb8be07d9c52595a5d19d1ecb/Cargo.lock) | 26,530＋86,466 |
| libultrahdr 2.0.2 / `e5f5a022fe96fc4dc2ee35c19f733a50df807abe` | [LICENSE](https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/LICENSE)、[MIT](https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/LICENSE-MIT)、[Apache](https://github.com/google/libultrahdr/blob/e5f5a022fe96fc4dc2ee35c19f733a50df807abe/LICENSE-APACHE) | 12,566＋1,088＋11,358 |

实际 F01 `versions.json` 的 vips/rsvg/uhdr 与这三个版本一致；源 tag/commit 定位来自本轮限定官方检索，当前探针验证固定原文 blob，不声称三库的全部版权义务已完成。libultrahdr 另有许可目录尚未展开；29 库整体、Rust 传递组件和完整对应源码仍缺。

[构建脚本](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh#L343)修改 Cargo manifests 后运行 `cargo update --workspace`，因此保留初始 lock **不等于**取得该 run 的最终 lock。

PR383 metadata/两提交序列重新取得并断言，保留[第一个提交 patch](https://github.com/google/libultrahdr/commit/e2daed8da97d8857dcec2fd68d2f6f3326170f67.patch)和[第二个提交 patch](https://github.com/google/libultrahdr/commit/7af35883ee575266cc43bbd05686734ebd5b1a82.patch)原文/摘要及 `From` 提交头。它们是**可固定的候选变更**，没有应用 patch、没有证明其字节等于构建时浮动 PR URL 的响应。`historicalPatchBytes=UNVERIFIED`、`finalBuildLock=NOT_OBTAINED`、`sourceBuildCorrespondence=UNVERIFIED` 均保留。

## 5. 最终验证与下一项

| 检查 | Node22.19.0 | Node24.19.0 | 限制 |
| --- | --- | --- | --- |
| 获取 9＋原 acquisition 5＋资源 19＋来源 8＋pack 4 | 45/45 PASS | 45/45 PASS | 显式 `--test-concurrency=1`；不是全项目或注入后 Full 门禁 |
| 无 syscall/时钟注入的新组负例 | 9/9 已退出 | 9/9 已退出 | 新组/PGID 实测，不能恢复原失败详情 |
| 材料与实际资源只读复验 | 17 份/158 资产 PASS | 17 份/158 资产 PASS | 8 份预期 blob 验证；fetch 调用 0，不冒称 OS 断网安装 |
| 最终语法/本地引用/快照摘要/监测基线 | PASS | PASS | 静态记录（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/static-final.json`）列出实际范围 |

证据：最终完整 stdout 矩阵（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/unit-matrix-final.json`）、只读复验（仓库外证据：`../../../artifacts/webui-optimization/U0/closure-0929-CmkyrQ/source-revalidation.json`）。时钟前跳后的 TERM→KILL 实测宽限为 Node22 **132.134 ms**、Node24 **131.165 ms**，配置 120 ms，非虚构或放宽阈值。首轮 40/40、补强过程及旧失败都保留。

下一项仍是 **F02**：按精确版本继续剩余 native 许可/版权与源码，补 QuickJS/font/WASM 构建对应和最终 Rust lock/历史 patch 可得性；无法恢复时形成可核验重建的成本与边界，不猜填历史输入、不静默换库。原回收一次失败归因仍 `OPEN_UNATTRIBUTED`；可复现缺陷已修、回归及新组诊断通过，后续新失败须靠 PGID/阶段/errno/单调时间 trace 定位，不仅复跑。随后才 F04 ledger/双 SBOM/notices/最终内容接线，F05 隔离 Full/断网安装和 F06 剩余批次/PDF 门禁。

本次没有前端代码改动，因此不调用设计/浏览器或真实 Provider；这些验收层为 NOT_RUN，不能用源 pack 或后端通过替代。用户 Glacier 审计原有 +8/-0 与日常指针保留，U0 总门禁没有晋升。
