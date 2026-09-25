# M2 实施进度

## 2026-09-21：2A-1 账号目录基础

状态：部分实现，2A 未验收。此记录不替代完整阶段计划。

- 新增 `packages/host/accounts.mjs`：服务端 UUID、严格元数据 schema、同 Provider 多身份、原子写入及跨实例互斥。争用返回 LOCK_HELD，不静默丢弃更新。
- 使用 Host 私有目录 `only-my-pi/host/accounts/catalog.json`；不接受账号路径、Key、token 或任意附加字段，不读取 CLI 凭据。认证状态尚未提供，不能由元数据推断认证成功。
- 已接独立版本的 `/api/accounts` GET/POST 接口；POST 要求配对、同源及 `X-OMP-Account-Protocol: 1`，只创建元数据。响应明确 `authentication: not_connected`。现有任务协议和日常安装版不变，尚未创建真实账号。
- 验证：`node --test tests/host-account-catalog.test.mjs`，6 项通过，覆盖独立身份、CLI 哨兵不变、文件权限、无效输入、并发、损坏恢复、符号链接及持久化字段校验。全部使用临时目录，不调用模型；既有 ModelRuntime 探针保持不变。
- 待完成：2A-1 的配置/删除/CLI 只读引用、公开协议和客户端类型；2A-2 ModelRuntime 与任务显式绑定；2A-3 认证；2A-4 Glacier 界面。
- 磁盘约 5.1 GiB 可用，可继续小规模开发；未开展完整打包及安装推广，执行前重新核查空间。

下一接入门禁：账号占用检查与任务绑定必须在开放删除、登出和切换接口前完成；不得先暴露可绕过占用保护的端点。

## 2026-09-21：账号接口与 ModelRuntime 存储接缝

- `server.mjs` 接入受保护的目录列表/创建接口；`contracts.d.ts` 增加元数据类型。无客户端凭据表单、删除或登出端点。
- `AccountCatalog.runtimePaths()` 仅供内部调用：从已存在的 UUID 派生独立 auth/models/models-store 路径，私有目录权限 0700，拒绝符号链接与未知账号。HTTP 不返回这些路径。
- 既有 ModelRuntime 探针改为使用真实 AccountCatalog 路径，在模拟 Provider 的实际请求回调中确认两账号各自使用其凭据；验证登出、并发 OAuth 刷新及凭据保存后同步失败。不是外部 Provider 互操作验收。
- Node 24.19.0 定向测试：`--test tests/host-accounts.test.mjs tests/host-account-catalog.test.mjs tests/host-server.test.mjs`，14/14 PASS；`tsc -p tsconfig.host.json`、`git diff --check` PASS。
- 仍未完成：生产 RPC worker 注入账号 ModelRuntime、环境凭据回退阻断、任务绑定与占用保护、认证流程、静态 Provider、Glacier 账号 UI。2A 及 M2 仍为未验收，不开放 GUI 账号执行任务。
- 未更新日常安装栈、未调用真实模型、未改 CLI 配置或其他项目。

## 2026-09-21：账号专属模型目录子进程

- `/api/models?accountId=...` 先校验目录中的账号，再启动独立模型目录子进程；不复用 CLI 模型缓存。未知账号明确失败，不能退回默认账号。
- GUI 目录子进程仅继承必要运行环境及代理设置，不继承 Provider Key、云凭据路径、NODE_OPTIONS 等；CLI 原目录调用保持不变。
- 子进程使用账号独立 ModelRuntime 路径，先检查 Pi 公共 `listCredentials()` 的 Provider 和认证类型，再刷新并筛选该 Provider 模型。未认证账号返回空目录。
- 新增 `host-account-models.test.mjs`，真实 Node 子进程验证空账号不借用 CLI/环境测试凭据、未知账号失败、CLI 文件不变；2/2 PASS。不含外部模型调用。
- 限制：这只是模型目录隔离，不是完整请求链路隔离验收；仍未开放 GUI 账号任务启动，RPC 身份注入与占用保护待完成。HOME 等运行环境保留，因此不声称单靠环境白名单就完成所有 Provider 的身份隔离。

## A03：公共 SDK RPC 入口初步实现

- 新增 `account-rpc-entry.mjs`，通过公共 ModelRuntime、会话服务与 RPC runtime API 注入账号身份；保留原 agentDir 和共享历史位置，不用改全局配置目录替代注入。
- `RpcWorker` 增加内部 accountId 入口选择，沿用已解析扩展集合、进程身份、终止和命令白名单。无 accountId 的 M1 路径保持原样；HostTasks/浏览器尚未接通新入口。
- 入口要求对应 Provider/authType 的已存储凭据，精确选择模型，拒绝启动时模型回退；传入 plan 权限标记和 read/grep/find/ls 工具集合。成功加载受控扩展的完整行为仍待实测，不能仅凭传参声明安全门禁通过。
- `node --test tests/host-rpc-worker.test.mjs`：5/5 PASS，包含真实子进程缺失账号凭据负例，CLI/环境哨兵不被借用、错误脱敏且进程退出。
- 模型子进程及 Host HTTP 回归：8/8 PASS；`git diff --check` PASS。
- 下一验收：双账号成功请求身份、受控扩展与只读工具实际生效、运行中凭据失效不回退。A03 未通过，A04/A05 未实现，未推广安装版、未使用真实模型。

## 2026-09-22：A03 真实 RPC 成功请求验证

- 新增 `tests/host-account-rpc-success.test.mjs`：临时私有账号目录、两个同 Provider 身份、真实 Pi RPC 子进程、本地 HTTP SSE 模拟模型服务。
- 服务端实际收到分别对应 fixture-a/fixture-b 的 Authorization；不是仅检查 worker 构造参数或绕过 RPC 直接调用 ModelRuntime。
- 两个实际模型请求的工具 schema 均只有 find/grep/ls/read；子进程结束后回收临时资源。测试超时上限 30 秒。
- `node --test tests/host-account-rpc-success.test.mjs`：1/1 PASS。
- 限制：使用最小测试扩展注册 perm 标记，不替代完整受控扩展集验证；工具列表只证明暴露范围，不证明所有工具运行时拒写负例。运行中凭据失效与无回退仍需验证。A03 保持开发中，A04 未开放。
- 无真实模型费用、未读取用户认证、未推广安装版。

## 2026-09-22：A03 401 与写工具负例

- 扩展真实 RPC 成功测试：同一进程先成功请求，再收到模拟服务 401，要求 assistant stopReason=error；服务端记录确认请求保持原 Key，没有账号轮换。
- 再由模型返回未经允许的 write 工具调用；真实 Pi 执行链返回 isError 工具结果，目标文件保持不存在。随后模型正常结束，两个账号分别验证。
- 一共捕获 8 个本地请求，前 4 个均使用账号 A，后 4 个均使用账号 B；每次暴露的工具仍只有 read/grep/find/ls。
- `node --test tests/host-account-rpc-success.test.mjs` PASS。以上针对测试 Provider、最小扩展集；不外推为所有 Provider/OAuth 或完整受控扩展集通过。
- A03 剩余门禁：完整受控扩展集互操作，以及存储凭据在进程存活期间被删除/改变的边界（401 是服务端拒绝，不等于本地凭据移除）。A04 仍未开放。

## 2026-09-22：A03 本地模拟服务门禁收口

- 补充进程存活期间删除账号 auth.json：两个账号均返回 assistant error，服务端请求数不增加，未继续使用旧凭据。
- 测试支持显式 `OMP_TEST_STACK_PACKAGE`，使用真实 `loadDistribution` 和默认受控扩展解析，不手工拼装安装栈扩展集合。测试项目、认证与历史均为临时目录。
- 对安装栈 `0b9e9e1c8b7e6d8b1b678dc0c02a5e728c29d47ac96e90853f3b61450ffe8847` 使用其内置 Node 24.19.0 执行 `--test tests/host-account-rpc-success.test.mjs`，设置 OMP_TEST_STACK_PACKAGE 为该栈 only-my-pi/package：PASS（约 5.7 秒）。覆盖同 Provider 双身份、401 不轮换、模型 write 调用拒绝、移除凭据不发请求及退出。
- 首次使用系统 Node 执行被 DISTRIBUTION_MANIFEST_INVALID 拒绝（运行时不属于 Full 栈）；切换正确嵌入式 Node 后通过，未修改安装校验。
- A03 本地模拟服务门禁 PASS，可以开始 A04。此结论不等于外部 Provider/OAuth 全覆盖，也不等于 M2、安装推广或浏览器账号流程验收。

## 2026-09-22：A04 内部任务绑定

- HostTasks 支持注入 AccountCatalog；启用时强制 accountId，检查账号存在及 Provider/model 一致，模型目录按账号查询；身份传到 RpcWorker。
- 账号加入新任务幂等摘要和 task 持久化、公开摘要；历史未绑定任务显示 null，不猜测身份。未启用账号目录的旧路径若被传入 accountId 会拒绝，而非忽略。
- 新增 `host-task-binding.test.mjs`：缺失/未知绑定、Provider 不匹配、worker 参数、同请求不同账号冲突、重启不重放；与 Host HTTP 回归共 7/7 PASS。
- 仅内部接缝；生产 startHost 尚未注入账号目录，公开任务 schema/协议及 session 元数据绑定仍未完成。避免在 A05 占用保护前提前暴露账号任务；现有 M1 客户端保持不变。

## 2026-09-22：A05/A06 账号变更与认证基础

- AccountCatalog 增加进程内引用占用和变更互斥；任务启动查询模型前预约身份，确认 worker 退出后释放；无法确认退出保留占用。任务首次落盘失败不启动进程，释放预约并进入存储失败关闭状态。
- RPC session 写入不含秘密的 omp-account-binding 元数据；公开任务协议仍未开放账号绑定，A04 未完成。
- 新增 account-auth.mjs / account-auth-worker.mjs，通过独立 SDK 子进程执行 API Key 保存、状态查询和登出。Key 只经标准输入，响应只含脱敏状态；超时或 Host 停止取消子进程，等待 close 后才释放账号互斥。
- 新增静态 Provider 白名单配置、重命名、删除及 /api/account-action 接口；拒绝命令执行字段和含凭据 URL。仅测试临时账号，不修改用户 CLI 认证。
- 测试覆盖双引用占用、变更互斥、配置拒绝、API Key 保存/登出、取消前后恢复、首次落盘失败及现有 Host 回归。OAuth、公开账号任务协议、UI、完整进程终止竞态仍待完成；不代表 A05/A06 或 M2 验收通过。

## 2026-09-22：A04–A09 集成及验收补强

- Host 协议升级为 2；HTTP 任务和模型目录强制显式 accountId，旧协议拒绝。CLI 只读引用也经 SDK 显式绑定，只接受其已有凭据，不借环境凭据；不允许 GUI 修改 CLI 认证。账号身份进入幂等摘要、任务与 Pi session 元数据。
- 认证子进程先持久化 PID 身份，再通过私有 IPC begin 启动认证；Host 恢复时先核对并回收认证进程，PID 重用拒绝误杀。取消、超时和停止等待 close 后才释放账号。
- OAuth 动态发现 Pi 公共 Provider，串行登录；一次性输入绑定 flowId/promptId，支持取消和超时；对外只投影允许字段，原始错误及令牌不返回。模拟成功/拒绝/同步失败/晚到输入/占用/取消/超时已覆盖；外部真人 OAuth 登录 NOT_RUN，不声明互操作通过。
- Glacier 设置接入账号创建、API Key、静态 Provider、OAuth、认证状态、重命名、登出与确认删除；任务必须选择账号。提交秘密立即从输入状态清除。登出提示明确区分移除凭据与删除账号。
- 修复浏览器实测发现的 SDK 启动缺陷：公开服务工厂没有 CLI 的主题初始化，完整权限扩展在 session_start 报 Theme not initialized。入口补充公共 initTheme，真实 RPC 测试新增 extension_error 必须为空的断言。此前 A03 完整扩展 PASS 证据遗漏该断言，以本次增强验证为准。
- 修复移动端弹窗被隐藏侧栏祖先遮蔽：HostDialog portal 到 body，关闭后恢复可见焦点；保持原 Glacier CSS/SVG 不变。
- 新增失败启动、账号预约覆盖模型查询及取消、退出无法确认时保留账号/会话占用、失败 Host shutdown 不释放占用、恢复后释放测试。
- 验证：`npm run test:host` **43/43 PASS**；`npm run test:web` **16/16 PASS**；Host/WebUI TypeScript、`npm run build:web`、`git diff --check` PASS。完整安装扩展集合的增强 RPC 测试使用既有栈内 Node 24.19.0/Pi 0.85.1 另行 PASS；不等于新源码已安装。
- Ego Lite TaskSpace 10：临时配置/项目、本地模拟 HTTP 模型，真实 Pi RPC 收到独立账号请求并完成任务；创建→配置→认证→模型选择→请求→重命名→登出→保留/确认删除→刷新保持历史、无自动绑定 PASS。390/761/1440 布局及截图检查、原生 modal 焦点/Tab/Escape PASS；CDP 中文 composition 输入检查通过，不等同实体系统输入法全覆盖。
- 截图位于仓库外 `../artifacts/webui-phase2/accounts-2026-09-22/`：以 `settings-390-fixed.png` 和 `task-761-settled.png` 为修复后证据，早期同目录截图保留失败/过渡态。无真实模型调用（阶段预算已用 0）；未改日常安装、用户 CLI 认证或无关审计文档。
- A10 尚需候选提交及最终差异核对；M2 **未完成**。下一批次是 2B 可信 worker 宿主授权接缝；审批、编辑器、PTY 不因账号流程通过而自动开放。

