# M2 受管 writer 完整终态验收

日期：2026-09-26 10:28:57–10:31:59，Asia/Shanghai。

结论：**受管 writer 的真实执行、Host 成功终态、页面完成状态及进程/锁释放均 PASS。** 本轮关闭此前缺失的 writer 终态门禁；旧脚本崩溃记录仍保留，不被本次成功覆盖。M2 最终状态另由日常安装与阶段汇总决定。

## 版本与有界授权

- 产品候选仍为 `9130d0259bb53a82f8af290c994dc31fbdd8e028`，安装栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`，Pi 0.85.1 / Node 24.19.0。启动前重新验证安装内容及精确身份。
- 上轮已提出追加一次 writer 终态复测，用户本轮要求“开始开发下一步吧”；执行前明确该回复用于一次有界复测。阶段累计任务仍 **3/3**，失败重试由 **5/5 → 6/6**，没有重置旧账本，也没有额外取消任务。
- 始终使用既有 `cpar-grok-build/grok-4.5`，low，单轮输出上限 2048，关闭自动重试与自动压缩；最多 5 个主 Agent 回复、300 秒任务期限。只使用临时 GUI 账号与合成 Git 项目，没有发出用户业务代码。
- 实际委派一个 managed writer 和一个 fresh reviewer。主 Agent 仅调用 `request_coding_access`、`delegate_managed_writer`，没有直接 write/edit/bash。
- 本次不重新断言 CPAR 生产部署身份；所选路由实际完成任务是互操作依据，历史部署核验见[前一轮报告](2026-09-26-omp-cpar-real-acceptance.md)。

## 执行结果

任务 ID：`caf113b7-4f29-4916-8c5a-a1ece5870cdf`；会话 ID：`01a0db8b-5879-7300-bb64-4da09ee84426`。Ego Lite 空间 5 / p1 完成提交、三次审批及页面终态检查。

| 验收项 | 结果 | 证据与边界 |
| --- | --- | --- |
| 原始提示和提交绑定 | PASS | 从原始会话恢复完整 818 字提示；输入框、提交载荷、Host 全量任务一致；SHA256 `d8752775445156015c8a73eb265591052aede7c328a1a2c7d5422fdfaffe6547`。公开任务摘要仍为 200 字，不用摘要重建提示 |
| 账号、模型、强度 | PASS | 服务端拦截器在消耗额度前校验账号/项目/model/controlled/low/完整提示；Pi 回读强度为 low |
| 编程审批 | PASS | complex、scope 仅 `proof.txt`，managed writer + fresh reviewer，无只读 scouts；完整计划核对后通过页面批准 |
| 克隆验证 | PASS | runtime verification receipt，gate `proof`，exit 0，34 ms；与补丁摘要绑定 |
| 独立审查 | PASS，已声明检查范围 | reviewer verdict=pass、findings=[]；检查文件与 gate，明确未自行重跑 gate、未独立证明写入发生路径。执行路径依据 runtime 工具及 writer 收据 |
| 应用和真实工作区验证 | PASS | `WRITER_PATCH_VERIFIED`；real-workspace receipt，exit 0，36 ms，与同一补丁摘要绑定 |
| 实际文件 | PASS | 仅 `proof.txt` 改动；内容精确为 `MANAGED_OK\n`，11 字节；Git diff 与 scope 一致 |
| Host / 页面终态 | PASS | Host `succeeded`、error=null、tool=null、审批清空、access=inspect；页面显示“已完成”和“不保留编程授权”，截图已查看 |
| worker 和所有权 | PASS | worker 13960 及进程组退出；Host 活动 worker=0；项目锁、会话锁均重新取得后正常释放 |
| 取消保护离线预检 | 4 PASS | 同安装 Host 回放正常第 5 轮 stop、toolUse 边界取消一次，以及重入/异常处理；本次真实任务 3 轮结束，没有触及上限 |

补丁摘要：`sha256:be049456d1a302951e8ebbe2bcd7db8a66ad725b9767a331c32497c777bb41f8`。

两次页面等待使用了不匹配的文案，等待超时后以实际快照继续；没有因此重发任务、重试模型或换路由。这是自动化等待条件的问题，不是应用或 Provider 失败。

## 用量、资源和清理

- 主 Agent：3 轮回复、2 次工具、3 份有效用量回执；input 9,880、output 462、cacheRead 3,328，总 **13,670 token**。页面显示值与 Host 回执一致，费用未知。
- 子代理预算累计 **21,883 token**，口径为 `process-child-delegations`、不含主 Agent；不是两个子代理最终回复 token 字段的简单求和。不得把目录成本 0 当作实际免费，也不把主 Agent 用量冒充整次任务账单。
- Host + worker 的两秒采样 RSS 峰值 **482.44 MiB**；不含浏览器，不是跨设备上限或泄漏结论。
- Host 13701 与 worker 均已停止；空间 5 已正常 finish。临时模型凭据副本、GUI 账号私有目录和配对清单删除；扫描 95 个文件，所选 Key 残留为 0。
- 原 CLI `models.json` 前后摘要一致。保留合成项目、完整收据和历史失败证据；没有删除旧异常夹具的孤儿锁。

## 证据位置与后续

本机证据根：工作区下 `artifacts/webui-phase2/live-cpar-writer-terminal-sep26/`（仓库外）。

- `acceptance-summary.json`：断言结果、任务身份、累计预算、关键文件 SHA256。
- `prompt.txt`、`submitted-command.json`、`executed-fixture.mjs`：完整输入与实际执行脚本。
- `worker-events.jsonl`、`writer-receipt.json`：真实事件和双 gate、独立 reviewer 收据。
- `terminal-verification.json`、`terminal-page.txt`、`writer-succeeded.png`：Host、文件、锁及页面终态。
- `report.json`、`cleanup.json`、`ego-finished.json`：用量、资源和清理结果。
- 上一级 `writer-terminal-preflight-sep26.log`：4 项离线检查；`promotion-preflight-sep26.json`：日常安装只读预检。

writer 终态不再阻断日常晋升。日常预检时旧 active 为 `0b9e9e1c…ffe8847` / 源码 `b5d4674`，Host 未运行、Pi 活动进程 0、约 15.4 GiB 可用；实际升级结果须另记，预检不能代替安装通过。原撤权/取消证据仍限定在模型续接期间，不能由本轮 writer 成功扩展为运行中 shell 取消验收；真实 OAuth 仍未执行。
