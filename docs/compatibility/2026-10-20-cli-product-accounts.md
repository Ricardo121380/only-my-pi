# CLIENT-01A / #78 CLI 产品账号验收

状态：账号基础和账号 OAuth 已实现，C/P/B 的实际入口验证已形成；最终完整回归、独立评审和远程合并门槛仍需按下方记录完成。范围为 GCLIENT-01 的账号基础和账号 OAuth；MCP、共享设置、会话发现和交接分别由 #79–#83 承担。使用方法见 [CLI 账号指南](../cli-accounts.md)。

开工基线为公开 `main@6b2cf19f834f18fad0965e6ce925b7ef291f119a`，工作区和暂存区干净。使用 Node 24.19.0、精确 Pi 1.3.0 以及当前 manifest/lock。私有开发分支与历史候选不作为本次 PASS。原 #21/#23 材料阻断保持。

## AC 与验证边界

| AC | 必须交付的用户结果 | API Key / OAuth 路径及证据 | 当前状态 |
| --- | --- | --- | --- |
| 1 | 无 GUI/Host，独立新增、设置服务模型、认证、列出、显式调用；原配置保留 | `cli-product-accounts`、`cli-account-pi`、`cli-account-oauth`、两种 `cli-account-terminal` 路径（C/P） | PASS，本地受控范围 |
| 2 | 同 Provider 多身份、错误账号/凭据拒绝、无 fallback、秘密隔离 | 同 Provider 的两个 API Key 身份及两个 OAuth 身份；不存在/缺失/失效/错误模型、环境凭据和错误响应回显负例（C/P） | PASS，本地受控范围 |
| 3 | 真实进程之间协调使用与变更，未确认退出保留占用 | `account-process-coordination` 的真实进程/存活子进程组；Ego 双向 API Key/OAuth 使用与四种变更竞争（C/P/B） | PASS，本地受控范围 |
| 4 | CLI 与 GUI 共用账号状态，新调用绑定正确，原目录和历史保留 | Ego 读取两种 CLI 账号与 stored 状态；正式 CLI 调用两个 GUI 账号；原认证及五份既有真实 Pi JSONL 的摘要/权限不变（P/B） | PASS，本地受控范围 |
| 5 | 两条完整路径由实际 CLI/PTY、真实 Pi、受控服务共同证明 | 两种认证分别从空产品配置开始；PTY 从 Inspect 经单独批准到实际工具写文件，各三次模型接收；Ego 独立回读（P/B） | PASS，本地受控范围 |
| 6 | 复用 Pi 公开认证与产品账号存储，形成设置到调用完整路径 | 现有 AccountCatalog、AccountAuth、AccountOAuth 与 Pi ModelRuntime；真实 OpenRouter PKCE/loopback 回调，模型请求仍由真实 Pi 产生（C/P） | PASS，本地受控范围 |
| 7 | OAuth 取消/超时/重复及过期答复/失效/撤销和登录竞争正确 | 实际 CLI 登录取消/超时、重复/迟到回调、服务撤销；GUI/CLI 登录期间另一端使用和变更被拒绝，取消重新登录保留原身份（C/P/B） | PASS，本地受控范围 |
| 8 | 秘密和回调隔离，认证不授予编程或工具权限 | 隐藏终端/stdin；终端、请求正文、JSONL 与普通输出检查；原生 /login、/logout 拒绝绕过；单独编程批准前无工具写入（C/P） | PASS，本地受控范围 |
| 9 | 真实 CLI/PTY OAuth 到真实 Pi，GUI 状态一致 | 实际 Pi OAuth 实现、独立受控授权/交换/模型接收服务，实际 Ego 回读；替身测试单列（P/B） | PASS，本地受控范围 |
| 10 | 同一源码和运行身份的 C/P/B、独立评审及适用回归 | 下方源码/运行身份、完整回归、Linux 范围、Standards/Spec、PR CI 分列 | 待最终门槛 |

## 运行身份和受控边界