## 2026-09-22：2B 私有接缝（未开放产品入口）

- `approval-bridge.mjs` 将 Pi 请求映射为 worker 生命周期内的一次性审批 ID，拒绝重复/迟到/无效选项，支持超时与撤权清空。Pi 原始 requestId 不进入公开审批数据。
- 受控 SDK bootstrap 通过进程内 capability 连接 `omp-direct`；`RpcWorker` 私有 IPC 撤权等待确认，失败则终止 worker。普通 RPC/CLI 无此 capability，继续拒绝编程授权。HTTP schema 尚无 controlled 选项，页面仍为只读。
- 新 `host-controlled-rpc.test.mjs` 用实际生产 SDK 入口、实际第一方 direct 扩展和本地模拟模型验证批准后写入、撤权拒写、迟到批准拒绝、普通 RPC 拒写。并非完整安装扩展集或受管 writer 的端到端证明。
- 发现 pi-subagents 不继承主进程 ModelRuntime，实际子进程继承 process.env 后启动独立 CLI。为避免回读 CLI 认证，使用其既有 `PI_SUBAGENT_PI_BINARY` 接缝增加 `bin/omp-account-child.mjs`，由公共 parseArgs/ModelRuntime/会话服务/runPrintMode 注入同一账号；不改 Pi 或外部包。仅支持子代理约定的 JSON-print 参数，未知参数失败关闭；保持工具列表、生成扩展和任务文件输入。
- child 入口绑定信息仅为账号 ID/配置根，固定于独立 worker 整个生命周期，不在并发任务间临时改写，不传递密钥。新测试确认两个真实子进程各自发出绑定身份、工具仅 read、移除账号凭据后拒绝请求且 CLI 哨兵不变。
- 当前回归：Host **50/50 PASS**，受影响 direct/session/orchestration/M12 合同 **38/38 PASS**，TypeScript 与 diff 检查 PASS。完整受控栈的子代理 route/预算/受管应用和 GUI 结果投影仍 **NOT_RUN**；2B–2F 未完成，不能据此宣称二阶段完成。

## 2026-09-22：2B 内部任务投影及候选失败门禁

- 私有 HostTasks 开关接入受控模式、一次性审批和撤权投影；受控任务持有项目锁直到 worker 确认退出，撤权不提前释放。恢复时清空授权与审批。公开 HTTP 仍未启用。
- 内部任务测试 PASS；基础生产 RPC 批准/撤权/迟到/普通只读 4/4 PASS。完整栈新增 scout 测试实际失败，错误 DIRECT_ORCHESTRATION_UNAVAILABLE。
- 候选 069ddb1 的隔离构建目录依赖使用软链接，npm pack 只带直接依赖，漏掉 ssri 的 minipass；直接导入解包 composer 确认 MODULE_NOT_FOUND。该候选未安装，已拒绝；仓库外保留 candidate-069ddb1-rejected.md，删除本轮可重建失败产物以回收容量。
- 构建器增加解包后的依赖加载检查；缺少传递依赖负例与修复正例 PASS。隔离构建依赖改用物理副本，不修改主仓依赖或用户安装。
- 2B 完整子代理链仍未通过；不能以基础写入通过替代受管闭环。真实模型预算已用 0，M2 未完成。

## 2026-09-22：完整 scout 通过，受管 writer 继续接入

- 新候选 6ed3a02 / stack 71cbfa6a664293b79a4130e3e69678c01e18afdd10984af88fc32a9ecb85100e 通过解包运行依赖检查。嵌入式 Node 24.19.0、Pi 0.85.1 全审计扩展下账号测试及批准/撤权/迟到/普通/scout 合计 6/6 PASS。scout 为真实子进程，本地模拟服务确认父、子、续接三请求均为绑定账号。
- 新 writer 闭环测试复现 DIRECT_WRITER_AUTHORIZATION_REVOKED：旧路径要求 TUI Project Trust，尚未接入私有 GUI 授权。未通过前继续关闭公开编程入口。
- 私有 SDK factory 提供函数形式、不可经 JSON 传入的当前会话授权判断；仅 writer 验证器使用。仍逐次确认克隆与真实工作区门禁，不更改 Pi 全局信任或加载项目扩展。撤权/会话变化/退出后授权失效。
- TUI/RPC 验证器实际 argv 门禁、拒绝/漂移/撤权检查 2/2 PASS；相关 direct/session/project-gate 测试 58 PASS、2 个完整栈测试跳过；TypeScript PASS。新的完整 writer 候选仍待验收。
- 新增项目锁退出不明负例 PASS：失败 shutdown 保留写锁，确认退出后才回收。开发变化未晋升日常安装。

## 2026-09-22：2B 真实 writer 闭环与审批界面

- 候选 fb00621 / stack 7ba2fb8f60fee1f3beb42feb7f07cd69049d1d924d6dca87b586d4f2b0a73de8 完成隔离构建。真实 SDK、栈内审计扩展、实际 writer/reviewer 子进程与本地模拟模型的 writer 测试 PASS：六次请求、三次独立批准、实际文件写入、副本 PASS 与真实工作区 PASS 回执，未重试。修正测试模型 structured_output 的 value 参数合同；并非放宽生产验证。
- 新增私有 IPC 子代理/预算白名单投影，不传原始子任务文本、输出或认证。HTTP 增加类型化审批/撤权命令，startHost 默认 allowControlled=false；普通宿主仍不能创建受控任务。
- HTTP/投影/授权身份测试 11/11 PASS；未配对、跨 Origin、旧协议、未知字段、重复审批、撤权后旧审批均拒绝。源码级 Host 入口测试不冒充完整候选安装验收。
- Glacier 新增审批卡、撤权和子代理预算；断线禁用、单次提交、防重复点击，不把批准等同执行成功。执行回执结构化展示 application/verification，APPLICATION_UNKNOWN 明确禁止自动重试，无重试应用按钮。Web 组件 20/20 PASS，类型检查与生产构建 PASS。
- Ego Lite TaskSpace 10 使用 tests/fixtures/host-controlled-browser.mjs：真实 Host/SDK、候选 fb 的审计扩展、临时项目/账号、本地模拟服务。待审批时刷新后仍可见同一审批；页面点击批准后临时 proof.txt 为 browser approved，任务结束、审批清空、授权不保留。启动由 fixture 的真实 HTTP 命令完成，不宣称受控启动选择器已开放。页面检查发现受控会话仍显示只读分析，已改为受控执行标识。
- 2C 仍有重要进程归属缺口：project-gates 的 detached 进程组独立于 RPC worker；仅证明 worker 组退出不能证明这些执行组退出。CLI 写入尚未统一持锁。公开受控入口继续关闭，修复与验证后再开放。
- 真实模型预算已用 0；未修改日常安装。2C–2F 未验收，M2 未完成。

## 2026-09-22：2C 所有权与停止会话续接基础

- CLI/TUI 编程批准后先取得与 Host 相同的 canonical project 锁，取得会话锁后才启动会话；锁取得期间再次核对撤权、身份和代次。撤权不释放项目锁；退出时已登记执行尚活跃或清理不明则保留锁。尚需完整安装 TUI/GUI 跨进程交叉验收，不能仅凭辅助类测试宣称门禁完成。
- project-gates 记录当前运行与未确认终止；私有 Host SDK shutdown 回执检查执行探针，RpcWorker 执行过 prompt 后没有匹配回执即保留占用。新增负例证明 worker 组已死也不能替代清理回执。Host 重启遇到受控遗留 worker 时拒绝自动释放项目/会话锁，要求 reconciliation；尚未提供自动核对未知独立进程组的能力。
- 续接仅接受 catalog sessionKey，不接受路径；重新核验文件、项目和 session ID，先取得会话锁再启动新 worker，SDK SessionManager.open 读取原历史，原进程授权不恢复。请求摘要包含续接目标。历史界面新增显式只读续接选择，必须重新明确账号；默认仍新建会话。
- 真实 SDK 本地模拟服务测试覆盖三种账号的停止/续接、同 session ID、旧消息实际进入下一请求。目录身份漂移和越项目拒绝；任务级测试证明 CLI 占用时 worker 不启动、活动会话拒绝并发、释放后可续接。
- Host 回归 59 PASS / 2 完整候选场景 SKIP；Web 20 PASS；Host/Web 类型检查 PASS；Direct/所有权/进程定向测试 PASS。新完整候选及浏览器续接待验收，2C 未完成，公开受控启动仍关闭。

## 2026-09-22：2C 实际 TUI/GUI 交叉验收与 2D 私有编辑器

- 完整候选 e2f2590 / stack 0a8350541347ac7053a9b4f6b88ab6829a65628a4225b0cfefb2beb5cd8ba36b 使用 Node 24.19.0、Pi 0.85.1。真实账号/RPC 测试 7/7 PASS，包括 scout 与 writer/reviewer/应用/验证；模型为本地脚本服务，不是外部真人 Provider。
- Ego Lite TaskSpace 10 与真实 TUI 交叉：TUI 手动批准后实际写入 proof.txt；此时 GUI 受控任务因 OWNERSHIP_HELD 失败。TUI /exit 后新 GUI 任务成功；从页面选择原 TUI 历史、点击续接并明确选择账号/模型，成功保留 session ID 01a0c544-120e-73b9-a094-670d0da85fee。启动持锁冲突任务用 HTTP，续接走实际 UI，不混淆两类证据。临时服务退出确认 requests=5，proof 为 browser approved。
- 新 ManualWorkspaces 接入私有 HTTP 命令：进入/退出手动模式、sha256 条件保存、原子替换、并发保存保护；复用 canonical project 锁，不授予 Agent 编程权限。拒绝符号链接、硬链接、越界、无效 UTF-8、NUL、大于 512KB 和旧版本。Host 关闭等待保存完成；重启不恢复手动租约。外部程序不遵守 OMP 锁，版本复查不等于操作系统 CAS 或沙箱。
- Monaco 0.56.0 固定版本、同源 worker、按需加载；文件目录、多标签（最多 12）、语法高亮、文件内搜索、草稿/基线 diff、保存/重新读取、脏标签与关闭工作区确认。CSP 仅放开动态样式及同源 worker，脚本仍禁止 inline/eval；不加载 CDN。编辑器约 3.82MB 延迟包，首屏 JS 约 410KB；性能指标仍待 2F 实测，构建告警不隐藏。
- Ego Lite 已验证中文实际落盘、多标签、搜索、外部改动冲突保留草稿、关闭脏标签提示、重新读取磁盘、390px 无文档横向溢出。截图在 ../artifacts/webui-phase2/editor-*.png。浏览器首轮点击不可见的 Monaco 内部 textfield 失败，转用截图定位实际编辑区完成，不把失败点击算通过。
- 手动保存/HTTP/所有权定向测试 PASS，Web 20/20 回归、Host/Web 类型检查与生产构建 PASS。新编辑器仍在私有 allowControlled 门禁内；未晋升日常安装。2C 其余入口/异常清理审查及 2D 扩展回归继续，2E/2F 未完成，真实模型预算仍 0。

## 2026-09-22：2C 提前写入竞态——阶段阻断，不能验收

- 编辑器批次已提交 6ca0c4b。随后补齐 OMP bash 的公共 BashOperations 适配：Agent bash 与 TUI user_bash 使用共享执行注册表，流式输出上限 5MB；撤权合并 abort signal，shell 主进程退出时立即清理仍活跃的同组后代，而不是等待其继承管道关闭。不是 OS 沙箱，不声称能管理主动逃逸到其他 session 的任意守护进程。
- 最新 Host 回归 **62 PASS / 2 完整候选场景 SKIP**，根/Host/Web 类型检查 PASS。共享执行测试原先期待 timeout，现在更早得到 descendant-active；改为验证此更严格退出原因并保留退出确认断言。新 bash 适配尚未重建完整候选或安装，不用旧候选证明它。
- 新 `tests/direct-headless-ownership.test.mjs` 真实 Pi CLI 负例 **FAIL**：另一进程持有目标 session 锁时，CLI 退出码 1 且模型请求 0，但既有 JSONL 被追加 model_change 和 thinking_level_change。原始会话仅 header，追加内容由 SDK 初始化产生。最初测试等 stdin EOF 超时，关闭测试子进程 stdin 后重现真实竞态；没有把测试超时当产品错误。
- 原因：Pi 0.85.1 `dist/core/sdk.js:239–253` 在 extension session_start 前追加元数据；`dist/core/session-manager.js:671–678` 的打开/迁移也可能重写文件。`main.js:531–558,570–680` 没有提供初始化写入前的公开扩展 hook。TUI 后续切换有 session_before_switch/fork，可取消但不能解决初始 --resume/--continue/--session 的提前写入。只增加 session_start 锁或 input 拦截均不足。
- 独立只读探子 m2_early_session_lock_scout 核验同一结论：若不修改/升级 Pi，要保证整个初始化边界，需 OMP 自有 CLI/TUI 启动与会话选择层，覆盖初始及运行中切换，并重新验收原 CLI 行为。此举扩大已完成 CLI 的兼容性改动范围，需要明确路线后实施；未 monkeypatch Pi、未修改全局配置、未取消失败断言。
- 当前 **M2 未完成**：2C 被上述 FAIL 阻断，2D 仍只私有开放，2E/2F 未验收。失败测试与局部补强保留工作树，日常安装未动。不要通过跳过该断言、降级“同会话单写”标准或仅观察无模型请求来给阶段 PASS。

