# U1-05 真实进度与失败恢复验收

日期：2026-09-30（Asia/Shanghai）。**PASS，限当前源码的 C/P/B 子集；U1 为 5/6、总 Task 为 19/44。** 已实现真实任务状态、等待原因、公开步骤、只读核对和显式队列恢复；失败、取消、审批失效、原生 WebSocket 断连及受控 Host 重启均有实际链路证据。完整 G1 仍待 U1-06，不宣称 WebUI、安装态、突然崩溃或真实收费 Provider 已验收。

依据：[完整计划](2026-09-26-webui-optimization-plan.md)、[Task 看板](2026-09-26-webui-optimization-tasks.md)、[验收矩阵](2026-09-26-webui-optimization-acceptance.md)、[U0 合同](2026-09-26-webui-u0-contracts.md)、[Glacier 设计合同](../design/glacier/2026-09-26-u0-design-contract.md)、[输入关联 ADR](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。既有 U1-01至04、S0/U0 证据与限制保留。

## 1. 身份、范围与边界

- 仓库 `LOCAL_WORKSPACE/repo`，分支 `codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`。保留脏工作树中已有内容，没有提交、推送或日常安装晋升。
- 支持矩阵 Node22.19.0/24.19.0；真实 Pi0.85.1 栈为 `sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b`。Ego 空间30只连接当前源码 Host、当前 WebUI 构建及 loopback-only 脚本模型；使用自有临时项目、账号和历史，没有调用用户账号或外部模型。
- 仓库外证据根为 `LOCAL_WORKSPACE/artifacts/webui-optimization/U1-05-0930-40QJki`。以下证据文件名均相对此根；私有配对 URL/token 不进入本报告。
- 最终非文档源码/模式指纹 `2ba4c06b0e855a3a71a9276620d793be4e948cfd337f62a228c5a9692af18f62`：基线1305文件→1307，仅15个本轮所有权文件变化，unexpected为空；HEAD/分支、日常 active 链接及旧 Glacier 审计哈希不变。见 `closeout-1790740825157.json`。
- 最终 UI/类型报告与最终源码完全一致。早期 Host/Pi 报告之后只改变 UI、UI测试及浏览器夹具；生产 packages 和被测 Host/Pi 测试没有改变。`final-source-applicability.json`列出逐文件差异，不把早期报告称为最终全仓同哈希。
- 不改变生产 Host/Pi 协议、持久 schema、依赖、Pi 版本、CLI/TUI 配置或模型路由；实际恢复调用已有 `reconcileInput`/`resumeQueue`，不能绕过 Host 的 CAS、消费证明和授权门禁。

## 2. 交付与代码落点

| 文件 | 实际行为与约束 |
| --- | --- |
| [TaskProgress.tsx](../evidence/2026-10-18-local-development-history.md#local-7368e6af373d8881)（新增） | 优先显示待核对、启动、取消中、终态、待审批、当前工具或已收到的生成事件；不推测内部思考或虚构百分比。公开工具返回最多20项，来源含任务ID/更新时间；返回与验证通过严格区分 |
| [useHost.ts](../../webui/src/useHost.ts) | 断连立即失去 task freshness；新 snapshot 后权威 GET 才恢复审批；迟到 GET、重复事件、旧 socket 消息/错误不能覆盖或关闭新连接；手动任务核对只做 GET，不重发任务 |
| [TaskControl.tsx](../../webui/src/TaskControl.tsx) | 无新事件时也按真实 expiresAt 更新过期审批；停机、失联、未核对及已提交时禁用决定。迟到 ACK 不让已停止任务重新出现审批成功提示 |
| [InputQueue.tsx](../evidence/2026-10-18-local-development-history.md#local-b529319bbdb71859) | 显示暂停原因、逐输入 Pi 核对和关联任务；unknown/accepted/dispatching 及未投递旧 steer 阻断恢复。原生恢复对话框列出真实正文、绑定、费用与重新授权说明；版本或任务变化禁确认，Escape返焦点 |
| [useInputDraft.ts](../evidence/2026-10-18-local-development-history.md#local-f423e05274e70cdc) | 单飞恢复、冻结目标和 revision、单调采用权威队列；异常后只读对账，不自动重复恢复请求。查不到消费条目仍保留未知，不据此补发 |
| [App.tsx](../../webui/src/App.tsx)、[api.ts](../../webui/src/api.ts) | 接实际正在执行任务与最新度；不同组件使用独立 React key，消除导航残留进度卡；已停止任务不再把最后工具显示为仍运行；补失败/重启等可行动错误说明 |
| [host-ui.css](../../webui/src/host-ui.css) | 延续 Glacier tokens、对话优先与默认收起右侧；进度/恢复控件桌面40px、窄屏44px；Portal 中的恢复弹窗也显式覆盖关闭/确认按钮尺寸，防止继承范围丢失 |
| `useHost.test.tsx`、`task-progress.test.tsx`、`task-control.test.tsx`、`input-delivery-ui.test.tsx`、`conversation-flow.test.tsx` | 增加22个用例，覆盖新旧状态竞态、断连/重连、失效审批、未知核对、恢复CAS/单飞/丢ACK和导航单卡 |
| `tests/fixtures/host-input-browser.mjs`、`scripts/probes/webui-u1-storage.mjs` | 本地工具等待/模型失败/真实权限审批、受控 Host 重启、实际 Pi carrier及回收证据；U1-05限域 closeout。夹具增加一条本地 read 闸门，不修改生产扩展集合或 Pi SDK |

本轮使用 lean-coding、frontend-ui-craft、ui-ux-pro-max 和 React 最佳实践约束实施：保留已认可的视觉系统，优先完整状态、原生对话框、真实来源和焦点/触控可用性，不引入 UI 库或依赖升级。

## 3. 自动化结果

| 检查 | Node22.19.0 | Node24.19.0 | 证据 |
| --- | --- | --- | --- |
| 全 WebUI / 11测试文件 | 87 PASS | 87 PASS | `ui-1790740714033.json`及stdout |
| Vite生产构建 | 退出0 | 退出0 | 同上，两个 build 命令分别留证 |
| 根/安全/Host/WebUI类型检查 | 4组PASS | 4组PASS | `types-1790740713701.json` |
| Host输入投递＋HTTP | 29 PASS | 29 PASS | `delivery-1790737807762.json` |
| 生产 Host＋真实 Pi＋本地模型 | 4 PASS | 4 PASS | `pi-input-1790737809904.json`及`pi-receipts-*.json` |
| 最终源码/模式与保护边界 | PASS | 共用工作树 | `closeout-1790740825157.json`、`final-source-applicability.json` |
| 文档链接与最终diff | PASS | PASS | `docs-1790741550076.json`；`git diff --check`退出0，汇总见`final-acceptance-summary.json` |

命令记录包含绝对 Node 路径、版本、argv、退出码、耗时、stdout和子进程组退出；runner只在失败时返回stderr，如实标记该限制。完整仓库回归本轮 NOT_RUN：生产 Host/终端/所有权代码未变；执行受影响 WebUI 全测与 Host/Pi 检查，完整 U1 集成由 U1-06承担。

可复核入口（`OUT`为上述确切证据根，Node/stack按报告实际路径指定）：

```text
node scripts/probes/webui-u1-storage.mjs --output OUT --phase ui --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase types --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase delivery --node22 NODE22 --node24 NODE24
OMP_TEST_STACK_PACKAGE=VERIFIED_PACKAGE node scripts/probes/webui-u1-storage.mjs --output OUT --phase pi-input --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase closeout --baseline OUT/baseline-1790737057290.json --scope u1-05
```

## 4. Ego与真实历史核验

| 场景 | 实际结果与限定 | 权威证据 |
| --- | --- | --- |
| read工具等待/公开步骤 | 实际 Pi 工具仍运行，显示真实工具及等待原因；消息保留，没有假百分比或验证成功 | `B01-real-tool-progress.json` |
| 真实模型失败/刷新/显式恢复 | 本地模型401→MODEL_REQUEST_FAILED；部分结果保留，队列暂停；刷新/核对不增加请求。原生确认后新任务消费原队列ID，而非重跑失败任务 | `B02-failure-refresh-readonly.json`、`B03-explicit-resume-consumed.json`、`pi-carriers-recovery.json` |
| 取消中/未知补充 | 独立停止显示cancelling，合作式工具退出后才cancelled；未确认补充保留unknown，Pi查无条目仍不得重发，阻断队列；刷新前后请求9→9 | `B04-cancelling-real-state.json`、`B05-cancel-unknown-reconciliation.json` |
| 实际原生WebSocket关闭/重连 | 关闭真实native socket，不注入React/DOM状态；旧状态显式待核对，重新连接后查询权威状态，请求9→9 | `B06b-native-websocket-reconnect.json` |
| 待审批时断连 | 真实权限工具产生3个决定按钮；native socket断连时3个全禁，重连保持Inspect且仍等决定，请求12→12 | `B07-real-approval-wait.json`、`B07b-approval-native-reconnect.json` |
| 取消后旧审批负例 | 页面不保留可用审批；携带正确Host版本头的旧决定请求返回409/APPROVAL_EXPIRED；Inspect且请求12→12 | `B08c-valid-header-late-approval.json`；前两次错误协议探测不作审批负例依据 |
| 受控Host重启 | 同一私有store、新epoch和本机端口；旧进程/租约先归零。已完成重启后队列保持暂停；刷新/只读核对14→14、任务10→10、旧审批为空 | `B09-before-graceful-restart.json`、`browser-restart-*.json`、`B10b-post-restart-no-replay.json` |
| 重启后明确恢复/关联任务 | native模拟触控确认恢复，实际队列进入consumed；关联到新task，最终succeeded/Inspect；本地请求仅14→15，未继承写入授权 | `B12b-touch-resume-related-task.json`、`pi-carriers-recovery.json` |
| 尺寸/主题/键盘 | 390/761/1440无水平溢出；真实进度与恢复触发按钮44/40px；深色和减少动态偏好有实际CSS证据，键盘focus-visible有2px实线 | `B11-final-responsive-theme.json`、`B13-keyboard-focus.json` |
| 最终Portal对话框 | 390px关闭/保持暂停/确认均44px；761/1440均40px；等待opacity=1后拍摄；Escape关闭并返恢复按钮，不确认费用或写入 | `B15-final-modal-targets.json`及`accepted-recovery-dialog-*-v2.png` |
| 最终服务资源 | 实际浏览器读取index、JS、CSS，与本地dist逐字节SHA256一致 | `B16-final-served-build.json` |

主代理已实际打开核对浅/深色工作台、窄屏结果和最终v2恢复对话框截图；右侧默认收起、Glacier质感保留。原生 CDP 触控是模拟触控，不是实体触屏；物理IME与屏幕阅读器实机均 NOT_RUN。减少动态偏好在对应 CDP 会话内实测，不声称覆盖会话结束后仍保持该模拟系统偏好。

### 不得抹除的过程结果与限制

- `B06-network-reconnection.json`为 NOT_RUN_CONNECTION_NOT_CLOSED：CDP Network offline 没有关闭既有 WebSocket。随后才用真实 native socket 关闭完成断连验收；不能冒充物理断网测试。
- `B08-cancelled-approval-rejected.json`中的旧PASS谓词只检查HTTP409，实际是PROTOCOL_MISMATCH；`B08b-valid-protocol-late-approval.json`也仍为错误协议头。保留原始文件，只有B08c支持APPROVAL_EXPIRED结论。
- `B10-after-graceful-restart.json`保留FAIL：把整个合作式关闭过程误要求为零请求。释放旧read闸门时13→14是原任务工具后的最后响应，真实carrier只出现一次，不是新队列重放；新Host启动后以B10b的14→14核对。取消不承诺立即阻断任意工具或已在途模型计费。
- 首次恢复截图落在入口动画透明阶段；`B14-stable-modal-keyboard.json`进一步查出Portal弹窗38/40px未达窄屏44px。已加专用class/限定CSS后，以最终构建B15/v2复验；不改原FAIL或截图。
- 其他尝试包括测试fixture工具字段类型错误、错误的页面等待文字、Ego选择器/隐藏关联入口与Page回调误引用Node变量；修复探针后核对实际状态，不重复已经成功的resume请求。导航残留卡片、旧socket错误及停止后工具文案是已修复的真实代码问题，并加对应回归。
- 此次Host重启是**受控graceful restart**，不是突然杀死Host、操作系统断电或固定端口部署恢复。底层C/P的保守恢复不替代后续完整故障旅程；这些仍由U1-06核对。

## 5. 回收、风险与下一步

- 浏览器夹具共16个本地模型请求、12个worker。停止后全部进程组已退出、pending inputs=0、会话租约/账号预留=0；由新HostInputStore重读持久数据。`fixture-cleanup-verified.json`再次确认进程组死、私有临时根不存在。
- 9项consumed各与实际Pi custom carrier的inputId、taskId、entryId、正文及contentDigest逐项匹配且仅一条；1项unknown与2项paused均无carrier，仍保持保守状态。见`pi-carriers-recovery.json`；没有把“查无”解释为“绝未执行”。
- 仅删除夹具自己创建的临时项目/账号/历史根；日志、报告、截图、队列和历史证据保留。用户项目/配置/历史与日常安装未改。Ego空间30只finish一次，关闭p1、保留0，无未跟踪用户页面；`ego-finish.json`留证。
- 恢复命令可能产生模型费用，所以必须用户明确确认；当前验收全部本地免费fixture，真实Provider NOT_RUN且新增收费场景NOT_AUTHORIZED。恢复旧会话不恢复grant；未知投递不提供无条件跨进程exactly-once保证。
- 下一项 **U1-06**：冻结最终候选，完成G1-01至06整批C/P/B旅程、错误/保存/刷新矩阵，尤其补完整故障恢复、占用/损坏和集成范围。本文只关闭U1-05限定Task，整批G1仍NOT_RUN。
- I/Full、日常安装和L真实Provider仍NOT_RUN；U2入口G2-00发行材料/Full门禁仍阻断，旧FAIL/PARTIAL/OPEN_UNATTRIBUTED保留；Electron仍须等待U6。
