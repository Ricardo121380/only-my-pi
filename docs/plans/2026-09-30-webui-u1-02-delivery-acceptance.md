# U1-02 Host输入协议与Pi投递验收

日期：2026-09-30（Asia/Shanghai）。结论：**PASS_U1_02_HOST_C_P_ONLY**。U1-02按后端代码/接口与真实Pi SDK＋本地可控模型子集收口，U1为2/6、全计划16/44。**现有WebUI还没有接入这些新命令；G1-01至G1-06完整门禁仍NOT_RUN。** 范围来自[Task看板](2026-09-26-webui-optimization-tasks.md)、[U0输入合同](2026-09-26-webui-u0-contracts.md)及[ADR-0018](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。

## 1. 源码与证据身份

仓库分支`codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`；工作树已有未提交S0/U0/U1-01内容，不能把整份Git diff或HEAD独自当作本Task源码身份。最终四份报告的非文档源码SHA256/权限快照完全一致，`JSON.stringify(source)`摘要为`ff8d5bb2e2f3b17851e58f449e85e0c3ebf8e4570a32225273388d7729cb83cc`。报告保留逐文件身份、实际Node路径与版本、argv、退出码和进程组退出检查；不是发布或日常安装版本。

证据根（仓库外）：`../../../artifacts/webui-optimization/U1-02-0930-ISk7Co/`。

| 最终报告 | SHA256 | Node22.19.0／24.19.0结果 |
| --- | --- | --- |
| `delivery-1790701823724.json` | `88f7b2752d86170e9c86a192780bd245c1e93c4dd4ca4dafe37e2c72b63c576e` | 各28项Host控制器及HTTP检查通过，0失败、0跳过 |
| `pi-input-1790701826763.json` | `7d90c3a8125b1c15231f8717746e4d8824220d46df414bace494383c2fecef51` | 各4项生产Host/Pi RPC＋本地SSE夹具通过，0失败、0跳过 |
| `types-1790701826638.json` | `2b295188a3b9a2166c63988e9355a50ec978c8252f7e4d850f58450dfe5f81eb` | 各4组TypeScript检查通过 |
| `regression-1790701793531.json` | `c22f72d7b5f164d0fb6a3626574a60edfebf5ab8bea1d5a0ed924d9b9e4e625b` | 各162项相关Host／配置／包／文档回归：159通过、0失败、3跳过 |
| `docs-1790702390282.json` | `5cfb5fe7b53fb62b0f3d86bdb0f8a7af49bf23511d98ca5078da49a587f31289` | 文档落盘后各2项链接检查通过 |
| `closeout-1790702334432.json` | `c78c84acf8d1ffe2955939f74f2b36016f99c06ca5857ea96fef808d287c3468` | 基线1288→当前1295非文档文件；17项变化均在本Task清单，daily symlink／Glacier审计／HEAD及分支未变 |

运行器：[webui-u1-storage.mjs](../evidence/2026-10-18-local-development-history.md#local-0a68cbaea5200199)。本地P证据文件`pi-receipts-*-179070182*.json`记录Pi SDK 0.85.1 manifest摘要、真实会话entry ID、模型夹具请求次数及worker/租约回收；Provider字段为`LOOPBACK_FIXTURE_ONLY`，**不是实际外部Provider调用**。三项SKIP为既有生产SDK scout、writer和installed Host真实PTY所需环境未启用；不以其他轮次证据补本轮PASS。

## 2. 交付边界

| 实现 | 本项实际责任 |
| --- | --- |
| [input-protocol.mjs](../../packages/host/input-protocol.mjs)、[contracts.d.ts](../../packages/host/contracts.d.ts) | 严格输入协议1命令和类型；scope仅允许项目＋会话键或任务ID，不接受客户端文件路径、凭据或grant；校验候选与持久收据身份 |
| [input-controller.mjs](../../packages/host/input-controller.mjs)、[input-store.mjs](../../packages/host/input-store.mjs) | 串行准入、草稿转提交、即时补充、队列FIFO、双revision更新、状态和只读对账；失败/撤权/漂移保守暂停 |
| [server.mjs](../../packages/host/server.mjs) | 新增已配对的`/api/input-command`；同时检查Host2与输入1协议头、Origin、请求体上限；快照声明`inputs.protocol=1`、`materials=false`；WebSocket输入脏事件独立计序 |
| [tasks.mjs](../../packages/host/tasks.mjs)、[rpc-worker.mjs](../../packages/host/rpc-worker.mjs)、[account-rpc-entry.mjs](../../packages/host/account-rpc-entry.mjs)、[pi-input-bridge.mjs](../../packages/host/pi-input-bridge.mjs)、[catalog.mjs](../../packages/host/catalog.mjs) | task/session绑定、实际Pi SDK `sendCustomMessage`安全steer、投递候选、当前分支JSONL持久证明及历史投影；旧无账号raw管道不改为新的授权路径 |
| [包内容合同](../../verification/manifests/pack-content-v1.json)、[host类型检查](../../tsconfig.host.json)、[类型负例](../../tests/types/host-input-protocol.mts) | 三个新增运行模块入包必需清单，新增Host实现受`@ts-check`与调用负例覆盖 |

`getInputs`、`saveDraft`、`clearDraft`、`submitPrompt`、`enqueueInput`、`deliverSupplement`、`editQueuedInput`、`removeQueuedInput`、`resumeQueue`、`reconcileInput`已接Host命令。版本能力是服务端声明，旧客户端不需要处理新输入脏事件；新客户端必须收到能力后调用，并在脏事件/重连时重新读权威状态，不从WebSocket事件推定消费。`materialSnapshotIds`非空在本阶段被拒绝；材料上传、图片和文档发送仍属U2。

## 3. 已验证的行为与安全限制

- 停止历史会话的草稿提交绑定该会话；明确新建的草稿在获得真实新session身份后、首次Pi prompt之前，把**完整正文**写入该会话的持久输入记录，记录源草稿ID关系。相同requestId重试返回原任务，不重复启动；源草稿冲突不另起任务。新记录与草稿清理为两个分片，**不承诺跨分片原子性**：转写前失败仍保留草稿，转写后异常保留完整记录供核对，不自动重试付费或写入任务。
- 运行中steer先持久写为dispatching再调用真实Pi SDK；SDK ACK只表示接受，不能称consumed。Pi `message_end`是候选提示，Host再读取当前分支持久JSONL；须匹配业务inputId、task、scope、内容摘要、全文及entry ID，才持久标记消费。相同正文、外任务、伪造/重复收据和compaction上下文均不能代替证明。P夹具在工具尚未释放时收到补充，当前工具没有被强停；安全边界后四个carrier（补充＋三条队列）各有独立entry ID。
- 三条队列按FIFO逐项创建新的检查型task，不继承前一写入grant；只有前项成功、身份/模型/思考强度/资源版本仍有效才推进。编辑/删除仅限未投递项且检查分片及记录revision。重复ID不会再投；当前task刚结束时补充报错并保留意图，绝不偷转新prompt。
- ACK丢失先只读查询当前历史；无持久证明则unknown并暂停，不通过重发探测。重启恢复队列暂停，已投递但无证明保持unknown；失败、取消、撤权和绑定漂移不自动推进。显式`resumeQueue`仅对允许的暂停状态有效，不解除未知消费或恢复授权。局部稳定ID去重不能证明任意崩溃窗口的全局exactly-once；**保守不重放**是当前边界。
- 入口保留配对/Origin/双协议头和请求体大小限制，测试旧Host序列无缺口、敏感正文不进入输入脏事件。HTTP已以隔离Host夹具完成真实新会话草稿提交并核对ledger；尚无现有页面端到端体验结论。

## 4. 失败账本与未执行层次

失败报告保留，不用最终PASS覆盖历史：`regression-1790700527793.json`的唯一失败是U1-01旧测试仍断言新增`inputs`能力不存在，更新该过期断言后双Node回归通过；`delivery-1790701668866.json`中一个测试在task完成、controller异步消费落盘之前抢读ledger，改为等待实际持久状态后重验通过。`docs-1790702281412.json`是运行器首次调用漏传两个绝对Node路径，尚未启动检查；补齐参数后的`docs-1790702316805.json`通过。初次P夹具关闭顺序和早期类型窄化问题亦在定向验证中修正，最终P与类型结果如上。它们不被解释为浏览器或安装态PASS。

| 层次 | 本轮状态 | 后续入口 |
| --- | --- | --- |
| Host代码/HTTP/协议、真实Pi 0.85.1本地夹具 | PASS（上述限定C/P子集） | U1-03/04接实际网页调用，U1-05接进度/恢复 |
| EgoLite WebUI与用户旅程 | NOT_RUN | U1-03至06；逐入口验证默认续接、补充/队列/停止和异常 |
| 日常安装版、Full与真实外部Provider | NOT_RUN | 依既有门禁和新的具体调用/晋升授权；不借本地模型顶替 |
| G1-01至G1-06完整门禁、G2-00发行门禁 | NOT_RUN | U1-06及U2入口；旧F02 PARTIAL、Full NOT_RUN保留 |

本轮没有切日常active、调用收费模型、清理历史或进入Electron。下一项U1-03从页面接默认续接/明确新建/草稿隔离；U1-04再提供即时补充与队列操作，不能因为接口存在就把旧按钮标为已可用。