## 2026-09-22：显式 headless 历史正式启动链局部修复

- 用户确认薄启动层路线后，先完成 SessionAdmissions 原型、运行中恢复、新 ID 预留、完整历史分支与最近历史组件；细分证据见 tasks 的 C04–C06。没有改 Pi 内部或升级依赖。
- 本次将 `launcher.mjs` 的绝对历史路径 print/json 接到 `session-entry.mjs`：先只读解析并取得锁，再加载公开 SDK main。完整审计 argv 原样保留，启动前检查新入口/SDK 栈内路径。其他选择模式未改路由，不声称全 CLI 已修复。
- `omp-direct/index.ts` 增加独立的进程内“会话已持锁”能力，只跳过重复 session 加锁，不跳过项目写锁或编程授权。
- 原失败测试 `direct-headless-ownership.test.mjs` 现在通过实际 buildDirectPiInvocation 生成参数并启动真实子进程；保留退出码 1、模型请求 0、文件逐字节不变三个断言，结果 PASS。此前 raw Pi 失败证据仍有效；本次测试边界改为已接入的 OMP 入口，不代表 raw Pi 被修改。
- `node --test tests/direct-agent-launcher.test.mjs tests/direct-headless-ownership.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs tests/direct-session-switch.test.mjs tests/direct-session-ownership.test.mjs tests/omp-direct-session.test.mjs tests/host-ownership.test.mjs`：48 PASS。`tsc --noEmit` PASS。真实 Pi + 第一方 omp-direct 的正常 print/json 本地模型请求持锁、正常释放通过；没有验证全安装扩展集。模型为本地服务，外部预算使用 0。
- 实际 Pi 硬启动错误跳过 finally 时，下一进程得到 OWNER_RECONCILIATION_REQUIRED：保留锁而非误释放。自动核验清理仍未实现。
- 仍待完成：TUI/相对路径/ID/continue/resume/fork 正式启动接入、原生选择器与 entry 分支语义、异常恢复、完整候选与安装态。2C/M2 未验收，日常安装未更新。

## 2026-09-22：C05 非交互选择正式接入（最新）

- `packages/direct-agent/session-selection.mjs` 统一路径、ID/唯一前缀、session-id、continue 和默认新建。已有历史先只读选择并持锁；新建先预留 ID，再将固定 ID/目录交给公共 main。continue 使用文件 mtime，最新文件被占用即拒绝，不回退。目录遵循参数、对应发行版环境变量、设置、默认目录优先级。
- 修改 `launcher.mjs`、`session-entry.mjs`、`session-admission.mjs`，扩大持久化 headless 路由并绑定已核验 SDK；保留工具、权限、扩展及提示词参数。TUI/RPC/resume/fork 等未覆盖入口不据此宣称修复。
- 选择参数为空、重复或冲突时拒绝；前缀多匹配拒绝，跨项目 ID 要求显式 fork，避免静默改变历史。独立只读核验发现空值误新建/误选目录问题，主线程修复并增加零历史写入负例。
- 修改 launcher、headless-ownership、session-admission 测试，新增 `tests/direct-session-selection.test.mjs`。实际参数构造链下绝对/相对/前缀/ID/continue 争锁均验证退出 1、零模型请求、原文件字节不变；真实 Pi 与第一方扩展正常请求期间持锁、退出释放及指定新 ID 创建通过。
- 验证命令：`node --test tests/direct-agent-launcher.test.mjs tests/direct-headless-ownership.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs tests/direct-session-switch.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-ownership.test.mjs tests/omp-direct-session.test.mjs tests/host-ownership.test.mjs`：**65 PASS，0 FAIL，0 SKIP**。`tsc --noEmit` PASS。环境 Node 26.8.2、Pi 0.85.1；模型请求使用本地替身，外部模型调用 0。
- 风险与边界：唯一前缀要求比原生自动选首项更严格；硬退出仍保留 durable lease 并要求 reconciliation，自动核验清理未实现。未覆盖实体 TUI、全安装扩展集、嵌入式 Node 或 Windows；未更新日常安装、未发布。下一步为 TUI/resume 选择和运行时生命周期；2C/M2 仍未验收。

## 2026-09-22：C05 只读 resume 选择器与 PTY 验证

- 重新核对 Pi 0.85.1：`dist/modes/interactive/components/session-selector.js` 的默认删除回调直接 trash/unlink，未经过 session_before_switch；`dist/modes/interactive/interactive-mode.js` 的普通 shutdown 在 dispose 后 process.exit；`dist/core/agent-session-runtime.js` 的 new/fork 在内部生成 ID。不能仅扩大 main 包装路由便宣称完整 TUI 单写成立。
- 新增 `packages/direct-agent/session-picker.mjs`，复用公共 SessionSelectorComponent 和由目标 SDK 解析的 pi-tui；删除回调替换为只读提示，不注册重命名。选择期间只提供默认深色主题及搜索/范围/排序快捷键，不运行主题包发现；main 在准入后加载正常配置。未宣称自定义启动主题/快捷键完全兼容。
- 修改 `session-selection.mjs`、`session-entry.mjs`、`launcher.mjs`：print/json 的 resume 先选择后准入；取消不进入 main、不新建；冲突参数及非 TTY 拒绝。完整交互式 TUI/RPC/fork 路由不变。没有修改 Pi 内部、全局配置或日常安装。
- 新增 `tests/direct-session-picker.test.mjs`、`tests/fixtures/direct-resume-pty.mjs`，扩展 selection/admission/launcher 回归。执行上节九文件命令并加入 `tests/direct-session-picker.test.mjs`：**71 PASS / 0 FAIL / 0 SKIP**。`tsc --noEmit` PASS。
- 真实 PTY 手动执行 `node tests/fixtures/direct-resume-pty.mjs select|cancel|occupied` 三个独立场景：Enter 选择后本地模拟请求 1 次、请求期间锁存在、结束后可再获取；Escape 取消和占用拒绝均请求 0 次、v1 文件字节不变。三项均输出对应 PTY_*_PASS。
- 首轮 PTY 夹具使用 launcher 的完整 argv，但缺少注册 --perm 的第三方扩展，失败为 Unknown option。修正夹具为显式 SDK 入口 + 第一方 omp-direct 后执行上述三项；启动参数构造另由单元测试覆盖，不将修正后的测试冒充完整扩展集验收。尝试从仓库根直接解析 pi-tui 不存在；实际入口从已选 SDK 的依赖目录解析，PTY 已验证成功。
- 本轮只完成恢复选择组件与 headless resume 接入，不是整个交互 TUI 验收；二阶段未完成。下一步接管运行时替换与退出边界，再逐项覆盖新建/分支/导入和异常回收。真实模型预算 0，用户 Glacier 审计文档未改。

## 2026-09-22：C05 OMP 拥有的运行时恢复与退出边界

- 新增 `packages/direct-agent/session-runtime.mjs`：在初始 SessionManager.open 前准入，返回公共 AgentSessionRuntime 的 OMP 子类；仅调用 SDK 公共方法，未修改 Pi 原型、私有字段或源码。switchSession 先准入目标再委托 SDK，保留取消语义和 rebind 回调，重叠替换直接拒绝；之前访问的历史持续持锁。
- dispose 在接受请求时立即拒绝后续切换，等待已进入的替换、Agent abort 和全部 SDK shutdown/dispose 完成后才关闭 SessionAdmissions；并发 dispose 返回同一结果。Pi ExtensionRunner.emit 会吞掉 handler 异常，因此通过公开 onError 捕获 shutdown/before-switch 异常，按生命周期不明保留锁。替换工厂失败、未确认执行清理均不自动重试或释放。
- 新增 `tests/direct-session-runtime.test.mjs` 9 项真实 SDK 定向测试：初始占用无迁移、恢复/回切与退出写入、未支持操作拒绝、取消保持原会话、并发切换与退出、异步退出处理、被 SDK 吞掉的 shutdown 异常、执行清理不明及替换工厂失败。无外部模型请求。
- `node --test tests/direct-session-runtime.test.mjs tests/direct-session-switch.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs`：**35 PASS / 0 FAIL / 0 SKIP**。其中新运行时 9 项，不将本轮 35 项与上轮 71 项相加冒充不同测试总数。仅新增 JS 与测试/文档，未重复运行无关前端构建或全仓类型检查。
- 新增 `tests/fixtures/direct-runtime-pty.mjs`，真实 PTY 分别执行 quit、resume、crash：通过 Pi InteractiveMode 的 /quit 退出；通过私有 /fixture-resume 调公共运行时替换并再 /quit；父进程只对自己的夹具子进程发 SIGKILL。三项 RUNTIME_PTY_*_PASS。正常退出后历史包含 shutdown-proof 且共享锁可重获；SIGKILL 后获取锁返回 OWNER_RECONCILIATION_REQUIRED。测试环境为本机 Node 26.8.2/Pi 0.85.1，私有无工具运行时，没有验证完整审计扩展或嵌入式 Node。fd 不存在时 Pi 按离线模式跳过下载，未安装依赖。
- 一轮默认只读探子定位 InteractiveMode 的公共/私有界限；主线程核对声明：构造 options 没有 selector 替换入口，原生 selector 的 rename 会打开文件写元数据，showSessionSelector 是私有方法。独立 SessionSelectorComponent 的公开 getSessionList 回调仍可受控使用（上轮已实现），但不能据此声称能替换 InteractiveMode 内部 picker。
- 风险与后续：new/fork/import 仍返回 SESSION_OPERATION_NOT_ADMITTED；旧运行时替换失败不恢复旧对象或重试；异常自动回收未实现。正常 TUI launcher 尚未改路由，必须先接管交互选择调用并逐项兼容新建/分支/导入，再做完整候选与安装态验收。未改全局配置、Pi、日常安装及用户 Glacier 审计文档；2C/M2 未完成。

## 2026-09-22：C05 受控导入与同 ID 副本

- 修改 `packages/direct-agent/session-runtime.mjs`：恢复与导入共用并发替换门禁；importFromJsonl 先只读准入源文件，再调用 Pi 公共 importFromJsonl。Pi 导入保留 ID，因此复制、v1 迁移和新运行时初始化均受源 ID 锁保护；仍由 Pi 负责取消事件、COPYFILE_EXCL 和文件名后缀，不把导入偷换为恢复源文件。
- 修改 `session-admission.mjs`：增加校验 ID/文件身份的 admitOwnedCopy，共享源租约以支持导入副本回切；仅导入显式启用 allowOwnedId，允许当前会话的外部副本共享已持 ID 锁，默认恢复准入不放宽。不同 ID、硬链接及身份变化拒绝，关闭时复用原有幂等 release。`session-selection.mjs` 只导出已有 resolveLocalPath 供导入复用，未复制另一套路径转换。
- `tests/direct-session-runtime.test.mjs` 新增 8 项导入测试：不覆盖/回切、取消无副本、占用/缺失/空源、已存文件、当前 ID 外部副本、非法副本、并发退出及工厂失败保留证据。运行时共 17 项。执行 `node --test tests/direct-session-runtime.test.mjs tests/direct-session-switch.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs tests/direct-session-selection.test.mjs`：**54 PASS / 0 FAIL / 0 SKIP**。
- 扩展 `tests/fixtures/direct-runtime-pty.mjs` 的 import 场景：真实 PTY 输入原生 `/import incoming/target.jsonl`，看到确认弹窗并选择 Yes，再 `/quit`。输出 RUNTIME_PTY_IMPORT_PASS；断言副本 target-1.jsonl 保留 imported ID、退出证明已写入、原输入及已有 target.jsonl 字节不变、锁可重获。本机 Node 26.8.2 / Pi 0.85.1，私有无工具运行时，未使用外部模型。
- 边界：没有更新 launcher 或日常安装；完整审计扩展集、Windows 路径、缺失 cwd 后的原生交互纠正重试尚未验收。源缺失在准入层以 ENOENT 拒绝，不能声称完全兼容 Pi 专用错误类型；进入 SDK 后发生异常仍将生命周期标为不明并保留部分副本/锁，不自动清理或重试。新建/分支与完整 TUI 选择器仍待完成；2C/M2 未完成。未改用户 Glacier 审计文档。

## 2026-09-22：C05 受控新建与公开运行时组合