- 开工主线：`6b2cf19f834f18fad0965e6ce925b7ef291f119a`；功能分支 `codex/feat/cli-product-accounts`。最终提交与隔离回归身份在收口记录中冻结。
- Node：`v24.19.0`，macOS arm64 可执行文件 SHA-256 `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`。仅在本轮局部 PATH 选择，不更改全局 Node。
- Pi：精确 `1.3.0`；原 SDK 入口 SHA-256 `4569157e6038be9840fa514db4b00a27fd0be9e3622cc7b49a281de6c027d7ff`；manifest SHA-256 `83c3bb7619f590c213cc96a24216eb29a819a3ef6dc548607cc037ed276e8dc5`。
- 根 manifest SHA-256 `014f527f0cb00ac9c0bfd11992d9118f7cc6c265e25eec05d8f666b708843d92`；lock SHA-256 `3e71a355116a7243519565feb72b838b4761aeb3dd3d2eda43610a77a0e83a3f`。依赖来自当前 lock 与 `test:prepare`，未借用用户 Pi HOME。
- 真实 Pi 的 OAuth 实现、PKCE、回调及凭据存储保持原实现。测试传输入口将内置 OpenRouter token 交换 URL 定向到独立 loopback 服务，并拒绝其他外部地址；它不是外部 OpenRouter 验收。传输入口及原 SDK 分别保存摘要。
- P 使用复制到隔离运行栈的正式 `bin/omp.mjs`、真实 Pi 与实际安装的外部扩展；B 使用相同核心源码的开发 Host 和生产 WebUI 构建，不是 Vite 开发服务器、产品 Full 候选或日常安装。每份原始回执分别记录源码文件、运行栈、命令、真实 PID、退出码及接收结果。

## 证据层次

**C：合同与拒绝路径。** `host-account-catalog`、`host-account-auth`、`host-account-oauth`、`host-auth-process`、`host-task-binding` 与模型能力协调测试覆盖存储归属、认证状态、跨进程预占、仍运行父进程的认证恢复及 worker 退出。`stored_sync_failed` 与 `removed_sync_failed` 单独返回；OAuth 终态必须等到真实认证工作和变更占用清理完成，不能先显示 stored 再释放占用。替身回调/同步失败测试属于 C，不冒充真实 OAuth。

**P：正式 CLI/PTY → 真实 Pi。** `cli-account-pi.test.mjs`、`cli-account-oauth.test.mjs` 和 `cli-account-terminal.test.mjs` 从隔离空产品配置新增、配置服务模型、隐藏认证、查询、列出并显式执行。API Key 与 OAuth 的真实 PTY 各完成三次受控模型接收及一次批准后的文件写入；登录和 Inspect 本身没有授予写权限。原生 `/login`、`/logout` 返回受控拒绝，原凭据保持。错误服务响应即使回显凭据，也不会把秘密写进普通错误和历史。账号、错误模型、缺失凭据及隐含环境凭据均不得触发其他账号调用。新历史含非秘密 `omp-account-binding`；省略显式账号继续产品历史返回 `ACCOUNT_SELECTION_REQUIRED`。

**真实进程协调。** 共享磁盘预占协调读取使用与排他变更，短 metadata 写锁仅负责事务，不能代替活动预占。C 的真实进程测试覆盖父进程崩溃后仍活着的登记子进程组：此时变更继续拒绝，直到所有使用者确认退出。P 的 `cli-account-crash.test.mjs` 另从正式 CLI 新增/认证账号，再暂停实际 Pi，确认四种变更拒绝，强杀并独立确认 PID 消失和接收连接关闭后，才允许变更与相同身份重新调用。OAuth 进一步暂停真实认证 worker 后强杀其 CLI 父进程：另一正式 CLI 的使用及四种变更仍拒绝；独立源码 Host 的正常启动确认清理孤儿，迟到回调拒绝，原凭据保留，再从正式 CLI 完成重新 OAuth 登录和正确身份调用。此 Host 是真实独立源码进程的恢复路径，不作为已安装候选或 GUI 渲染证据。两种正式崩溃路径各自通过。身份不明或 PID 复用保留 `ACCOUNT_RECONCILIATION_REQUIRED`。正常退出、取消以及恢复后才可重新变更。

**B：Ego Lite 实际图形端。** 同一 TaskSpace 的实际页面操作完成两个 GUI 账号的创建、服务/模型配置、API Key/OAuth 登录；回读 CLI 创建的两种账号及 stored 状态。四个独立账号的正式 CLI 调用分别由独立接收端确认身份。随后 API Key/OAuth 各覆盖 GUI 使用→另一 CLI 的改名/删除/登出/登录拒绝，以及 CLI 使用→GUI 的对应四种拒绝。GUI 取消后接收连接归零，再允许另一个真实进程变更；CLI 退出亦保留实际进程与接收端关闭证据。GUI OAuth 登录期间另一 CLI 的调用和四种变更全部拒绝；独立 CLI 登录期间 GUI 使用与变更拒绝且接收次数不增。取消重新登录后原凭据和身份保留。Host 启动没有终止仍合法存活的独立 CLI 登录。实际图像检查确认账号列表、认证状态和可见焦点。

B epoch 共十次受控模型接收、两次原生 OAuth 交换；其中含正常完成、取消与超时观察，不能把十次都当成功调用。收口时接收连接为零，Host 和 CLI 均退出；原认证、目录及五份先前完成的真实 Pi JSONL 摘要和权限保持。

## 验证与评审收口

