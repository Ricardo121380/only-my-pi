# CPAR Agent 修复后的 OMP 实测：入口通过，上游尝试仍失败

> 历史记录：以下为9月25日21时结果。9月26日最新复测已完成小型修改真实4轮成功，原续接阻断已解除；writer与取消的结果及新限制见[最新验收](2026-09-26-omp-cpar-real-acceptance.md)。下方原预算和失败证据保持当时口径。

结论：**CPAR 新修复已部署，原 reasoning 历史入口拒绝已解除；真实 OMP 任务仍在批准后的第二轮返回 HTTP 502 / ProviderPermanent，尚未完成文件写入。M2 继续 IN_PROGRESS。** 当前证据定位到 Provider 尝试阶段；上游具体状态码、错误字段尚未获得，不能推断为某个确定的字段缺陷、配额问题或 OMP 界面故障。

## 版本、范围与预算

- 用户再次告知“CPAR修复了，你继续看看呢”，本次按新部署后一次有界重试执行，追加失败重试额度1；继承此前任务1/3、重试2/2，不重置累计额度。失败即停，最终任务 **1/3、失败重试3/3**（原1＋两次明确修复后复测各1）。受管writer、撤权/取消两个新任务仍未使用。
- CPAR 部署源提交 `f4ebf4d75c111f8e0fa8e4f9d342a01bfb8da723`，生产运行二进制 SHA256 为 `653659534f7f83d7e2ab54e8834c90e07eef55a9158ba17f11d42b47653a867c`，本轮已从运行进程只读核对。修复后的本地 HEAD `f5a4172715a37c2510a102f6ded4f88682bcbd52` 仅比部署版本增加文档；本轮核对 `git diff f4ebf4d -- crates` 无差异。
- 活动配置 `production-grok-reasoning-20260925` revision1；目标 Build 候选 `p12-12-production-grok-build-candidate`，override 仅含 `allow_unlisted_model:true`。没有读取凭据表、修改生产配置或重新部署。
- OMP 产品候选仍为 `9130d0259bb53a82f8af290c994dc31fbdd8e028`，安装栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`，Pi 0.85.1、Node 24.19.0。
- Ego Lite 原任务空间3/p1；安装 Host/UI/worker、临时 GUI 账号和合成项目。固定 `cpar-grok-build/grok-4.5`、low、输出上限2048，关闭自动重试与自动压缩。未换 Provider、账号或降低思考强度。

## 实测链路与结果

任务 `bb8dbe90-3f2b-49de-8edc-e84913510b84`，2026-09-25 21:06:56–21:07:26 Asia/Shanghai。要求先审批，仅写 `proof.txt` 为 `SIMPLE_OK` 加换行，再 read 核对；simple、无bash、无委派、无其他文件修改。

| 检查点 | 结果 | 证据与限制 |
| --- | --- | --- |
| 修复部署身份 | PASS | 运行进程二进制摘要与CPAR部署记录一致 |
| 首轮模型与审批 | PASS，定向 | 返回request_coding_access；页面批准scope=proof.txt，工具结果isError=false |
| reasoning历史续接入口 | PASS，定向 | 第二轮有CPAR request与attempt事件；同历史离线解析/投影/Build往返通过 |
| 第二轮真实上游尝试 | FAIL | HTTP502，ProviderPermanent，scope=provider，retry_decision=non_retryable |
| 文件写入和回读 | NOT_RUN | write/read未发生，proof.txt精确保持before加换行 |
| 用量显示 | PASS，部分回执 | 2模型回合、1工具，仅首轮1份非零回执；总3369token，费用未知 |
| 受管writer、撤权/取消 | NOT_RUN | 依失败即停规则保留原2个新任务 |

首轮 Pi 用量：输入3084、输出157、cacheRead128、总3369；CPAR日志 input_tokens3212（包含缓存128）、output_tokens157、reasoning_tokens72、cached_tokens128。两端输入口径不同，不能把3084与3212称为不一致，也不能将reasoning72再次加到总数。费用未知；失败第二轮未提供有效用量，不将首轮回执视为完整账单。

## 定位依据与置信度

生产只读日志已保存到 `production-readback.json`：

| 模型轮次 | request_id | 日志结果 |
| --- | --- | --- |
| 首轮 | `p1-request-dfc70894ca60504883adeea4d1729128-0` | 13:06:57.957Z request；attempt succeeded；usage；request_finished |
| 批准后续接 | `p1-request-dfc70894ca60504883adeea4d1729128-1` | 13:07:25.547Z request；13:07:25.917Z attempt failed / ProviderPermanent / provider / non_retryable；request_finished同错误 |

**已证实：** 旧的入口400不再是本次阻断；失败已进入Provider尝试，没有自动重试。SDK历史离线重建的input依次为developer、user、reasoning、function_call、function_call_output。reasoning有id/status/content（reasoning_text），本次没有encrypted_content。离线重建使用onPayload主动中止、拒绝fetch，网络调用数0；不冒充生产网络抓包。

本轮 Rust 回放使用与部署版本相同的 crates 源码，对完整重建请求和全合成最小样本分别验证：入口解析 → CanonicalBridge投影 → Grok Build编码 → 重新解码语义一致，且reasoning原始JSON保持。两组均PASS。去掉reasoning的诊断副本也PASS，但该对照**没有发往真实上游**，没有据此在产品中删历史。

CPAR源码定位（相对CPAR仓库，提交f4ebf4d）：

- `crates/provider-grok/src/build_responses.rs:471` 的 `encode_input` 保留Reasoning和工具历史；不是本轮入口拒绝。
- `crates/provider-grok/src/inference.rs:379` 在 transport 返回非2xx后解析受限错误体并执行分类；`runtime_state.rs:831` 的 `classify_grok_build_failure` 将若干未细分HTTP状态映射到ProviderPermanent。另有 `build_responses.rs:1521` 的response.failed路径也产生该通用错误。
- `crates/gateway-observability/src/telemetry.rs:83` 的 `TelemetryAttributes` 有稳定错误分类、重试决策和用量，但没有上游HTTP状态或经脱敏的错误字段。因此**不能从客户端502推断上游就是502或400**，更不能仅凭通用分类确定某个请求字段不兼容。

CPAR的一手修复与本地模拟矩阵见其 `docs/reports/cpar-agent-compatibility-20260925.md`、`docs/reports/cpar-agent-production-20260925.md`。模拟上游通过说明本地合同满足夹具；本次真实上游失败说明它尚不能替代OMP联调验收。

## 下一步：优先补齐真实上游的安全诊断

1. 以第二轮request_id定位同一Provider attempt，保留上游HTTP状态、稳定error.type/code、经过允许名单处理的param/字段路径和关联ID；不记录Authorization、原始reasoning、完整请求/响应正文或任意上游message。若现有日志没有这些信息，先在CPAR加有界、脱敏的诊断，不继续重复相同真实任务。
2. 使用本轮可分享的 `continuation-minimal.json` 建立与真实拒绝原因对应的本地反例；结合Grok Build实际接受的输入合同，核对reasoning、function_call及function_call_output的标识和顺序。未获得具体错误前，这些只是检查方向，不是已证实根因。
3. 针对证实的差异修复后，先让本地两轮/三轮工具往返和负例通过；再在新增有界重试授权内重做同一OMP原任务，验收必须包含GUI批准→write→read→成功终态和真实用量。不得用剩余新任务额度代替原失败任务的额外重试。
4. 原任务成功后，再用原剩余2个新任务验证受管writer与撤权/取消。F01普通前台输入绘制和最终安装晋升仍是独立门禁；本次没有测量或放行。

## 证据与收尾

仓库外目录：`../artifacts/webui-phase2/live-cpar-agent-sep25/`。

- `report.json`、`session-summary.json`：累计预算、任务状态、工具结果、错误与用量。
- `production-readback.json`：运行二进制摘要和两轮脱敏日志。
- `post-approval-failed.png`：Ego实际失败页面截图，已查看。
- `continuation-shape.json`、`continuation-minimal.json`：可分享结构和全合成请求；`continuation-request-private.json`仅本机诊断，含验收历史，不作为对外示例。
- `offline-replay/`、`offline-replay.log`、`offline-minimal.log`：无网络回放源码、Cargo.lock和两组结果。
- `cleanup.json`：Host及测试进程已退出，临时凭据与配对清单删除；扫描52文件，选定Key泄漏0；原CLI配置摘要一致；proof.txt保持before。

本轮只更新OMP计划、看板和验收文档，诊断夹具位于仓库外；未修改双方产品源码、CPAR生产、用户日常安装或全局配置。用户已有Glacier审计文档改动保留。Ego提示当前0.5.1.11有更新，未执行升级；更新提示不代表输入绘制问题已解决。