- 修改 `packages/direct-agent/session-runtime.mjs`：由继承改为组合公开 AgentSessionRuntime，通过公共 getters 和 setter 保持 TUI 运行时合同；恢复、导入、退出继续委托 SDK。只接管 newSession：before-switch(new) → 预留 ID 并创建 manager → abort/shutdown(new) → 同步 UI invalidate → dispose → 工厂 session_start(new) → setup/重建 messages → rebind → withSession。没有访问 Pi 私有字段或把 new 偷换成 resume。
- 修改 `packages/direct-agent/session-admission.mjs`：create 支持一次性传入 parentSession，与预留 ID 一并交给公共 SessionManager.create。不再需要调用 manager.newSession 生成第二个未锁 ID。取消不预留、不持久化；工厂/setup/生命周期异常保留锁并拒绝重试，退出等待在途替换。未改变现有保守失败策略。
- 扩展 `tests/direct-session-runtime.test.mjs`：验证 ID 在工厂初始化前被持有、父会话、new 事件、setup 与 UI/context 回调顺序、取消零写入、新建后恢复/导入回调继续生效、并发与退出等待、工厂/setup 异常、被 SDK 吞掉的 before/shutdown 异常。运行时文件 23 个顶层测试及 4 个嵌套测试。
- 执行 `node --test tests/direct-session-runtime.test.mjs tests/direct-session-create.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-switch.test.mjs`：**64 PASS / 0 FAIL / 0 SKIP**，统计含嵌套测试；不是与上轮 54 项相加。`git diff --check` PASS；无外部模型调用，未执行无关前端构建。
- 扩展 `tests/fixtures/direct-runtime-pty.mjs`：工厂前检查持锁，IPC 记录 start/shutdown。实际 PTY 执行 `node tests/fixtures/direct-runtime-pty.mjs new`，输入原生 `/new`，观察 New session started，再 `/quit`：**RUNTIME_PTY_NEW_PASS**。验证 source:new、唯一新 ID 的 start(new)/quit 及退出后新 ID 可再获取；空新会话沿用 Pi 延迟持久化，不为测试强行写入假对话。环境为本机 Node 26.8.2 / Pi 0.85.1，离线无工具夹具。
- 限制：没有更新 launcher、完整审计扩展或日常安装；不宣称无持久化入口、原生 fork、内部选择器、错误交互与自动异常回收已兼容。下一步实现选定 entry 的 fork 身份预留与分支语义。2C/M2 未完成；用户 Glacier 审计文档未改。

## 2026-09-22：C05 选定消息 fork 与真实 TUI 验证

- `packages/direct-agent/session-admission.mjs` 的 create 增加 leafId 路径：源文件先准入，目标 ID 先预留；公开 SessionManager.inMemory + createBranchedSession 负责分支、标签重建与 compaction 指针，生成的中间 ID 仅存在内存。目标使用预留 ID/header，以 wx、0600 保存快照后交给公开 SessionManager.open。保留原始 entry ID，父会话指向源文件；测试确认投影不修改源字节。
- `packages/direct-agent/session-runtime.mjs` 实现 fork(before/at)：保留 before-fork 取消、根消息前空分支、selectedText、shutdown/start(fork)、invalidate/rebind/withSession。无效 entry 不预留目标且旧会话可用；工厂或生命周期不明保留锁，不重试。公共 onError 增加 before-fork 异常检查。替换动作延迟到微任务，使并发门禁在同步扩展回调执行前已生效，防止重入绕过。
- 新增 `tests/direct-session-runtime.test.mjs` 7 项及 `tests/direct-session-create.test.mjs` 2 项：before/at、空根分支、取消/重入、工厂失败、hook 失败、在途退出、标签/压缩指针、无 assistant 快照首条回复不重复 header。执行 `node --test tests/direct-session-runtime.test.mjs tests/direct-session-create.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-switch.test.mjs`，最终 **73 PASS / 0 FAIL / 0 SKIP**（含既有嵌套测试）。`git diff --check` 与改动 JS 语法检查 PASS。
- 扩展 `tests/fixtures/direct-runtime-pty.mjs` fork 场景，真实 PTY 输入原生 `/fork`，选择第二条消息，观察新会话只呈现第一条历史、第二条内容回填输入框；Ctrl-U 清空后 `/quit`。输出 **RUNTIME_PTY_FORK_PASS**，断言 fork start/shutdown、父会话、目标只含选定点前路径及退出后 ID 锁可重获。使用离线无工具夹具，无外部模型请求，不是完整安装扩展集验收。
- 兼容性差异：非空选定路径即使没有 assistant 也立即保存快照；原生对此延迟保存。此差异明确保留，首次 assistant 追加单 header 已验证；根节点前空分支仍采用公共新建的延迟持久化。未宣称 --no-session、全 TUI 恢复选择器或错误纠正流程完成。
- 下一项：接管完整恢复选择器，阻断删除/重命名绕过准入；再做错误交互、异常回收与候选交叉验收。未改 Pi、全局配置、日常安装或用户 Glacier 审计文档；2C/M2 未完成。

## 2026-09-22：C05 公开编辑器恢复入口与只读选择整合

- 新增 `packages/direct-agent/session-resume-ui.mjs`：复用公开 CustomEditor，在公开 handleInput 中接管 `/resume` 提交及 app.session.resume 动作，其他提交继续交给原回调。避免覆盖 InteractiveMode 私有方法；Pi 在创建编辑器后复制回调，因此路由放在输入处理时完成。每次 session_start 安装适配器，ui.custom 复用已有只读选择组件，再调用 admitted runtime.switchSession。取消/过期选择不切换、重复打开拒绝、错误输出限定为错误码。
- 新增 `tests/direct-session-resume-ui.test.mjs` 三项，覆盖原生回调复制后路由、取消/过期选择和错误脱敏。执行 `node --test tests/direct-session-resume-ui.test.mjs tests/direct-session-picker.test.mjs tests/direct-session-runtime.test.mjs tests/direct-session-create.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-switch.test.mjs`：**78 PASS / 0 FAIL / 0 SKIP**。`git diff --check` 和新增 JS 语法检查 PASS。
- `tests/fixtures/direct-runtime-pty.mjs` 每次工厂加载该扩展；真实 PTY 两轮执行 resume 模式，均输入 `/resume`（不是 fixture-resume），选择 target 后 `/quit`，输出 RUNTIME_PTY_RESUME_PASS。第二轮在选择前 Ctrl-D/Enter 确认删除，观察只读拒绝后仍能恢复 target，父进程验证 source/target 的退出证明与锁可重获。没有外部模型请求，没有更新日常安装。
- 限制：这是私有无工具扩展栈，其他扩展可通过公开 API 更换编辑器，不能据此保证完整栈没有绕过路径；必须核验编辑器归属。原生组件 delete 提示仍显示，但回调拒绝写入；自定义恢复快捷键没有默认按键，仅验证动作路由合同。占用、cwd 纠正、reload 后重新安装以及完整历史渲染还需实体流程验证。错误期间不恢复已失效运行时，仍沿用保守锁策略。
- 下一步收口编辑器冲突与选择器错误交互，再做异常回收和候选验收。2C/M2 未完成；未修改 Pi、全局配置或用户 Glacier 审计文档。

## 2026-09-22：C05 reload 选择器失效与错误白名单

- 核对 Pi AgentSession.reload：旧 runner 在 shutdown 后失效，再建立新 runner，而 Session 对象保持不变。原先仅比较 runtime.session 无法拒绝 reload 期间的迟到选择。`session-resume-ui.mjs` 增加每次 session_start 的代次标记，shutdown 使其失效；打开选择器前、返回后及错误通知前均检查代次，旧编辑器回调不得操作新上下文。
- 错误码由大写正则改为明确允许集合，未知 code 统一 SESSION_RESUME_FAILED，避免任意全大写秘密字符串进入通知。没有修改 SDK 私有字段或全局配置。
- 更新 `tests/direct-session-resume-ui.test.mjs`：同会话 shutdown 后迟到结果拒绝、旧回调不能打开选择器、reload 新编辑器可用、未知大写错误码脱敏。执行 `node --test tests/direct-session-resume-ui.test.mjs tests/direct-session-picker.test.mjs`：**6 PASS / 0 FAIL**。仅受影响定向集，不把上轮 78 项称为本轮重跑。diff 检查 PASS。
- 真实 PTY 使用现有 resume 夹具，实际输入 `/reload → /resume → 选择 target → /quit`，输出 RUNTIME_PTY_RESUME_PASS，验证正常恢复及退出持锁/释放。未调用外部模型，未更新日常安装。
- `extensions`、`packages` 内检索未发现适配器以外的 setEditorComponent/getEditorComponent 使用，但这不覆盖安装态第三方扩展。完整扩展栈归属、缺失 cwd 纠正、异常回收及候选验收仍未完成；2C/M2 不晋升。

## 2026-09-22：C05 恢复拒绝与草稿保留

- `session-resume-ui.mjs` 在实际切换前保存编辑器草稿；争锁失败或 before-switch 取消时，仅在原会话/代次仍有效的情况下恢复，不写入已失效 UI。选择器取消不动草稿，成功切换仍清空。不是失败后自动重试。
- 更新 `tests/direct-session-resume-ui.test.mjs`，增加草稿在选择取消、扩展取消、占用拒绝与成功切换的四种断言。执行 `node --test tests/direct-session-resume-ui.test.mjs tests/direct-session-picker.test.mjs`：**7 PASS / 0 FAIL**；diff 检查 PASS。未重跑全仓测试。
- `tests/fixtures/direct-runtime-pty.mjs` 增加 occupied 场景，由父进程持有目标锁。真实 PTY 输入 `/resume`，确认选中 target 后 Enter，观察 SESSION_OWNERSHIP_UNAVAILABLE，再 `/quit`，输出 **RUNTIME_PTY_OCCUPIED_PASS**。断言 target v1 字节不变、只启动 source、目标仍由原持有者占用且 source 正常退出释放；父进程最后仅释放自己创建的夹具锁。
- 草稿保留由定向测试验证，本次实体流程输入的是 /resume 而非带草稿快捷键，不混称同一证据。未改 Pi、日常安装或用户审计文档，无外部模型调用。完整扩展栈编辑器兼容、缺失 cwd 纠正、异常回收和候选验收仍待完成，2C/M2 未完成。

## 2026-09-22：缺失 cwd 纠正与阶段剩余门禁核验

- `session-admission.mjs` 增加只读 readSessionCwd；`session-runtime.mjs` 在已持目标锁、尚未进入 SDK.open/迁移之前检查目标 cwd 为实际目录。缺失目录返回 SESSION_CWD_INVALID，不将旧运行时标为生命周期不明。`session-resume-ui.mjs` 仅对此前置错误展示确认，明确选择后使用当前项目 cwdOverride；取消保留草稿，不自动重试未知失败。
- 新增运行时测试验证 v1 目标目录缺失时字节不变、原会话未 shutdown，显式纠正后可恢复；UI 测试验证拒绝只调用一次，确认才调用带 cwdOverride 的第二次。七文件相关回归 **82 PASS / 0 FAIL / 0 SKIP**：runtime、resume-ui、admission、create、selection、picker、switch。cwd 纠正的真实弹窗流程尚未执行，不标实体验收。diff 检查 PASS。
- 两个一次性默认探子分别只读定位终端接缝和扩展栈。终端仍只有 OutputDock 禁用占位，没有 xterm/node-pty 依赖和 terminal 命令合同；需在 Host contracts/server、独立终端生命周期及 OutputDock 实做，现有 RPC stop/ownership 模式可参考，不把 task 终态直接当终端退出。
- 主线程调用 resolveControlledStack/resolveDirectExtensionSet 成功核验当前受控路径及 12 个扩展入口；安装栈 Pi 0.85.1。对解析出的 permission-modes、subagents、agent-extensions 四个过滤入口及 lsp/usage 源码做编辑器/恢复注册文本检索未发现直接匹配；这不等于动态完整栈无冲突，也没有把私有适配器接入生产 launcher。
- 环境：df 显示可用空间约 2.0 GiB；项目 artifacts 总计约 18 GiB，webui-phase2 3.0 GiB、webui-phase1 6.1 GiB。未删除任何产物。完整构建/安装前需处理空间风险，不能删掉历史证据来凑验收。2C、2D 集成、2E 实做及 2F 验收仍未完成，未更新日常安装或调用外部模型。

## 2026-09-22：cwd 纠正实体流程验收

- 经用户明确授权，前轮已清理五个旧候选中的 24 个展开依赖目录，释放约 3.95 GiB，保留报告、日志、源码、归档、manifest/SBOM；46 个元数据文件哈希复核通过。清单位于仓库外 `artifacts/cleanup-2026-09-22-receipt.json`。本轮 df 实测可用约 5.8 GiB，不再沿用 2 GiB 的旧环境判断。
- `tests/fixtures/direct-runtime-pty.mjs` 增加 cwd/cwd-cancel：目标 v1 历史指向已不存在的目录；真实 `/resume` 切换 All 后选 target，在提示中确认或 Escape，再 `/quit`。最终分别输出 RUNTIME_PTY_CWD_PASS 与 RUNTIME_PTY_CWD-CANCEL_PASS。
- 确认分支验证 start 事件对应 target 且运行 cwd 为当前项目，历史头仍保留原 cwd，退出后锁可重获；取消分支验证目标字节完全不变、仅 source 启动且目标租约正常释放。首次确认场景失败是夹具错误假定 cwdOverride 会改写历史头；主线程核对公开 SessionManager.open 实现后修正断言并重跑通过，未为迎合测试改动生产语义。
- 本轮仅修改夹具/文档；语法检查与 git diff --check PASS，没有重复运行既有 82 项回归，也没有外部模型调用。下一项为完整受控 TUI 启动栈接入与交叉验收，异常恢复及 2E/2F 仍未完成；日常安装不变，2C/M2 未晋升。

## 2026-09-22：启动及导入目录前置校验

