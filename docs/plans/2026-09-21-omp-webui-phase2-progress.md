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