当前定向结果：账号/认证/Pi 路径、真实进程及 PTY 验证通过；受影响直接运行入口回归 127 PASS；模型能力与任务协调回归 48 PASS；WebUI 11 文件、40 PASS；构建、类型与 lint 已通过。Linux arm64 的受影响既有 CLI 回归 140 PASS、0 FAIL、0 SKIP：固定 Node 24.19.0 / Pi 1.3.0、独立 manifest/lock 与 test:prepare，准备后容器无网络接口，操作系统返回 ENETUNREACH。固定镜像为 `node@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`，Linux Node SHA-256 为 `3e53e5ff5eaa922f1b4308312d50da9091db62d40b87716ad36c60b347e7f984`。实际文件内容与 Git 可执行位一致；归档产生的额外 group-write 权限另存身份，不声称跨平台权限完全相同。验证后新容器与专用 VM 已停止，Docker 默认 context 保持。

最终隔离完整回归、独立 Standards/Spec 与远程 CI 仍待本节收口，不以这些定向通过替代。

## 已知基线失败

main run `39398385484` 在 C10 deterministic coverage 失败，定位为 `tests/host-mcp-http.test.mjs` 的既有 HTTP 审批等待。C1–C9 通过，Q10 被跳过。日志没有失败时完整任务状态及接收证据，远程根因保持 UNKNOWN，不能以历史 PR #85 PASS 覆盖当前失败。

在独立原 main 工作树中，原测试常规启动通过；在原有 30 秒初始化预算内注入 26 秒 SDK 启动，复现同样的 HTTP 审批超时。测试修复为先等待已有 `untilPiInitialized` 就绪事件，再开始原 20 秒审批预算，保留 45 秒总体上限和全部审批断言；常规与 26 秒延迟均通过。它证明本地测试就绪边界缺口，不能反推远程失败时也发生了同样延迟。原失败运行与本地 RED 均保留，没有无依据重跑远程 main。

Ego 初次挂起流在长时间观察后显示 `MODEL_REQUEST_FAILED`，保留该失败；随后两种认证均独立完成及时主动取消、接收端关闭和占用释放。一次错误的浏览器概览抓图未被接纳为产品图像；激活实际 Page target 后获得了经检查的账号状态与焦点图像。Pi 1.3.0 print 进程收到 SIGINT 后仍活着时，占用保持，最终通过该版本公开支持的 SIGTERM 清理路径确认退出（143）与连接关闭；不宣称 SIGINT 已完成退出。

首次隔离完整回归在 API Key PTY 的终端设置精确相等断言失败，保留整轮 FAIL。原测试单独复现后，错误详情显示下一条 shell 命令的回显混入原 stty 设置行；两个实际模型身份与批准后的文件写入均已正确完成。测试改为收到完整原始设置行后才发送下一条命令，并只解析完整行，未改变状态相等断言或超时。修复后 API Key/OAuth 两个实际 PTY 路径通过；最终完整回归使用修复后的新冻结提交，不能用旧的定向成功覆盖首次 FAIL。

首次独立 Spec 为 PARTIAL：指出 Pi 对同 Provider 未声明模型允许 custom fallback，以及此前崩溃证据只有内部协调 C。正式 CLI 的新增负例复现了未知模型仍被物理接收且退出成功，保留 RED；修复为产品账号只接受目录中精确模型，未知和模糊 ID 均返回 `ACCOUNT_MODEL_NOT_FOUND` 且接收数不增，API Key/OAuth 两条正式路径通过。原 CLI 的 Pi 模型解析归属保留。上述正式 CLI/Pi/认证 worker 崩溃恢复补足 P；初次评审结论与修复后的独立复核分别保存。

第二次独立 Spec 确认上述两项补证，并指出 API Key 输入期限与主动取消共用取消结果。正式 CLI 期限负例复现后，修复为期限届满单独返回 `timed_out`，主动 SIGINT 仍为明确取消；两者均非零退出，真实状态回读 missing，后续变更成功。保留 RED、两次 PARTIAL 和修复后的独立复核。第二次完整回归的两个既有 codemode 存储用例出现失败，同一冻结源码的单独复现为 2 PASS；原完整日志保留，具体原失败原因仍待原错误详情，不把单独通过解释为原失败已修复。

本地原始证据保存在工作区外层 artifacts，公开报告只保留必要的非秘密身份和结论。私有 `codex/dev/cli-webui@7a52fc575634e9e3c672bc0b92a75f18e69d05ac` 的十个 WIP 提交保持原样；本票没有提取旧 WIP 文件或私有原始历史。#76/#77 只保留各自已验收范围。

真实外部或付费 Provider、日常安装切换、产品发行、桌面及新增 Linux 能力为 NOT_RUN / 本票范围外；不执行保护的 Provider/真实根发行门槛。#21/#23 材料阻断保持，#78 不能代表整个客户端阶段或完整 WebUI 通过。