- 后续检查发现初始启动仍先 SessionManager.open 后检查目录，导入也缺少同等前置校验。统一使用 validateSessionCwd，在持锁后、SDK 迁移/复制/生命周期切换前拒绝缺失或非目录路径。
- 新增真实 SDK 回归：初始缺失目录不得迁移历史或创建运行时；导入缺失目录不得复制、迁移或关闭原会话，显式 cwdOverride 后可成功导入且源文件字节不变。
- 七文件回归命令：`node --test tests/direct-session-runtime.test.mjs tests/direct-session-resume-ui.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-picker.test.mjs tests/direct-session-switch.test.mjs`，结果 **84 PASS / 0 FAIL / 0 SKIP**。未请求外部模型。
- 改动限 session-runtime.mjs、对应测试及进度文档。普通 TUI 入口仍未接入，2C/M2 未完成；该补丁不意味着日常安装已更新。

## 2026-09-22：新会话启动接缝与完整扩展注册冲突

- 新建选择返回原始预留 SessionManager；SessionAdmissions 以对象身份验证并一次性移交，拒绝未持锁、重复消费、ID/path 改变的 manager。运行时可启动尚未保存的空会话，不重新生成 ID，也不制造空历史文件。
- 完整 12 扩展源栈 PTY 首次失败：permission-modes 与 omp-direct 同时注册 bash，Pi 拒绝加载 omp-direct。此前简化运行时证据没有覆盖此冲突，不能据其宣称完整栈兼容。
- 修复：permission-modes 继续独占 bash、维持原审批及 sandbox 包装；字节绑定的候选构建补丁将沙箱/非沙箱执行委托到 OMP BashOperations，保留撤权信号及进程组回收。omp-direct 不再注册第二个 bash，通过进程内能力握手接入；交互入口缺少适配器时拒绝继续。
- 新增 `packages/distribution/permission-shell-patch.mjs`；`runtime-patches.mjs` 对精确 2.2.0 index/sandbox 输入打补丁，私有构建预期从 2 项更新为 3 项，旧 mountpoint 所有权清理仍保留。未改 Pi 或用户全局 npm 包，未更新日常安装。
- `node tests/fixtures/permission-shell-build-probe.mjs` PASS：三项字节绑定补丁、旧 mount 清理保留、二次应用拒绝、原外部包字节不变。
- 真实 PTY：`node tests/fixtures/direct-runtime-pty.mjs quit --full-stack`、`resume --full-stack`（/fixture-resume 后 /quit）、`shell --full-stack`（/fixture-shell 后 /quit）分别 PASS。shell 实际调用唯一注册 bash，普通输出成功，后台 sleep 引发 SHELL_DESCENDANT_ACTIVE 并完成进程组回收。工具直接调用仅为隔离执行器测试，不作为模型授权闭环证据。
- 限制：源栈夹具采用临时 HOME/config 与复制后打补丁的 permission 包；OMP 编排器提示 RUNTIME_PACKAGE_BINDING_MISSING，fd 离线缺失。因此上述 PASS 仅代表扩展加载、生命周期与执行器，不代表完整编排器、候选安装或真实模型已验收。
- 12 文件回归（session runtime/resume-ui/admission/create/selection/picker/switch、shell、distribution-sandbox、launcher、omp-direct-session、m12-direct-agent-error-paths）：**123 PASS / 0 FAIL / 0 SKIP**。外部模型调用为 0。
- 2C 仍未关闭：正式 TUI bootstrap 与完整候选绑定/异常恢复仍待接入验证；2D 公开集成、2E PTY、2F 整体验收不提前开放。

## 2026-09-22：公开 SDK 候选 TUI 入口、启动 fork 与信任选择

- 新增 `packages/direct-agent/tui-runtime.mjs` / `tui-entry.mjs`，由 OMP 组合公开 SDK 服务、模型选择、生命周期与 InteractiveMode；不修改 Pi 私有字段，不在失败时退回 native main。仍为私有候选，日常 TUI launcher 未改路由。
- 模型、思考强度、名称、初始消息及工具集合在新建/恢复后保留；无法解析的模型拒绝，公开 SDK 支持的 custom model ID 保留警告而非换模型。未支持的启动模式明确拒绝。
- 共享选择器支持显式 `--fork`：复制前持源锁，目标 ID 在创建前预留；headless fork 已接入 session-entry，源历史字节不变，目标保留 parentSession。冲突和已占用源不会创建目标。
- 未知项目资源信任采用默认拒绝的真实终端选择器，可仅本次同意，不写永久信任记录；会话内 new 沿用显式选择。恢复路径传递公开 UI 信任上下文。项目资源信任不构成编程授权。
- 13 文件相关回归：`node --test tests/direct-tui-runtime.test.mjs tests/direct-session-runtime.test.mjs tests/direct-session-resume-ui.test.mjs tests/direct-session-admission.test.mjs tests/direct-session-create.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-picker.test.mjs tests/direct-session-switch.test.mjs tests/direct-shell-ownership.test.mjs tests/distribution-sandbox-ownership.test.mjs tests/direct-agent-launcher.test.mjs tests/omp-direct-session.test.mjs tests/m12-direct-agent-error-paths.test.mjs`，**135 PASS / 0 FAIL / 0 SKIP**。包含本地模拟 Provider 的真实 Pi fork 请求，不计入外部真实模型任务。
- 实际执行新入口的 PTY：`node tests/fixtures/direct-tui-entry-pty.mjs trust-no` 与 `trust-yes`，手动选择后 `/quit`，均 PASS；验证公开 session_start 信任状态、shutdown 和退出后锁可重获。
- 补齐 `--offline` 在服务初始化前设置子进程 PI_OFFLINE；新增 `offline` PTY 模式不从父进程继承该变量，仅传启动参数，退出输出 **DIRECT_TUI_ENTRY_OFFLINE_PTY_PASS**。未改变父进程或持久配置。
- 剩余门禁：完整候选绑定/编排器、启动目录纠正、其他受支持启动方式与异常恢复；@file/无持久化/RPC 尚未由新候选接入，未知跨目录 import 信任交互仍需收口。**2C/M2 未完成**；2D 公开集成、2E、2F 未冒充通过。外部模型调用 0，日常安装及用户审计文档未改。

## 2026-09-22：恢复/导入吞异常后的生命周期阻断

- 新增负例先复现：Pi 的公开 runtime 在 before-switch/shutdown 扩展回调抛错后仍创建目标运行时，OMP 原先只在返回后检查错误。两分支的 factory 次数均为 2 而非预期 1，测试 FAIL；不能以“最终抛错且仍持锁”代替“未启动目标扩展”。
- `session-runtime.mjs` 以公开 SessionManager、extensionRunner 和 factory 组合恢复步骤，在 before-switch 与 shutdown 后分别检查状态；不修改或继承 Pi 私有实现。switch/import 共用该步骤，保留取消、cwd、生命周期回调、rebind 及上下文语义。
- import 仍先持源 ID 锁，选择不覆盖目标，COPYFILE_EXCL 后验证副本身份，再迁移/切换；前置事件报错不复制，退出事件报错不加载目标扩展。并发创建目标的负例验证不会覆盖用户文件，原源字节保持不变。
- 四文件回归 `node --test tests/direct-session-runtime.test.mjs tests/direct-tui-runtime.test.mjs tests/direct-session-resume-ui.test.mjs tests/direct-session-switch.test.mjs`：**65 PASS / 0 FAIL / 0 SKIP**。这是新增补丁后的定向集，不将前述 135 项称为此次全量重跑。
- 真实 PTY `direct-runtime-pty.mjs resume`（/fixture-resume → /quit）与 `import`（/import incoming/target.jsonl → 确认 → /quit）均 PASS；验证源保留、目标生命周期、非覆盖复制与退出后锁可重获。最初简化夹具误传只有完整权限扩展才注册的 --perm，初始化失败；已按是否加载完整扩展传参并重跑，不改变生产参数校验。
- 语法检查及 git diff --check PASS。未验证该异常的完整 UI 恢复体验、完整候选/安装态，不开放 2D/2E；2C/M2 仍未完成。

## 2026-09-22：跨目录信任前置与启动目录兼容

- 恢复及 import 在旧 runner/UI 仍有效时先完成目标项目资源信任确认，再复制/迁移、关闭源会话、创建目标运行时；候选 bootstrap 缓存本次选择，拒绝只意味着不加载项目资源，不隐式授予编程权限或持久信任。
- 四种定向分支覆盖 resume/import × 同意/拒绝，检查确认时源会话仍在、历史尚未迁移、import 尚未复制、永久信任记录为空。新入口真实 PTY `import-trust-no`、`import-trust-yes` 均 PASS（/import other/target.jsonl → 确认 import → 选择信任 → /quit），目标模型/思考强度保留、源字节不变、退出后锁可重获。
- 初始恢复的缺失 cwd 现在提供默认取消的只读提示；仅明确同意时以当前目录重建，历史头原 cwd 保留。取消不迁移，入口正常释放准入锁。`cwd-no` 与 `cwd-yes` 两个新入口真实 PTY 均 PASS。
- 显式 `--session-dir` 兼容负例先 FAIL：打开外部历史时错误使用其所在目录。修复共享选择结果携带有效 sessionDir，由初始公开 SessionManager.open 接收，后续 new 保留该目录。未改变无覆盖参数时的路径推导。
- 最新五文件回归 `node --test tests/direct-tui-runtime.test.mjs tests/direct-session-runtime.test.mjs tests/direct-session-selection.test.mjs tests/direct-session-resume-ui.test.mjs tests/direct-session-picker.test.mjs`：**82 PASS / 0 FAIL / 0 SKIP**。git diff --check PASS，磁盘可用约 5.9 GiB。
- 上述关闭启动目录纠正与跨目录 import 信任交互的已知局部缺口；尚缺 @file/无持久化/RPC 等启动兼容、异常 UI/恢复及完整候选绑定与安装态。2C/M2 未完成，未更新日常安装。

## 2026-09-22：初始附件与编排器就绪证据

- 新增 `packages/direct-agent/initial-input.mjs`，不导入 Pi 私有 file-processor；文本完整读取并去 BOM、跳过空文件，图片使用公开检测/转换/缩放接口。首条消息与附件组合，后续消息保留顺序；读取失败显式报错，转换失败显示省略提示。候选 TUI 不再一律拒绝 @file。
- `tests/direct-tui-input.test.mjs` 与 bootstrap 定向测试 **19 PASS**。首次图片测试失败源于夹具 PNG 数据损坏，已用有效 CRC 的 1×1 PNG 替换后通过；未降低缩放断言或改动 SDK。
- `direct-tui-entry-pty.mjs attachment` 实际启动候选、读取 @input.txt、请求仅监听 localhost 的模拟 Provider、显示回复并 /quit，输出 **DIRECT_TUI_ENTRY_ATTACHMENT_PTY_PASS**。断言请求包含附件和首条提示、请求时持会话锁、回复保存到历史、退出后锁可重获。不是外部真实模型验收，预算使用仍为 0。
- 最终 14 文件联合回归：上一 135 项命令增加 `tests/direct-tui-input.test.mjs`，覆盖更新后的 runtime/selection/bootstrap、生命周期错误与目录/信任分支，**151 PASS / 0 FAIL / 0 SKIP**；生产及夹具语法检查、git diff --check PASS。
- 完整源扩展 PTY 夹具不再缺少编排器依赖绑定：仅复制已核验的 subagents/web-access 包及其绑定元数据到临时 config，启动前由生产解析器重新哈希校验。不复制凭据、不修改原包。记录每次 READY 与 shutdown 的 UNAVAILABLE 撤权事件。
- `direct-runtime-pty.mjs resume --full-stack` 实体恢复及退出 PASS，断言 source 和 target 每次启动均 READY、退出均撤权。首次新断言错误禁止了所有 UNAVAILABLE，经核对 `omp-control/index.ts` 的正常 shutdown 撤权语义后改为严格生命周期序列，重跑通过。
- 这关闭了隔离源栈 RUNTIME_PACKAGE_BINDING_MISSING 的测试缺口，**不等于打包候选/日常安装通过**，也未验收模型驱动的编排器任务。当前仍是 2C 开发态；无持久化/RPC、异常 UI/恢复与完整候选集成待完成，2D 公开接入、2E、2F 尚未放行。

## 2026-09-22：临时会话、RPC 候选与致命错误退出

