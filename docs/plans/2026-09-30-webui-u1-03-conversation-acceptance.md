# U1-03 默认续接与隔离草稿页面验收

日期：2026-09-30（Asia/Shanghai）。结论：**PASS_U1_03_C_P_B_ONLY**。本Task的默认续接、明确新建、配置可见、草稿隔离和页面交互已验收，U1为3/6、全计划17/44。**不是完整U1、日常安装或整个WebUI完成。** 下一项U1-04接即时补充/队列/停止UI，U1-05接完整进度与恢复，U1-06核对全部G1门禁。

范围依据：[Task看板](2026-09-26-webui-optimization-tasks.md)、[设计合同](../design/glacier/2026-09-26-u0-design-contract.md)、[输入合同](2026-09-26-webui-u0-contracts.md)及[ADR-0018](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。保留Glacier与React，不新增依赖或升级Pi；使用ui-ux-pro-max、frontend-design、frontend-ui-craft及React规则处理状态、尺寸、焦点与职责拆分，浏览器用ego-browser/EgoLite。

## 1. 源码与环境身份

分支`codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`未变。已有S0/U0/U1-01/02脏文件保留，不能用整份Git diff或HEAD代替本Task身份。基线1295→最终1303个非文档文件；21项变化都在U1-03清单，无意外改动。日常current-stack符号链接、原Glacier交互审计及分支/HEAD保持不变；没有提交、推送、晋升安装或收费调用。

证据根（仓库外）：`../../../artifacts/webui-optimization/U1-03-0930-Izwyfy/`。最终非文档SHA256/权限快照的`JSON.stringify(source)`摘要为`e88d8935a6b1a17f5bb2fc2627a765acbb779ddf452f3c9e8a78d71a5f128940`。Ego最终夹具在`browser-final-2/`，其排序后逐文件字节SHA摘要为`dc9fcbe86870bf9b0247b1d450f4f58f3af1aaf1f65c6e377dc50dd72c7a899e`，与前者算法不同，不比较两值是否相等。实际服务的`webui/dist/index.html` SHA256为`f9704a904bd7917a7b60efec081e89171fdf9652206da45b89f4bf012651b2a6`。

支持矩阵为Node22.19.0/24.19.0，页面Host使用Node24.19.0＋显式隔离验证栈、Pi SDK 0.85.1。栈ID为`sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b`；Host与静态WebUI来自当前源码/构建，Pi来自该验证栈。不是日常安装态或Full候选；只操作新建临时Alpha/Beta项目、合成账号和loopback模型，没有读取用户凭据/业务项目或调用外部Provider。

## 2. 实际交付

| 改动 | 行为与边界 |
| --- | --- |
| [useConversation.ts](../evidence/2026-10-18-local-development-history.md#local-b13224862d606451)、[App.tsx](../../webui/src/App.tsx) | 分离导航与会话状态；停止历史和已完成任务默认继续准确session；独立新建回到项目的新会话草稿；导航generation阻止迟到POST抢页面；历史配置取该会话最新已知task，不取第一条旧摘要 |
| [useInputDraft.ts](../evidence/2026-10-18-local-development-history.md#local-f423e05274e70cdc)、[DraftNotice.tsx](../evidence/2026-10-18-local-development-history.md#local-33912591b4556b6c) | 项目/会话隔离完整正文，Host双revision CAS与自动保存，保存中输入不被擦除；多窗口冲突保留双方并要求显式选择；稳定inputId/requestId，POST ACK不直接清草稿，结果不明不自动重放 |
| [Composer.tsx](../../webui/src/Composer.tsx)、[api.ts](../../webui/src/api.ts)、[useHost.ts](../../webui/src/useHost.ts) | 受控正文和配置、32768字符限制、IME保护与发送快捷键；账号/模型消失仍显示并禁发，不选列表第一项；能力协商后调用输入协议1，输入脏通知不混入Host seq；重连先读权威草稿 |
| [models.mjs](../../packages/host/models.mjs)、[tasks.mjs](../../packages/host/tasks.mjs)、[input-controller.mjs](../../packages/host/input-controller.mjs) | 共享思考能力校验：明确的空thinkingLevels只允许off，未报告能力仍拒绝；修复普通模型无法提交off的前后端不一致，不放宽权限/准入 |
| [host-ui.css](../../webui/src/host-ui.css)、[ProjectHome.tsx](../../webui/src/ProjectHome.tsx) | 清除与默认续接冲突的旧文案；输入控件桌面最小40px、窄屏44px且分两行，右侧默认收起；保留Glacier材质和配色，不以外观修改代替接口接入 |

配置仍由用户明确选择；已知历史账号/模型/思考强度可恢复显示，但不恢复写入grant。资源版本变化时提交**原保存快照**，Host明确拒绝过期绑定；用户核对并重选配置后保存新版本，不能在发送时偷偷换resourceRevision。该0→1变化有定向测试；当前生产能力仍报0，不声称已发生真实线上配置漂移。

完整绑定的草稿由Host持久保存；未绑定、离线或结果不明的输入另有本标签页sessionStorage恢复副本。**临时副本不是关闭标签页/浏览器后仍可恢复的长期存储承诺。** Host/浏览器重启、队列与异常恢复的完整旅程继续由U1-05/06验收。

## 3. 验证结果

| 报告/层次 | 实际结果 |
| --- | --- |
| `ui-1790708032151.json`／C | 两Node各9个文件、51项WebUI测试通过，各完成Vite生产构建；最终非文档源码与closeout完全一致 |
| `types-1790707639310.json`／C | 两Node各4组TypeScript检查通过；与最终源码仅有之后的CSS尺寸调整差异，不影响实现类型 |
| `thinking-1790706623002.json`／C | 两Node各29项思考能力、投递与metrics检查通过 |
| `pi-input-1790706713259.json`／P | 两Node各4项生产Host/Pi RPC＋本地模型检查通过，消费依据为实际持久entry，不以IPC ACK冒充消费 |
| `regression-1790707152504.json`／C | 两Node各164项相关Host/配置/包/文档回归：161通过、3跳过、0失败；既有SDK scout/writer和installed Host夹具SKIP不补PASS |
| `browser-final-2/browser-summary.json`／B、P | EgoLite空间28，实际当前Host＋最终静态构建；B01–B06及同项目草稿补充检查通过，截图已实际打开核对 |
| `closeout-1790708569504.json`／边界 | 21项非文档变化均属Task；daily/audit/HEAD/branch未变，`git diff --check`通过 |
| `docs-1790708891511.json`／静态文档 | 落盘后两Node各2项文档/资源归属检查通过；总计划、看板、进展和矩阵均为17/44、U1 3/6、下一项U1-04 |

`evidence-applicability.json`逐文件对照最终源码：较早的thinking/Pi/Host回归报告中生产`packages/host/`无变化，可复用对应机制结果；不把之后新增的UI/测试算作较早报告已覆盖。具体命令、绝对Node路径、退出码、进程组检查在报告及stdout日志中；[运行器](../evidence/2026-10-18-local-development-history.md#local-0a68cbaea5200199)提供`ui/thinking/pi-input/types/regression/docs/closeout --scope u1-03`入口。

| 页面场景 | 观察到的结果 |
| --- | --- |
| B01 打开完整停止历史直接发送 | 实际新task继续seed A的原session、原账号、Reasoner/low，没有额外创建会话 |
| B02 切项目/同项目不同会话/刷新 | Alpha历史、Alpha普通模型、Beta未绑定草稿各自保留；刷新恢复正文与配置，Beta无隐式账号或模型 |
| B03 明确新建＋快捷键 | 从历史进入独立空草稿；选账号后仍要求明确选模型；ControlOrMeta+Enter创建不同session，Plain实际off |
| B04 缺失账号 | 历史已移除账号仍可辨认，正文保存、发送禁用；没有隐式换账号或创建task。缺失模型的独立负例另有App集成测试 |
| B05 双窗口离线修改冲突 | 保留本地与Host版本，刷新不覆盖；显式“用当前输入更新草稿”后CAS成功，干净窗口同步，无自动执行 |
| B06 尺寸/主题/键盘 | 1440/761/390px无根横向溢出；输入控件分别达到40/40/44px；窄屏思考选择可用，Enter打开/ Escape关闭，焦点返回及2px焦点环；浅色/深色截图核对 |

最终夹具共5个loopback模型请求（3个预置＋2个页面任务），2条实际持久消费记录；草稿编辑和冲突处理未新增模型任务。关闭Host后重新打开输入存储仍读到两个独立会话草稿及消费记录；5个worker均有确切PID且进程组已退出、pendingInputs=0，session leases/account reservations均0。Ego空间已finish一次；仅回收夹具自己的临时根，报告/日志/截图保留，用户项目和历史不动。

## 4. 失败记录、风险与后续

- 独立只读核验发现saved草稿在发送时重建resourceRevision的digest风险，已改为提交保存快照；新增版本变化、真实GET/WebSocket事件先后及A→B→A迟到请求测试。最后两项是验收缺口补齐，不声称之前已经证实运行故障。
- `regression-1790706718708.json`保留OAuth夹具400ms窗口在高并发下失败；独立`oauth-1790706837880.json`通过，后续有界并发回归通过。这支持测试负载相关解释，不声称已证明唯一因果。
- `regression-1790706891918.json`保留终端崩溃夹具ENOTEMPTY失败：reconciliation发布先于异步persist完成；测试增加等待`entry.done`再重建/回收夹具，未改终端产品的锁或清理边界。最终两Node回归通过。
- 早期页面证据保留：窄屏点击目标偏小、`browser-final/B06-desktop-pre-fix.json`桌面目标不足40px。尺寸修正后在`browser-final-2/`完整重跑功能与视觉检查；旧证据不冒充新构建。CDP调整尺寸使旧ref失效、模型目录尚未就绪与布局动画中的截图属于操作/等待问题，重新观察并等待真实条件，不以固定sleep或重复盲点凑PASS。
- 物理IME、完整Host重启/损坏恢复旅程、会话占用时的完整UI控制、补充/队列与进度页面仍待U1-04/05/06。合成IME组件测试不代物理输入法验收。当前Vite仍有既有大Monaco块提示，未在本Task扩大为性能重构。
- G1-01/02的已测C/P/B子集PASS，完整G1-01至06仍NOT_RUN，待U1-06统一收口；Full/日常安装/真实外部Provider均NOT_RUN。G2-00发行材料义务、F02/F03 PARTIAL、旧FAIL与OPEN_UNATTRIBUTED不变，不进入U2或Electron。

下一项：**U1-04**，运行中明确选择即时补充/排队，显示接收、待生效与实际消费，编辑/删除未投递项，停止独立且已投递不能假撤回；沿既有安全接收位置与幂等合同验收。
