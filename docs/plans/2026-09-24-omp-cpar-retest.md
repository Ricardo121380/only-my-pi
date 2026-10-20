# CPAR 修复后 OMP 真实验收复测

> 历史记录更新：9月25日生产reasoning覆盖已修复，OMP首轮与审批通过；新的阻断发生在含reasoning历史的第二轮入口解析。以下保留9月24日原始结果，当前状态见[9月25日多轮复测](2026-09-25-omp-cpar-continuation-retest.md)。

结论：**CPAR 修复二进制已在生产运行，但 Grok Build 生产候选仍显式关闭 reasoning，OMP 的 low 请求继续受阻。M2 保持 IN_PROGRESS。** 本轮真实重试返回 HTTP 400 `ClientRequestError`；未执行工具或修改项目文件。当前没有证据要求修改 OMP 请求或绕过思考强度设置。

## 真实复测与预算

- 时间：2026-09-24 00:41:51–00:42:17 Asia/Shanghai。
- OMP 产品候选：`9130d0259bb53a82f8af290c994dc31fbdd8e028`，Pi 0.85.1 / Node 24.19.0；安装包 Host、RPC、UI，Ego Lite TaskSpace 3。
- 用户选定的 `cpar-grok-build/grok-4.5`，`openai-responses`，low；临时 GUI 账号通过公开认证入口存储现有 Key，临时项目只含合成验收内容。
- 重做原小型修改任务，关闭 SDK 自动重试与自动压缩。返回 `400 ClientRequestError: the client request is invalid`；审批 0，工具 0，`proof.txt` 保持 `before\n`，全零 usage 仍为未知，不能据此判断账单。
- 累计小任务 **1/3**，失败重试 **1/1**。保留的两个新任务分别用于受管写入和撤权/取消，不拿它们冒充同一失败任务的额外重试。本轮没有换账号、Provider 或降低思考强度绕过门禁。
- 原始证据（相对于仓库外 `../artifacts/webui-phase2/live-cpar-sep24/`）：`report.json`、`retry-result.json`、已查看的 `failed-retry.png`。脚本 `../live-cpar-retest-sep24.mjs` 创建证据目录时拒绝覆盖，继承上轮额度并记录本轮 failed-retry。

## 根因证据

| 核验 | 结果 | 依据 |
| --- | --- | --- |
| 生产实际二进制 | 与部署的 `3a8e5af` 相符 | 只读读取运行中 `/proc/<pid>/exe`，SHA-256 `6f4eb0924987734b4ca56178fe3fde213cbd1e51a7d40dacb7053f869348b94a`；对照 CPAR `docs/reports/prism-grok-production-20260924.md` |
| 生产错误 | 400 与服务端记录对应 | 时间窗口 16:41:40–16:42:20 UTC；request ID `p1-request-b7cbcd85557db2be1bedd2854cc9b381-0`，`ClientRequestError` |
| 当前活动路由 | 明确禁用 reasoning | Config `production-aligned-20260915` revision 12；candidate `p12-12-production-grok-build-candidate`，Grok Build / grok-4.5 / canonical_bridge；override 为 `{"allow_unlisted_model":true,"reasoning":false}`。仅查询配置元数据，无凭据表读取 |
| OMP 发出的请求形状 | low + summary/include + cache key | 同一安装候选、假 Key、仅 localhost 端点捕获一次请求；包含 `reasoning:{effort:"low",summary:"auto"}`、`include:["reasoning.encrypted_content"]`、`prompt_cache_key` 和六个当前准入工具；不是生产原始请求抓包 |
| 修复代码的离线回放 | Canonical 与 CanonicalBridge 均 PASS | 捕获的完整合成请求通过 CPAR 当前源码解析、投影、Grok Build 编码与解码；除服务端派生 cache identity 外语义相等，无网络 |
| 生产能力限制的反例 | `ReasoningUnsupported` | 同一请求移除目标 Reasoning 能力后，离线投影确定性拒绝；保留 Reasoning 时通过 |

证据：`production-readback.json`、`offline-request-summary.json`、`offline-request.json`、`offline-replay.log`；离线 Rust 复现入口与 Cargo.lock 在 `offline-replay/`，使用本地 CPAR 路径依赖，以 `cargo run --offline` 运行，无真实 Provider 请求。CPAR 相关源文件在核验时无未提交修改。

代码链路（CPAR 仓库）：

1. `apps/gateway/src/runtime.rs:613` 的 Grok Build 适配器具备 Reasoning 能力。
2. `crates/gateway-control/src/route_compiler.rs:1432` 把 override 中的 false 归入 removed；`:893` 从候选有效能力中移除它。
3. `crates/gateway-router/src/protocol_transform.rs:998` 检测请求含 thinking、候选缺 Reasoning 时返回 `ReasoningUnsupported`。
4. `apps/gateway/src/runtime.rs:1853` 在选择凭据前进行协议投影；`:1930` 将全部候选的投影拒绝映射为 `ClientRequestError`。

**置信度高、边界明确：** 生产配置与相同请求的离线反例共同证明一个确定的阻断条件。生产当时未启用该 debug target，日志没有直接保留 `ReasoningUnsupported` 枚举；不能声称已读取到该条生产拒绝理由，也不能承诺解除此条件后上游一定成功。旧 503 可被协议拒绝误分类，新 400 不能单独证明凭据已经可用。

## 建议的生产变更与验收边界

建议 CPAR 通过正常配置草稿、验证和激活流程处理该 Grok Build candidate，恢复 Responses 所需的 Reasoning 能力。可审查的最小候选差异为：

```diff
- {"allow_unlisted_model":true,"reasoning":false}
+ {"allow_unlisted_model":true}
```

这会继承 Build 适配器能力。不要直接修改 SQLite，不扩大到 Console/Kiro 或其他路由。激活前保留当前配置版本及回滚指针，并确认同一候选的 Chat Completions 消费者：`protocol_transform.rs:287` 明确拒绝 Chat → 可返回 Reasoning 的目标，因此简单删除 false 可能改变其兼容性；如需同时保留 Chat，应先设计独立的 Responses 服务范围和路由准入，不能假定加一个候选即可满足客户端选择。

建议执行顺序：

1. CPAR 配置负责人核实 Chat 使用范围，准备仅影响目标候选的配置草稿，完成编译/Route Explain 和回滚预检。
2. 获生产配置变更授权后激活，复核实际有效能力；本轮仅只读诊断，未修改生产。
3. 额外授权 **1 次**原小型任务重试，仍为 CPAR Grok / grok-4.5 / low，关闭自动重试、失败即停；当前失败重试额度已经用完，不能自动续额。
4. 该重试通过后，用原剩余 2 个小任务完成受管写入与撤权/取消矩阵，再结合 F01 绘制门禁判断 M2；不得只凭路由恢复就晋升日常安装。

## 收尾

测试 Host 已停止；临时凭据副本与配对清单已删除。凭据值只在本机用于匹配扫描，未输出：扫描无泄漏，原 CLI models.json 内容摘要一致，见 `cleanup.json`。合成项目、脱敏证据和截图保留。本轮未改 OMP 产品源码、CPAR 源码/生产配置、日常安装、Pi 版本或全局设置。