- `SessionAdmissions.createMemory` 先预留 ID，再用公共 inMemory 创建临时会话；new/fork 保持非持久化，分支标签投影复用 Pi，源内存历史不变。无目标目录时 import 在复制/关闭前拒绝；显式 resume 可切换到已准入的持久化历史。`--no-session --fork` 拒绝，明确 ID 被占用时零初始化。
- 私有 `rpc-entry.mjs` 复用候选 bootstrap 与已准入 runtime，固定 plan/只读工具及不加载项目资源。真实子进程覆盖持久化/临时会话 × EOF/SIGTERM、新建/恢复、被占用目标拒绝且历史字节不变、启动前占用负例。尚未改日常 launcher 的 TUI/RPC 路由。
- 首轮 RPC 测试发现 Pi 0.85.1 的 runtime 回调与 RPC 命令重复 bind，产生双 session_start。新增仅用于传输层的公共 API view，使每个 session 对象的 bind 幂等；不改 Pi 文件/实例方法，不干预内部 reload。恢复每次仅一次 start 的严格断言后通过，非接受双启动为完成标准。
- runtime 致命转换错误在 action settled 后交由入口处理，避免 dispose 等待自身；TUI 先停止公开 renderer、输出固定错误码，再限时清理、非零退出。RPC 同样清理并在 stderr 输出固定诊断。任何不确认的生命周期仍留锁，死亡 owner 返回 OWNER_RECONCILIATION_REQUIRED；不按年龄或 PID 消失自动回收。
- 实体 PTY `direct-tui-entry-pty.mjs no-session`（/new → /quit）PASS；`lifecycle-error`（/new 触发 before-switch 错误）PASS，验证 shutdown、非零退出、无新历史及锁需 reconciliation。最初错误退出夹具 FAIL：Pi 原生 fatal handler 会在异步清理前直接 exit；已改为转换 settle 后等待入口退出处理，不再使用全局异常拦截。
- 四文件回归曾发生一次清理 ENOTEMPTY；残留为仅含测试数据的 config/auth.json，来源是 Provider 注册后的异步认证刷新。bootstrap 单元测试改用注入的内存 CredentialStore/models store，进程级 RPC/PTY 仍覆盖真实独立配置；未修改生产认证行为、未使用删除重试掩盖竞态。
- 最终 15 文件联合回归（上一 151 项命令增加 `tests/direct-rpc-runtime.test.mjs`）：**161 PASS / 0 FAIL / 0 SKIP**。包含 fatal disposal 非自等待测试。磁盘约 5.8 GiB 可用；外部真实模型使用仍为 0。
- 当前限制：这些是源码候选测试，不是完整打包或安装态验收。C05/C06、2C/M2 不标完成；完整栈兼容、异常 owner 核对与正式入口路由还需收口，后续仍是 2D → 2E → 2F。

## 2026-09-22：完整源码栈与正式路由接入

- 新候选入口加载 12 项完整审计扩展，真实 PTY quit、no-session（/new）、resume、resume-occupied 四项 PASS；每个启动 READY、每个 shutdown 撤权。占用目标 v1 历史保持原始字节，不触发迁移；目标历史恢复成功后可释放。
- `OMP_TEST_DIRECT_FULL_STACK=1 node --test tests/direct-rpc-runtime.test.mjs`：**7 PASS**。使用隔离的经校验依赖副本与模拟 Provider，不复制凭据，不修改用户原包；检查每个会话仅一次启动、EOF/SIGTERM 和失败留锁。
- launcher 的普通 TUI/RPC 转到新的入口，版本/导出保留工具路径，print/json 沿用已有准入入口。实际非 TTY 输入/输出按 Pi 语义识别为 headless，防止管道任务误用交互工具上限；--mode text 仍允许交互。
- Host 回归首先发现共享参数构造器意外给 Host worker 套 direct 准入的问题；增加仅内部的 runtimeOwner 区分，Host 保留自身账号入口与所有权，不新增用户参数或环境绕过。修复后 `node --test tests/host-*.test.mjs tests/project-gates-process.test.mjs`：**69 PASS / 0 FAIL / 2 SKIP**，跳过项仍是原有 scout/writer 受保护实测条件。
- 使用安装栈 Node **24.19.0** 执行前述 15 文件联合回归：**162 PASS / 0 FAIL / 0 SKIP**。这验证该 Node 下的源码与开发 SDK，不冒充新打包候选；`npm run typecheck`、语法与 diff 检查 PASS。
- 当前准备独立干净源码候选。日常安装未切换，用户 Glacier 审计文档未修改；2C 最终候选门禁及 2D–2F 仍未完成。

## 2026-09-22：2C 完整候选技术门禁通过

- 源码检查点 `9b7da336219ccfb52fa1403291ee078275e0e6b4`，独立干净 worktree 构建 Pi 0.85.1 / Node 24.19.0，完整栈 ID `sha256:3b8ba42a5b0f0dd642b5fd7e11bbcf15d75ee1de218eb49d48d42e79cf3b03af`。产物位于仓库外 `artifacts/webui-phase2/candidate-9b7da33`；构建日志保留在同级 `candidate-9b7da33-build.log`。
- `scripts/phase1-stack-rehearsal.mjs` 对此 Full 候选执行隔离安装、实际 RPC get_state/abort、回滚、同候选再应用：PASS。证据 `artifacts/webui-phase2/isolated-install-w7Th8H/rehearsal.json`。仅借用既有事务测试脚本，不把它称为整个 M2 验收。
- 通过 `OMP_TEST_STACK_PACKAGE` 和候选自带 Node 运行 `host-account-rpc-success` / `host-controlled-rpc`：7 PASS，覆盖双账号/CLI 只读引用、凭据失效不回退、审批/撤权/迟到批准、真实子任务与受管 writer/审查/真实工作区验证。服务只监听本机，外部模型预算仍为 0。
- 新夹具 `direct-test-runtime.mjs` 校验候选完整 manifest、内嵌 Node 和审计扩展集，再直接执行候选 SDK/入口，不混入源码文件、不二次修改候选。候选 `direct-rpc-runtime` 7 PASS；实体候选 TUI resume、resume-occupied、lifecycle-error 三项 PASS。占用目标字节不变；致命转换已 shutdown、非零退出、下一进程要求 reconciliation。
- Host 所有权、续接、受控任务、生命周期、手动编辑 HTTP/文件、headless 争锁、shell 后代回收 8 文件定向集：17 PASS。独立只读审查未确认 RPC 绑定/退出死锁或错误放锁问题，属于静态复核，不另计运行测试。
- **2C 技术门禁 PASS**，允许继续 2D 集成。边界：仅 OMP 受控入口参与锁；raw Pi、任意外部编辑器不受此协议约束。旧历史保守持锁到整个运行时退出；未知/失败所有者不自动回收，必须核对执行组。以上不是全 CLI 等价声明，也不代表日常安装已更新。
- 新入口直调 PTY 夹具没有注入正式 launcher 的 vendor-tools PATH，打印 fd 离线缺失提示；相关生命周期断言通过，不以该夹具证明文件查找工具。正式安装 RPC/Host 测试经过各自启动环境构造。
- 后续改动开始开放已验证候选合同下的受控 Host/手动编辑，前端通过 Host capabilities 显式选择模式，保持只读默认及审批边界。2D 浏览器收口、2E 真实终端与 2F 整体验收仍待完成。用户审计文档、日常安装、真实凭据均未改。

## 2026-09-22：2D 集成与真实浏览器定向验收

- `entry.mjs` 在已校验的 Pi 0.85.1 候选合同下启用受控能力；`server.mjs` 的快照公开 capability。`Composer.tsx` 默认只读，只有 Host 明确支持时才允许选择受控编程；切换模式不等于授权，续接不恢复旧授权。`App.tsx` 把 mode 纳入请求及幂等复用比较，失败保留草稿。沿用 Glacier 布局和样式，没有重新设计工作台。
- Ego Lite TaskSpace 10 / p1、1440×1000，使用源码 Host/WebUI + `9b7da33` 候选 worker 的隔离夹具。账号是假凭据、模型仅 localhost、项目为临时目录，未使用真实账号或用户项目。显式选择受控任务 → 待审批 → 刷新恢复审批 → 批准后写文件：PASS。夹具结束回执为 `requests: 3, proof: "browser approved\\n", stopped: true`；这 3 次是本地模拟请求，外部模型预算仍为 0。
- 受控任务仍占用项目时，编辑器进入手动模式返回 OWNERSHIP_HELD；任务结束后进入成功。Monaco 使用真实鼠标/键盘输入及 Ctrl/Cmd+S，核对临时 `example.ts` 字节确实改变。未直接修改浏览器 Monaco model 来伪造输入。
- 脏标签关闭显示确认，选择保留草稿后内容仍在；随后从外部修改夹具文件，浏览器保存返回 FILE_VERSION_CONFLICT，磁盘保持外部版本、草稿保留。确认放弃并关闭编辑器后 `/api/manual` 返回空 workspaces：PASS。首次第二次编辑因布局移动点错位置未产生脏状态，已纠正坐标并等待脏标签后重测，不计入通过证据。
- 截图保留于 `artifacts/webui-phase2/m2-editor-current.png`、`m2-control-editor-closed.png`，已查看。截图是上述开发态，不是最终安装态；本次新增模式路径只测 1440px，先前响应式证据不冒充本次全量重测。
- `npm run test:web`：21 PASS；`npm run typecheck`：PASS；`npm run build:web`：PASS（Monaco 独立大 chunk 警告保留）。后续两处说明文案更新再次通过 21 项组件测试和类型检查，未重新截图。候选 Node 24 的 `host-manual-http` PASS，覆盖 Origin/协议/配对、写锁和重启不恢复手动模式。
- **2D 开发态定向通过**，日常安装未变、最终候选待 2F。浏览器测试服务已按确切 PID 停止，夹具自行清理临时账号/项目；截图、构建及验收日志保留。

## 2026-09-22：2E 原生依赖与终端生命周期负例

- 锁定 `node-pty@1.1.0`、`@xterm/xterm@6.0.0`、`@xterm/addon-fit@0.11.0` 及 lockfile SRI；node-pty 及其 node-addon-api 纳入 bundled dependencies。不升级 Pi，不执行依赖生命周期脚本。
- scripts-disabled 安装的 darwin-arm64 spawn-helper 原始 mode 0644，真实 spawn 报 `posix_spawnp failed`。`release-payload-stager.mjs` 新增仅作用于提取后候选的校验/权限规范化：固定版本、拒绝路径重定向、设为 0755，再进行哈希和重打包；不在已校验的安装栈里补改第三方文件。
- bundled runtime smoke 增加真实 PTY `/bin/sh` 输出/退出探针，避免仅 require 原生模块即宣称可用。当前 checkout 依赖通过候选内嵌 Node 24.19.0 原生烟测；这不是包含新依赖的完整候选打包验收。
- `tests/host-pty-lifetime-probe.test.mjs` 固化反例：zsh 后台 `sleep` 的 PGID 不同于 PTY 根，disown 后杀死 PTY 根并收到 onExit，子进程身份仍存在。测试结束仅终止身份校验一致的测试 sleep，并等待退出；不操作用户进程。**负例测试 PASS 表示缺陷可复现，不是终端能力验收 PASS。**
- Node 26 下发布 stager + 反例：6 PASS；Node 24.19.0 下同集增加 manual HTTP：7 PASS。脚本禁用的 staged 权限正例、版本漂移/符号链接拒绝均通过；`git diff --check` PASS。
- 独立进程探针也观察到 disown 子进程在 PTY 关闭后变为 PPID 1、TTY `??`；因此关闭后按 TTY 查找不足。关闭前保留 supervisor、扫描 TTY/后代并核对身份可改善普通任务清理，但轮询本身不能保证发现两次采样之间主动脱离的守护进程。macOS SDK 头文件明确 NOTE_TRACK/NOTE_CHILD 自 10.5 不再支持，不能把 kqueue 当作现成的全后代跟踪能力。
- 已提出需确认的产品边界：推荐本机协作式终端，明确非沙箱、普通后台任务回收、清理未知保留锁并人工核对；若要求任意脱离进程也强隔离，需引入容器/虚拟机并调整范围。在确认前不开放真终端、不把根退出当作放锁证据。2E 与 M2 **未完成**。
- 当前 npm audit 提示 dompurify/monaco-editor、fast-uri 相关 3 个包告警，列入 F02；未执行 audit fix --force。F04/F05 已将思考强度/真实用量映射为明确验收项，仍未接通。

## 2026-09-23：2E 本机协作式终端实现与定向验证

- 用户已接受本机协作式方案：xterm + Host/node-pty，Pi RPC 保持原职责；终端为本机 shell，非沙箱。以 supervisor 保持 PTY 根，采样已确认的后代关系并记录进程身份；不凭相同 TTY 杀死未知进程。关闭先 TERM 后有界等待/KILL；只有匹配的私有清理收据才释放共享项目锁。
- `terminal-processes.mjs`、`terminal-supervisor.mjs`、`terminals.mjs` 实现生命周期；Host 重启不自动生成终端、不重放命令。旧 Host 已死、原 supervisor 已退出且收据匹配时，界面“核对清理结果”可恢复锁；缺少证据继续保留占用。后台主动逃离采样的任意守护进程不在保证范围内，协议不是防恶意用户篡改的安全隔离。
- 每项目最多一个活动终端、Host 最多四个；输出内存环限制 1,048,576 个 UTF-16 代码单元（不是字节），不落盘；输入序号及摘要防重复，未知发送结果暂停输入、不自动重试。环境采用白名单，默认 `zsh -f`，不自动加载个人 shell 配置。xterm 禁用 OSC 52 剪贴板写入。
- 原生测试覆盖真实文件/cwd/resize、环境过滤、输入重复/冲突、正常退出、disown 子进程清理、强杀 supervisor 留锁、大输出截断、Host 崩溃后凭匹配收据核对；HTTP 测试覆盖配对、Origin、协议、注入、尺寸、受控 capability 和手动模式互斥。最新 Node 26 定向结果 7 PASS；最终 Node 24.19.0 运行 terminal/HTTP/manual/ownership/lifecycle 五文件联合 **12 PASS / 0 FAIL / 0 SKIP**。
- 前端 22 项组件测试、类型检查、构建通过。独立终端 chunk 约 336KB（gzip 85KB）；Monaco 大 chunk 提示仍保留。修正原型 `.terminal` 样式与 xterm 同名类冲突，沿用 Glacier 视觉。
- Ego Lite TaskSpace 2/p1，隔离源码 Host/WebUI + 已有 Node 24/Pi 0.85.1 候选 worker，本地假账号/模拟模型，真实外部模型调用 0。真实键盘输入落盘 `terminal-proof.txt`，中断前台 sleep、刷新恢复同一 terminalId、隐藏后重新显示、disown 后关闭确认及子进程消失全部通过；390×844 活动终端输入 `mobile-ok`，页面无水平溢出。截图 `artifacts/webui-phase2/terminal-mobile-active.png` 已查看。终端关闭后界面显示已释放占用。
- 这些结果是开发态定向证据，日常安装未变；最终候选尚不包含本轮终端代码。F04/F05、2F 仍待完成，M2 不标完成。用户已有 Glacier 审计文档改动未纳入本轮提交。

