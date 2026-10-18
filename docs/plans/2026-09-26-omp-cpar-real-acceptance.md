# CPAR 修复后的 OMP 真实任务验收

日期：2026-09-25 23:43 至 2026-09-26 00:10，Asia/Shanghai。

> 后续更新：同日输入门槛通过，且[writer终态复测](2026-09-26-omp-writer-terminal-acceptance.md)完成新一轮真实PASS；累计重试更新为6/6，日常安装及[M2完成验收](2026-09-26-omp-webui-phase2-closeout.md)已通过。本文以下保留00:10时点的真实任务、预算与故障口径，不覆盖历史证据。

结论：**CPAR 多轮协议阻断已在 OMP 小型修改的完整成功链路中解除。受管 writer 完成了克隆写入、独立评审、补丁应用和真实工作区校验；验收脚本在最终回复时递归取消并崩溃，故 writer 的 Host/页面成功终态仍未验收。撤权与取消在模型续接期间通过，没有覆盖运行中的 shell。M2 保持 IN_PROGRESS。**

本轮没有修改 OMP 或 CPAR 产品代码。验收脚本的问题已离线修复并回放验证；真实失败记录保留，不据离线结果改写为真实 PASS。

## 版本、环境与授权

- OMP 产品候选：`9130d0259bb53a82f8af290c994dc31fbdd8e028`；安装栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`；Pi 0.85.1、Node 24.19.0。Host、WebUI 和真实 RPC worker 来自隔离安装包。
- CPAR 生产源提交：`4d5ce334f595aae76d8e9230c11df57642210c3d`；运行二进制 SHA256：`45786a8649720cd513eee09ae86fcab7a0ac2eadd0a2e836446a925562e6f055`，本轮只读核对。实现提交为 `799723e`，修正 native Grok reasoning 回放缺少 `summary` 数组的兼容缺口。
- CPAR 的一手修复记录：其仓库 `docs/reports/cpar-grok-native-continuation-20260925.md`。记录中的两个合成直连探针是 CPAR 另行授权的诊断，不能作为 OMP 页面验收，也不并入本阶段 OMP 任务账本。
- 路由始终为用户选定的 `cpar-grok-build/grok-4.5`，low，单次输出上限 2048，自动重试与自动压缩关闭。只使用临时 GUI 账号及合成项目。
- 原 Ego Lite 任务空间 3 已不存在；用户明确允许新建后使用任务空间 2/p1。最终检查完成后已关闭此专用空间，未操作用户其他空间。
- 用户告知 CPAR 再次修复后，原小型修改获得一次有界重试。随后 writer 首次出现 Connection error，用户另行回答“追加一次并继续”，批准一次 writer 重试及原计划的取消任务。最终阶段累计 **任务 3/3、失败重试 5/5**：原重试 1 次，三次修复后的追加复测，及本次明确追加的 writer 重试。脚本重启未重置额度，没有剩余真实调用额度。

## 验收矩阵

| 场景 | 结果 | 关键依据 | 限制 |
| --- | --- | --- | --- |
| 小型修改：批准 → write → read → 成功 | **PASS，真实安装态** | 4 轮模型回复、3 次工具调用；Host `succeeded`；`proof.txt` 精确为 `SIMPLE_OK\n`；CPAR 4 个请求均有成功事件 | 单一已选 Provider/API Key 路由，不代表真实 OAuth 或其他 Provider |
| writer 首次请求 | **FAIL，Connection error** | 没有审批、工具或写入；无有效用量回执 | 同窗口 CPAR 日志未见对应请求，后续 healthz 200 不能证明失败根因或未计费 |
| writer 有界重试：克隆/评审/应用/验证 | **PASS，真实执行链路** | `WRITER_PATCH_VERIFIED`；1 个 writer、1 个独立 reviewer；副本和真实工作区校验均 exit 0；仅 `proof.txt` 改变 | reviewer 明确没有自行重跑 gate，独立文件检查与运行时 gate 是两份不同证据 |
| writer Host/页面成功终态 | **未验收，脚本故障** | 会话保留第 5 轮 `stop` 最终回复；脚本递归取消导致 Host 崩溃，原报告仍为 `running`、4 轮用量 | 不把最终模型文字或落盘补丁当作 Host 已成功收尾 |
| 撤权 → 取消 → 清理 | **PASS，模型续接期间** | UI 确认撤权后取消；Host `cancelled`；worker 退出；项目/会话锁可重获；迟到审批 409 `APPROVAL_EXPIRED` | 尚未开始 bash；不能声称真实模型发起的运行中 shell 已被中断 |
| 取消脚本离线修复 | **4 PASS** | 安装 Host 回放 5 轮元数据，正常终止成功、继续工具时取消一次；重入与错误处理测试通过 | 零外部模型、替身 worker，不补记真实 writer 终态 PASS |

## 小型修改：多轮闭环已通过

任务 `f291faaf-1618-4c74-b9ed-57c834fa65aa`，23:43:22–23:43:59。审批范围仅 `proof.txt`，simple，无委派；随后 write、read 和最终回复完成。页面成功截图已查看，磁盘字节另行核对。

CPAR 请求 ID 为 `p1-request-bbb8f58d1d03ba22f380872f58879b88-0` 至 `-3`，每轮都有 attempt succeeded/completed、usage 和 request_finished。此前 reasoning 入口拒绝及续接 ProviderPermanent 的结果仍保留在历史报告中，已不代表此轮现状。

Pi 回执合计输入 8,091、输出 387、cacheRead 7,296，总 **15,774 token**；4 份有效回执，费用未知。缓存计入口径不同，不能将 CPAR 的 input_tokens 与 Pi 非缓存 input 直接对比，或重复加 reasoning token。

## 受管 writer：执行通过，验收脚本收尾失败

首次任务 `c204a246-788e-44a6-8619-a33a3a945f0e` 于 23:46 返回 Connection error，未进入审批；失败即停止，获得额外授权后才继续。

重试任务 `95e8cca4-4783-4407-b4cf-e30d4dab826f` 于 23:56 开始，00:00 前已完成以下执行：

1. 页面批准 complex 计划，仅允许修改 `proof.txt`，启用 managed clone writer 和 fresh reviewer，主 Agent 不直接修改。
2. writer 在隔离副本中生成单文件补丁；独立 reviewer 返回 pass，无 findings，并明确其未自行重跑 gate 的检查边界。
3. 副本 gate 获批后 PASS，exit 0，40ms；补丁应用后真实工作区 gate 再次获批并 PASS，exit 0，38ms。
4. 结果为 `WRITER_PATCH_VERIFIED`。补丁摘要 `sha256:be049456d1a302951e8ebbe2bcd7db8a66ad725b9767a331c32497c777bb41f8`；实际文件 11 字节，十六进制 `4d414e414745445f4f4b0a`，即 `MANAGED_OK\n`。

验收脚本在 `change` 回调中对 `responses >= 5` 同步调用 `HostTasks.cancel()`；cancel 又同步发出 change，导致 `RangeError: Maximum call stack size exceeded`。第 5 轮实际已经是 `stop`，因此脚本同时存在重入和回合上限终止判断两项缺陷。它们属于仓库外验收代码，不是本轮证实的产品或 CPAR 缺陷。

原脚本保存在 `live-cpar-writer-sep25/executed-fixture.mjs`。修改后先记录取消请求，再延迟执行，每任务只请求一次；通过 worker 的 assistant 结束事件区分最终回复和 toolUse 续接。离线回放从安装包导入 HostTasks，正常第 5 轮进入 succeeded 并保留全部用量，toolUse 边界则取消一次，均可重新取得项目和会话锁。

四项离线测试最终 PASS。第一次回放有 1 个失败：替身 worker 在仍需续接的分支错误发出了 agent_settled，未等到真实 cancel；修正夹具后通过，首轮日志保留。真实 writer 没有再次运行。

原 Host 报告仅保存前 4 轮 **17,784 token**；从持久会话只读重建全部 5 轮为 **23,869 token**，子任务预算累计 **19,730 token**，分别记录在侧车证据，不覆盖原报告。费用仍未知，目录价格为零不表示免费。

另一个验收限制：重试提交的文本来自公开任务摘要，截断为 200 字符，并非完整原始提示。批准前已检查实际生成的完整计划、单文件范围和 managed writer/reviewer 开关，收据及字节验证满足目标；但不能将其描述为完全相同提示的重放。后续验收应从原始提交载荷保留完整提示。

## 撤权和取消：模型续接期间通过

任务 `92a59715-02a7-49b4-8280-4c4aa64690f4` 于 00:04 发起。页面先批准单文件计划，再点击撤权并等待“运行时已确认撤权”，随后取消。

- Host 进入 cancelled；点击至观察到终态约 **1,112.6ms**，包含自动化观察等待，仅一个样本，既不是取消本地确认 P95，也不是纯进程退出耗时。
- worker 退出；项目锁和会话锁均可重新获取；旧审批再提交返回 409 `APPROVAL_EXPIRED`。
- `proof.txt` 保持 `MANAGED_OK\n`，没有写入取消测试的目标内容。
- 2 个模型回合、1 次工具调用、1 份有效用量，总 **3,510 token**；被中断轮次未有完整回执，费用未知。
- 等待条件错误地匹配了用户提示中的 “bash”，实际取消前 `task.tool=null`、仅执行过审批工具。因此这是模型续接取消，不是运行中 shell 取消。后续应以 Host 的 `tool.name`、`status` 和实际进程身份为启动证据。

## 清理与证据

本机证据根目录：工作区下 `artifacts/webui-phase2/`（仓库外）。

| 目录/文件 | 内容 |
| --- | --- |
| `live-cpar-summary-sep25/` | 小型修改成功、writer 首次失败、CPAR 4 轮日志、health 检查、页面截图和清理收据 |
| `live-cpar-writer-sep25/` | 原始 Host 报告、writer 完整收据、会话元数据、重建用量、脚本故障说明、已执行脚本和清理收据 |
| `live-cpar-cancel-sep26/` | 取消前后快照、撤权/取消与锁验证、已查看的 cancelled 截图、已执行脚本、清理收据 |
| `bounded-cancel.mjs`、`bounded-cancel*.test.mjs` | 取消保护与安装 Host 离线回放；最终 `bounded-cancel-tests.log` 为 4 PASS |

测试 Host 及已记录 worker 均已退出，临时凭据副本和私有配对清单已移除。各轮清理扫描未发现所选 Key 残留。小型任务和取消夹具确认原 CLI 配置摘要一致；writer 因异常退出没有前后摘要比对结果，只能确认脚本未写原配置，不能把它补写成摘要核验 PASS。writer 原孤儿锁和执行证据保留，没有凭进程消失删除锁或伪造正常释放。

## 对二阶段计划的影响

1. A10 已获得所选 API Key/Provider 的真实多轮成功证据；不再将 CPAR 续接协议列为当前阻断。真实 OAuth 仍 NOT_RUN。
2. 受管 writer 的执行链路通过，真实 Host/页面收尾仍缺一次完整证据；脚本已离线修正。不得无授权再次消耗模型额度。
3. 撤权/取消真实任务已执行并通过上述范围；运行中 shell 的证据继续区分既有本地模拟/PTY与真实模型任务，不能互相替代。
4. F01 普通前台输入绘制、完整应用资源口径和最终更新下载量仍未关闭；下一开发优先项为普通绘制门禁。相关离线工作可继续，不依赖更多模型请求。
5. 所有必要门禁通过后才晋升日常安装并标记 M2 完成。当前不进入 M3，不把“3 个任务已使用”当作“全部验收通过”。