## 2026-09-23：F04/F05 开发态接入

- F04：Pi 模型目录通过已安装 SDK 的 `getSupportedThinkingLevels` 报告能力；WebUI 只展示当前模型支持的选项。任务请求把 `thinkingLevel` 纳入幂等摘要，Host 启动 RPC 后调用 `set_thinking_level`，再 `get_state` 回读；若实际值与请求不一致，任务失败并保持可诊断，不接受 SDK 静默降级。调用不使用 `persist`，不会改 CLI 默认。
- F05：Host 从 assistant `message_end` 的真实 `usage` 回执聚合请求数、工具数、输入/输出/cache token 和 SDK 目录费用估算；没有回执或全零回执保持未知。范围是当前任务，不把历史会话或字符数换算为 token，不把模型目录费用称为账单。用量回执可部分到达，UI 同时显示已报告数量。
- `tests/host-usage.test.mjs` 覆盖缺失/零值保持未知、真实非零回执聚合和零价格不计费；`npm run test:web` **22 PASS**；`npm run typecheck` PASS；Host 相关账号/RPC/任务回归 11 PASS，终端/HTTP/手动/所有权/生命周期 12 PASS。F04 的候选内置 Node 24 全量实际生效仍需在 2F 夹具中补一条可用 reasoning 模型证据。
- F04/F05 是开发态实现，最终候选尚未重新构建，2F 性能、安全、安装晋升仍待完成；M2 不标完成。

### F04/F05 边界补齐与 2F 安全收口

- 补齐下一任务选择与上一任务实际强度的分离、账号变化重置、失败请求复用比较强度、恢复默认按钮和 Pi `max` 能力。发现 Pi 的 `compat` 子路径只有 ESM export，`require.resolve` 会让模型目录失败；改用所绑定 SDK 的实际包位置及公开 ESM export 解析。新增真实目录/请求测试覆盖此路径。
- 真实 Pi RPC + 本地 SSE 验证 `reasoning_effort: low` 进入请求、续接保持 low、响应 120 token（输入 70、输出 20、缓存读 30）正确归一化；源码 Host 对照旧完整候选 Pi 的 Node 24 定向 **6 PASS**。Host 层另验证不支持拒绝、实际强度不符时不发送 prompt、幂等冲突与重启保留用量。
- Ego Lite TaskSpace 2/p1，1440×1000，源码 Host/WebUI + Node 24/Pi 0.85.1 候选 worker：选择 low → 发送 → 用量面板显示实际低、120 token/70 输入/20 输出/30 缓存读，费用未知，PASS。截图 `artifacts/webui-phase2/m2-metrics-desktop.png` 已查看。UI 以模型回合计数，不宣称 HTTP 重试次数；部分用量和部分价格有明确标识，不含子代理或历史轮次。
- WebUI **24 PASS**、typecheck/build PASS。Host 全集首次 **77 PASS / 1 FAIL / 2 SKIP**，唯一失败是故障测试清理空闲 shell 时进程已自行退出导致 ESRCH；收敛测试清理的已退出分支，终端 6 项再跑全部 PASS。保护式 scout/writer 两项仍按既有条件跳过，不冒充实测。
- F02 依赖：Monaco 0.56.0 固定 DOMPurify 3.4.8，定向 override 到 3.4.13；Ajv 的兼容传递依赖 fast-uri 锁到 3.1.8。仅更新这两条 lock 记录，不升级 Pi/Monaco，不运行 install scripts。当前根依赖树 `npm audit` **0 vulnerabilities**，这不是外部完整发行栈所有依赖的独立安全认证。依据：[DOMPurify 官方公告](https://github.com/cure53/DOMPurify/security/advisories/GHSA-55q2-fjhq-7xh7)、[fast-uri 官方公告](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc)。

## 2026-09-23：2F 候选、性能与安装回归

- 候选源码检查点 `bb4111ef59278105f3c28a9ccb597c4c3343a534`，完整候选位于仓库外 `artifacts/webui-phase2/candidate-bb4111e`，构建日志同名保存；候选 Pi **0.85.1**、嵌入式 Node **24.19.0**，stack ID `sha256:2459d86c65820a7fc82e38b927e764f65d15ed92f777396907b95d6bd7279d77`。
- `phase1-stack-rehearsal.mjs` 对候选完整 payload 执行安装、版本/真实 RPC、回滚、同候选再应用：**PASS**。回执 `artifacts/webui-phase2/isolated-install-s4S26k/rehearsal.json`；安装验证没有写入用户日常目录，外部模型调用 0。
- 候选嵌入 Node 24 运行账号/模型目录、真实账号 RPC、思考强度、用量、终端生命周期与终端 HTTP 集：**13 PASS / 0 FAIL**。曾用错误 packageRoot 跑出 1 个 harness 错误，修正到候选安装的 `only-my-pi/package` 后完整通过；错误不属于产品失败。
- 性能夹具 `artifacts/webui-phase2/perf-bb4111e/web-fixture-r6NVtq/startup.json` 创建了含 10,000 条历史记录、5 MiB 工具输出、3,000 行文件的样本；Node 24 arm64 Host 初始索引 **56.0 ms**、单 Host 进程 RSS **109,051,904 bytes（约 104 MiB）**、模型请求 0。该初始化样本尚未完成浏览器输入/取消 P95、进程树 RSS 或长 diff 渲染验收；文件存在不等于 diff 已渲染，不能据此给 F01 PASS。
- 依赖检查、WebUI 24 项、typecheck、build 通过；最终 Node 24 Host/release 联合集 **78 PASS / 0 FAIL / 2 SKIP**，保护式 scout/writer 跳过项不计实测。构建仍有 Monaco 3.8 MiB 独立 chunk 的既有提示。候选 13 项集使用源码 Host 测试 + 候选 Node/Pi/扩展；终端管理器不是从打包产物导入，不能将它们描述为全部安装态终端测试。
- **M2 阶段状态：2F 部分通过，阶段未完成。** 尚需输入/取消 P95、进程树内存、长 diff 与大输出实际页面验证、完整安装态 GUI/PTY、真实 Provider 限额内矩阵；日常安装未切换。既有计划已授权三项小型真实任务及一次失败重试，无需重复批准同一范围；先核实可用路由和活动进程。不得提前进入 M3。
- 窄屏测试确认页面宽度 390，无横向溢出，但点击用量入口未完成：原右侧面板在宽度变化后成为覆盖层；尚未凭截图确认原因，不能将其直接归因于测试脚本。前一条“2F 技术门禁通过”结论已在以上记录中纠正。

### 2F 安装态实测与门禁纠正（本轮后续）

- 新增 `tests/host-installed-runtime.test.mjs`，直接从 bb4111e 安装包导入 Host/ownership，使用同栈 Node 24：真实 PTY 文件写入、持锁和关闭释放 PASS。首次因测试 after 钩子先删目录再 stop 失败，修正清理顺序后 1 PASS；不修改生产锁保护。新增树内存/关闭耗时记录后再跑 1 PASS。
- 完整候选 SDK/扩展 approve、revoke、late、ordinary、scout、writer 六场景均通过本地模拟服务；此前的两项 SKIP 现有独立实测，原 78/2 记录仍保留其原始口径。
- 性能夹具可导入安装 Host/UI，并实际生成长 diff。Ego Lite 空间 3：10,000 历史首两页各 50 条、5MiB 工具输出分段、174,318 字符 diff、390px 正确用量弹窗通过。确认窄屏覆盖来自打开的项目面板，关闭后按钮可操作。
- 安装态 xterm 原生输入写入 `installed-ui-ok`，刷新保持同一 terminalId，结束清理释放 PASS；Monaco 进入手动模式、实际编辑为 `installed-ui-ok-edited`、保存落盘及关闭释放 PASS。均在隔离测试项目。
- 取消点击至“正在取消” DOM 确认 30 次 P95 **2.4ms**。Host+真实 PTY 树 RSS 样本 **244,449,280 bytes**，含测试开销；空闲 PTY 关闭 **1,365ms**，不是 P95。实际进程树和界面确认不混用。
- 输入首帧 30 次前台样本 P95 **973.8ms**，未通过100ms门槛。相同 Ego 环境下空白原生输入框也复现约1秒延迟，指向绘制/节流条件但根因未定；不能用 JS 处理快代替回显通过，也未换浏览器绕过。
- 当前有效 `LOCAL_HOME/.pi/agent` 无环境覆盖，GUI 账号0、CLI只读模型目录0；已询问可用已有账号/配置路径，不读取秘密。真实任务预算仍0/3、重试0/1。完整冷启动/真实模型执行树与日常晋升待完成。
- 详细证据和下一步见 [候选验收记录](2026-09-23-omp-webui-phase2-candidate-acceptance.md)。**M2 继续 IN_PROGRESS，不提前进入 M3。**

### 2F CLI 静态凭据修复、新候选与 CPAR 真实验收

- 上述“CLI 目录0”已定位为兼容缺陷：Host 准入只认 auth.json，漏掉 CLI models.json 的显式静态 Key。`9130d0259bb53a82f8af290c994dc31fbdd8e028` 增加共享检查，覆盖目录、主 RPC 和子任务；只为 CLI 加入 Pi 公共状态 `models_json_key`，GUI 不借 CLI，环境/命令型 Key 不新增准入。真实配置目录恢复9模型，无目录探测推理请求。
- 本地身份回归5 PASS；同 Provider实际请求、401不换身份、GUI隔离、配置不改写、静态Key移除后新任务拒绝已覆盖。Pi静态配置按worker生命周期加载，本次不声称外部删Key热撤销已运行worker。
- 新完整候选：Pi0.85.1、Node24.19.0；stack `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。安装根 `isolated-install-d8iuXc`，安装/回滚/再应用PASS；账号、完整受控扩展和安装Host/PTY联合12 PASS / 0 FAIL / 0 SKIP。构建器首次拒绝短SHA，改为完整SHA后通过，没有跳过检查。
- 依既有清理授权，仅清理无进程使用的旧9b7da33构建内容、干净源码worktree及旧隔离安装的`.local`；日志、收据、manifest/ledger和`.pi`保留。回执 `retained-9b7da33/cleanup.json`。未清理当前候选或用户项目文件。
- Ego空间3的持续采集条件下，长历史/大输出/diff页面30次输入双rAF **P95 26.2ms**，空白原生输入 **6.3ms**；无采集条件仍约1秒。这是调度条件对照，未关闭普通前台输入门禁，不将双rAF声称为物理屏幕呈现时间。
- 追加前台核验：将 Ego Lite 置于 macOS 系统前台并确认页面可见/聚焦后，无采集输入仍 **P95 917.2ms、最大1876.4ms**（`perf-9130d02/input-frontmost-no-capture.json`）。因此已排除 ChatGPT 前台这一干扰；持续 Screencast 改变绘制节奏的事实仍保留，根因暂不能归咎 React。性能夹具已停止，F01不放行。
- 用户选择现有CPAR路由；临时GUI账号通过公共认证接口创建，安装页面选择`cpar-grok-build/grok-4.5`/low执行小型修改。Pi回读low后返回 **503 CredentialUnavailable: no credential is available**，任务失败，无审批/工具/写入，proof.txt仍为before。截图已查看；真实用量未知，成功执行/受管writer/撤权取消未验收。
- 真实任务阶段累计 **1/3，失败重试0/1**。关闭自动重试，不自动改Provider；待CPAR恢复后用保留的失败重试和2个剩余小任务完成原矩阵。脚本重启不能重置阶段额度。
- 新进程到安装Host就绪和配对 **4075.7ms**，不含首屏或OS缓存清理；Host+真实worker每2秒采样峰值 **436240384 bytes（约416MiB）**，不含共享浏览器。Full解包占用616062976bytes，相对bb4111e增加4096bytes；压缩更新下载量仍未测。
- 测试Host均已停止；临时凭据副本删除且扫描无残留，原CLI models.json摘要一致；未更改CPAR服务或日常安装。详见候选验收记录及 `live-cpar-9130d02/report.json`。**M2仍IN_PROGRESS：外部路由和普通绘制条件未解决，不晋升、不进入M3。**

## 2026-09-24：CPAR 修复后真实重试与配置阻断定位

- 用户告知 CPAR 已修复，沿用9130d02安装候选和已选 `cpar-grok-build/grok-4.5`，Ego Lite空间3，low思考强度，在合成临时项目重试原小型修改。返回 **400 ClientRequestError**，审批/工具均0、proof.txt保持before；全零usage仍为未知。未换路由或关闭思考绕过验收。
- 阶段累计 **任务1/3、失败重试1/1**。其余两个小任务仍用于受管写入、撤权/取消；再次重做失败项需要新增授权，脚本重启不重置额度。证据 `live-cpar-sep24/report.json`、`retry-result.json`、已查看的`failed-retry.png`。
- 只读核对 CPAR 运行二进制SHA与3a8e5af部署收据一致；对应生产请求记录为ClientRequestError。只读查询当前配置，Grok Build / grok-4.5 / canonical_bridge候选仍含 `{"allow_unlisted_model":true,"reasoning":false}`，没有查询凭据表。
- 同一安装候选、假Key、localhost端点捕获一次完整合成请求；包含low、summary:auto、encrypted_content include、cache key与当前六个工具。修复后的CPAR源码离线解析/投影/Build编解码均PASS，语义保持；去掉Reasoning能力后确定性复现ReasoningUnsupported。生产没有该debug枚举日志，因此该定位依据配置+代码+离线反例，不假称读取到具体生产拒绝原因；解除后仍可能存在后续上游问题。
- 建议通过CPAR正常草稿/验证/激活流程移除目标candidate的reasoning:false。需先核实Chat兼容范围，因为恢复Reasoning会触发该网关对Chat→Reasoning目标的拒绝；不得直接改SQLite或随意增加候选。具体差异、范围、授权和回滚前提见[复测报告](2026-09-24-omp-cpar-retest.md)。
- 测试Host已停止，临时凭据和配对清单删除，扫描无泄漏，原CLI配置摘要一致。保留合成项目和证据；未改产品源码、CPAR源码/生产配置、日常安装或全局设置。M2继续IN_PROGRESS，F01普通绘制门禁未变化。

## 2026-09-25：CPAR 配置修复生效，定位多轮 reasoning 输入缺口

- 用户再次要求修复后继续检查；明确按本次请求追加一次有界重试，不重置原额度。只读核对生产活动配置为production-grok-reasoning-20260925 rev1，Build候选reasoning:false已移除，运行二进制SHA仍匹配3a8e5af。未修改CPAR生产。
- 同9130d02安装候选、Pi0.85.1、Node24.19.0，Ego Lite原空间3/p1，临时GUI账号与合成项目，CPAR Grok4.5/low。14:58:18发起原小型任务，真实request_coding_access卡出现；范围仅proof.txt、simple、无委派。页面批准后工具结果成功，首轮3209输入+176输出=3385 token，费用未知。
- 批准后的第二轮返回400 ClientRequestError，未执行write/read，proof.txt仍为before。Host显示任务失败和不保留授权，页面显示2模型回合、1工具、部分用量回执；不是完整写入验收成功。服务端同窗口首轮attempt succeeded；未发现第二轮结构化request事件。
- 同安装SDK利用合成验收历史离线重建续接请求，onPayload中止且fetch计数0，发现input含reasoning条目（content为reasoning_text，本次无encrypted_content）。CPAR decode_input_item在入口不接纳该type，发生在request context创建之前。完整重建与全合成最小样本均拒绝；各自仅删除reasoning条目的诊断副本均通过解析、投影、Build编解码。未将删历史用于产品绕过。
- 新阻断归CPAR多轮Responses兼容：需保留reasoning输入并覆盖两轮工具往返、未知字段/边界和跨协议拒绝。精确入口路径、样本、范围与限制见[多轮复测报告](2026-09-25-omp-cpar-continuation-retest.md)。本轮未改双方产品源码，不将CPAR此前单轮canary充作完整Agent验收。
- 累计任务1/3、失败重试2/2（原1+本次追加1）；两项新任务仍未使用，失败即停。测试Host停止，临时凭据及配对清单删除，扫描53文件无Key泄漏，CLI配置摘要一致，证据见live-cpar-sep25/cleanup.json。Ego更新仅提示、未执行；F01输入绘制仍未解决。M2保持IN_PROGRESS。

## 2026-09-25 晚：CPAR Agent 修复后真实续接仍受阻

- 用户再次告知CPAR已修复，按本次要求追加一次有界失败重试，累计任务1/3、重试3/3（原1+两次追加各1）。原2个新任务保留，不用新任务额度覆盖失败项。
- 只读核对运行二进制SHA为653659534f7f83d7e2ab54e8834c90e07eef55a9158ba17f11d42b47653a867c，匹配f4ebf4d部署；活动reasoning配置保持生效。9130d02安装候选、Node24.19.0/Pi0.85.1、Ego原空间3、CPAR Grok4.5/low、临时账号与合成项目均保持。
- 21:06:56–21:07:26实际发起原任务，request_coding_access批准成功；第二轮HTTP502 ProviderPermanent，无write/read，proof.txt仍为before。首轮总3369token（输入3084+输出157+cacheRead128），部分回执、费用未知。
- 第二轮request_id为p1-request-dfc70894ca60504883adeea4d1729128-1；CPAR日志确认request与attempt failed/provider/non_retryable，不再是入口400。现有日志缺少上游HTTP状态和错误字段，不能从客户端502推断上游状态或具体字段根因。
- 使用同安装SDK离线重建续接历史，网络调用0；与部署相同crates源码对完整重建和全合成最小样本均完成入口/投影/Build往返并保留reasoning，PASS。该证据只证明本地合同，不代替真实上游接受。后续先补有界脱敏上游诊断、按证实差异修复，再授权原任务重试。
- Host与测试进程已停止，临时凭据和配对清单移除；扫描52文件无Key泄漏，原CLI配置摘要一致。详细证据在live-cpar-agent-sep25及[最新报告](2026-09-25-omp-cpar-agent-retest.md)。本轮只更新文档与仓库外夹具，未改双方产品、生产服务、日常安装或全局设置；用户Glacier审计改动保留。F01普通绘制门禁独立未解，M2仍IN_PROGRESS。

## 2026-09-26：CPAR 真实多轮成功、writer 收据与取消验收

- CPAR生产4d5ce33、二进制45786a8649720cd513eee09ae86fcab7a0ac2eadd0a2e836446a925562e6f055已只读核对；修复native reasoning回放summary数组后，OMP小型修改实际批准→write→read→成功，4轮3工具15774token，SIMPLE_OK字节正确。4个CPAR请求均有成功日志，不再以此前502作为当前阻断。
- 用户批准替代已不存在的Ego空间3，新建空间2/p1完成安装页面验收。OMP仍为9130d02、Pi0.85.1、Node24.19.0，选定CPAR Grok4.5/low，未换身份/路由。
- writer首次Connection error，无审批/工具/写入；未知根因，healthz200不能证明可用或未计费。用户明确“追加一次并继续”后重试。1个writer和1个fresh reviewer完成，WRITER_PATCH_VERIFIED，scope仅proof.txt；副本gate40ms、真实gate38ms均PASS/exit0，文件精确MANAGED_OK换行。
- 验收脚本在第5轮最终回复时同步递归cancel，RangeError后Host退出。会话有最终stop，原报告仍running/4轮17784token，真实Host/页面成功终态未验收。只读重建完整5轮23869token，子任务累计19730token，费用未知；不覆盖原报告。重试提示来自200字符公开摘要，实际完整审批计划核对通过，不称相同提示重放。
- 仓库外脚本修复：取消先记一次、延迟执行，区分上限处stop和toolUse；安装Host离线回放正常5轮成功/继续工具只取消一次/双锁释放，以及重入、错误测试共4 PASS，零模型调用。首轮1个失败为替身过早agent_settled，修正后通过，原日志保留。未改产品代码，未再跑真实writer。
- 原剩余取消任务：批准后撤权确认，在模型续接期间取消，Host cancelled、worker退出、双锁重获、迟到审批409；proof保持MANAGED_OK。点击至观察终态1112.6ms为单样本且含自动化等待，不是本地确认P95。等待文本误匹配prompt里的bash，实际没有开始shell，不能宣称运行中bash取消通过。2轮仅1份有效回执3510token。
- 累计阶段任务3/3、重试5/5（原1+三次修复后各追加1+本次writer1），无剩余额度。临时Host/worker退出、凭据与配对文件删除、扫描无Key残留；simple/cancel原CLI摘要一致，writer异常没有前后摘要核验。writer孤儿锁和证据保留，未伪造正常释放；Ego专用空间已关闭。
- 本轮只更新验收夹具、计划和报告，未晋升日常安装。M2继续IN_PROGRESS：下一优先F01普通输入绘制，其次资源/更新指标及writer真实终态补证；额外模型复测必须有新增额度。详见[完整验收](2026-09-26-omp-cpar-real-acceptance.md)。

## 2026-09-26：F01 普通窗口输入验收通过

- 继续使用9130d02安装Host/UI和Node24.19.0，Ego已为0.5.1.13。本轮新建专用空间3/p1，10,000历史、5MiB工具输出首段65,536字符、174,318字符diff，零真实模型请求。
- 原条件仍复现双rAF P95 999.9ms；应用激活后第二组1976.6ms且前台应用检查不一致。CUA原生核验发现Ego窗口实际仍展示其他空间，page active/visible/focused不足以证明用户正常看见目标页。空间概览中的38.4ms诊断样本也没有用于放行。
- 将同一空间通过Ego原生“在新窗口中打开空间”显示，核对正常窗口后，OMP→空白页→OMP三组各30样本，双rAF P95 **8.4/10.9/9.1ms**；正常OMP首帧P95 **1.7/2.3ms**，Event Timing keydown P95均24ms。无采集、无尺寸模拟，保留原100ms门槛；测量不等于物理屏幕像素呈现。
- F01输入项按本机当前安装候选和分页/分段负载PASS。已知问题是此前显示前置条件核验不足；没有声称定位Chromium内部机制或所有旧慢样本同源，也未猜测性修改React或全局节流配置。
- 新增 `scripts/browser-input-benchmark.mjs`，代码与本轮已实测的采样函数相同，保存完整样本与nearest-rank P95并拒绝覆盖证据。语法、文档链接及diff检查通过；产品代码未改，未重跑无关全量套件。
- `perf-sep26/`保留全部慢/快样本、页面状态、浏览器版本、已查看截图及清理收据；Host72857退出，配对清单删除，专用Ego空间正常结束，合成项目保留。真实预算仍3/3、重试5/5。
- 下一项：完整应用资源口径与最终更新下载量；writer真实Host/页面终态另待补证。M2保持IN_PROGRESS，日常安装未晋升。详见[本轮报告](2026-09-26-omp-input-performance-acceptance.md)。


## 2026-09-26：资源口径与 Full 更新包体补齐

- 新增 `scripts/measure-stack-transfer.mjs`，复用正式确定性tar/gzip、下载字节校验、安全解包和组件身份检查；本地离线测量，不制造release index或受保护验收回执。9130d02 Full为151,164,714bytes（144.16MiB），37,548条目，回放/解包后身份PASS。Thin18,530,154bytes仅包体对照，未验收私有栈现场重建和完整依赖下载。
- M1 ac5761e同函数重打包为115,465,257bytes，SHA与9月20日历史归档一致；M2增加35,699,457bytes（30.92%）。解包增量主要在OMP依赖：node-pty65,003,520bytes；WebUI dist由446,464增至5,926,912bytes。不裁包、不改产品候选。当前仍Full整包事务，本地已有候选切换新增网络0，远端整包正文为144.16MiB，metadata/HTTP/TLS/重试未计。
- 新增 `scripts/measure-process-resources.mjs`，只读pid/ppid/rss/comm，不记录argv/env。安装Host、7种Ego页面状态各20次/约10秒，共140个资源组合样本；Host树与共享Ego16进程组分列，V8目标堆另列，不相加为独占OMP成本。资源记录MEASURED，无内存硬阈值或跨设备SLA。
- 长历史/输出首段/174318字符diff时Host树样本峰值104.72MiB；Monaco目标V8堆16.96MiB；真实PTY树峰值123.14MiB。Ego整体853.45–1024.45MiB包含用户其他空间，不可据场景差值判断OMP净开销。RSS会重复计算共享页，V8可能保留旧文档，不据短采样声称没有泄漏。
- 实际xterm输入将RESOURCE_PTY_OK写入合成项目；结束确认后supervisor77522、shell77525退出，20个后续样本树回到Host一进程，项目锁重新获取/释放PASS。一次点击到观察结束1510.3ms含自动化等待，不是本地取消P95。截图已查看；Host76929正常退出、Ego空间4已finish、配对清单删除。
- 既有真实CPAR成功/受管writer/取消报告重新读取，Host+worker采样峰值分别495.31/524.36/485.30MiB；不含浏览器，不拼为同时峰值。完整入口启动4075.7ms沿用明确范围的已有证据，夹具54.5ms初始化不替代完整启动。
- 辅助函数真实子进程/RSS汇总/边界/缺失Host检查PASS；两个新增脚本语法检查通过，产品未改，未跑无关全量测试。证据在resources-sep26与resources-sep26-transfer，见[完整报告](2026-09-26-omp-resource-transfer-acceptance.md)。
- 下一优先writer真实Host/页面成功终态，需明确追加一次有界复测额度；阶段预算仍任务3/3、重试5/5，本轮新增模型0。运行中shell取消仍未由本轮空闲PTY关闭覆盖。M2保持IN_PROGRESS，日常安装未晋升，保留原有Glacier审计改动。
