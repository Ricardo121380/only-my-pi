# CLIENT-01C / #79：独立 CLI 认证 MCP 验收记录

**2026-10-22 当前状态：实际 Ego B 已补齐；最终完整门禁及独立评审待收口，整票尚未验收。**
[#79](https://github.com/Ricardo121380/only-my-pi/issues/79) 的 CLI、Pi、本地受控服务和
GUI 互操作路径已执行。本轮尚未推送功能分支、创建 PR、触发本票远程 CI、合并
或关闭工单。下文将首次基线结果、已保留失败与后续补验分别记录。

使用方法见 [CLI MCP 指南](../cli-mcp.md)。本票只覆盖 GCLIENT-01 的 MCP 认证
与 GCLIENT-06 对应的 MCP/codemode 入口，不完成整个客户端阶段。

## Ego 恢复、并发修复与当前补验

用户授权强制重启 Ego Lite 后，自动化连接恢复；没有清除用户配置、Cookie 或
登录资料。沿同一 TaskSpace 完成实际生产 WebUI 配对、添加项目、设置、原生
OAuth、审批和状态回读；成功后调用 `finish({keep:[]})` 并等待结束。

- 实际 B 运行源码：`e67ae359a4b00b5baf583af688c022bd756970ee`。当前产品代码
  与该运行逐文件摘要一致；后续 `baef92797e6c7bbe692baee53e0bb3d75a0fed1c`
  仅修改测试夹具的 Node 预检和失败清理。精确运行身份仍为 Node 24.19.0 / Pi 1.3.0。
- 从空产品配置开始，无 Host 的正式 CLI 完成账号、模型、MCP 设置、token 凭据和
  原生 OAuth。认证后独立接收为模型 0 次、MCP 业务 0 次，再启动独立 Host。
- Ego 读取 CLI 创建的连接、revision 和相同非秘密引用；GUI 另建独立 OAuth 身份，
  被另一 CLI 的真实 Pi 使用。GUI 也使用 CLI 创建的 token 与 OAuth 身份。
- 双端实际 CAS 冲突返回 `409 MCP_REVISION_CONFLICT`。其中一次只延迟真实 UI
  请求的发送，输入和响应保持原样；明确记录该调度探针，没有替换 Host 返回值。
- 实际 CLI 与 GUI 并发运行、逐次批准，两端写入同一运行账本。GUI 撤销阻止 CLI
  待审批调用；CLI 登出阻止 GUI 待审批调用，均为 `MCP_AUTHORIZATION_REVOKED`，
  无额外业务接收。仍启用的无效身份会在新任务启动前拒绝，不换身份继续。
- 最终独立接收：token HTTP 2 次、OAuth HTTP 2 次、stdio 2 次。20 次受控模型
  请求身份全部正确。最后的 codemode 组合包含普通 read、stdio 与 HTTP；两个
  MCP 子调用分别批准并完成，共用父调用 ID，父脚本没有授予子调用权限。
- 9 条运行记录全部 `stopped`；CLI 与 Host 均正常退出 0，CLI 进程组消失，记录的
  stdio 进程组均不存活。所有 stdio 接收记录可读，原项目文件 SHA256 不变。
  比对 6 个本轮合成秘密，模型输入、会话、终端、公开状态及浏览器记录未检出。

此次 B 首先暴露真实账本竞争：正常短事务争锁会令另一个进程立即失败为
`LOCK_HELD`，清理保存也可能因此进入 reconciliation。原现场保留。两个真实 Node
进程用持锁、争用、正常释放的 IPC 屏障稳定取得 `begin/save` RED；产品局部改为
最多 100 次、间隔 20ms 等待获取元数据锁。取得锁后的 callback 和 release 各执行
一次，不重放 OAuth、HTTP POST、工具调用或整个任务。全局配置锁、revision CAS、
存活 owner、不可判定 owner 及旧 handle 的释放规则不变。针对性 32 项全 PASS。

`e67ae35` 的完整门禁 C1–C9 PASS，C10 在 1,802,026 ms 超时 FAIL，未超输出限制。
只读现场核对发现 `host-codemode-limits` 的第 4 条 PTY 测试没有调用 fixture close，
两个监听仍存活；PTY 后来才报告 SIGTERM 退出。原始 TUI 无输出的初始原因仍未知，
不把它推定为产品锁错误。诊断曾只读连接该测试进程的 Node inspector，另行留证。

受控故障只延迟真实 PTY 退出通知：原清理在断言失败后遗留监听，外层 40 秒取证
上限才结束；增加 `finally` 后，同一断言仍失败，但测试自行非零退出。补齐这条
失败清理，并复用已有复制 Node 预检，未放宽原 TUI 就绪/业务断言或任何超时。
修复后单文件 4 PASS，约 80 秒；最终完整门禁须从新冻结提交重新取得结果。
`e67ae35` 的 Linux 既有 CLI 与元数据锁测试另取得 144 PASS、0 SKIP，离线依赖、
Node/Pi、源码前后身份和网络禁止分别核对；容器与 VM 已停，默认 context 保持。
这项不构成 Linux 新 MCP 客户端能力验收。

夹具路由、GUI 包装提示的匹配、浏览器选择器/观测超时、首次接收校验字段错误，
以及一次超过原生 60 秒父脚本期限的手工审批均保留为失败/负例。父脚本超时后的
HTTP 子调用被拒绝，无业务接收；后续新任务在原期限内分别审批后成功。没有
把上述失败拼成一次全绿运行，也没有借这些观测错误修改产品权限边界。

## 首次基线与运行身份

- 开工 main：`5b566478b77a128e3aca06e90d25a322c14b8221`，工作树干净；完整原生
  依赖的 15 个祖先全部 CLOSED，前置 #78 已完成。
- 功能分支：`codex/feat/cli-authenticated-mcp`。
- 实现与本地门禁提交：`79837f9729f2353e7ed24a376c4f48a6f6bc49ba`；tree：
  `550897595a6477b334c160b9b5c2c14feaf80028`。冻结 1,694 个跟踪文件的字节、
  权限及符号链接身份；首次门禁前后干净且未改变。直接后继 `2141ea9` 仅补文档；
  再后的产品锁修复与测试清理修复按上节的新身份分别记录。
- macOS arm64 Node 24.19.0 SHA256：
  `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`。
- 精确 Pi 1.3.0，SDK SHA256：
  `4569157e6038be9840fa514db4b00a27fd0be9e3622cc7b49a281de6c027d7ff`；
  manifest SHA256：`83c3bb7619f590c213cc96a24216eb29a819a3ef6dc548607cc037ed276e8dc5`。
- 当前根 manifest/lock 未改，lock SHA256：
  `3e71a355116a7243519565feb72b838b4761aeb3dd3d2eda43610a77a0e83a3f`。
  使用干净 `npm ci --ignore-scripts --no-audit --no-fund` 和现有 `test:prepare`。
- 真实 CLI 入口和真实 Pi/外部扩展复制到隔离源码运行栈；复制后的实际文件摘要
  和扩展资源摘要留证。它是源码受控运行证据，未冒充安装或发行候选。

不借用用户 Pi HOME，不升级 Pi。旧 Node22 证据保留历史身份，不恢复正向矩阵。

## 五条 AC 与证据映射

| AC | 当前证据与结果 | 尚未满足的范围 |
| --- | --- | --- |
| 1 共用配置、覆盖/导入、独立凭据/OAuth、原件保留 | C/P PASS：空产品 MCP 配置开始，实际 CLI 保存/导入、隐藏终端或安全 stdin 凭据、原生 OAuth 登录/取消/超时/刷新/撤销/崩溃恢复；外部原字节、导入不执行、认证不授权、CAS 负例均核对 | 整票仍受 AC4/5 的 B 门槛约束 |
| 2 两种连接、真实 Pi direct/codemode、发现与加载 | P PASS：无 Host 的正式 CLI/PTY，stdio + token/OAuth HTTP，真实 Pi/QuickJS、逐次批准和独立接收；deferred 搜索前后模型声明不同，配置/发现/可调用/已加载分别断言 | 新增核心能力只验收 macOS arm64 |
| 3 每个直接/嵌套调用的权限、快照与未知不重放 | C/P PASS：父脚本不授予子调用许可；待审批撤销零新增业务接收；活动快照保持原目标、替代服务接收为零；旧回调在交换前拒绝；失效、取消、超时、重复回调、断连 unknown 后拒绝重放 | 真实外部 Provider/服务未调用 |
| 4 同身份/revision/引用、真实进程冲突、GUI | C/P PASS：真实 CLI/Host 进程保留活 OAuth owner，竞争登录在二次注册前拒绝，双向 stale revision 拒绝；Host 创建身份被真实 CLI/Pi 使用，Host 撤销阻止 CLI 后续调用；接收/文件/退出分别核对 | 实际 Ego B 已补验：双向身份、引用、配置冲突、审批、撤权及运行状态，见上节 |
| 5 同源 C/P/B、独立评审与适用回归 | 首次门禁、后续定向 32 PASS、实际 B、Linux 144 PASS 及失败分别绑定其真实源码；新完整门禁尚待取得终态 | B 已补齐；新冻结完整门禁、最终独立评审及本票 PR/CI/合并/关闭尚待收口 |

## 首次门禁结果与后续补验范围

| 检查 | 结果与实际范围 |
| --- | --- |
| 首次 `79837f9` 的 `npm run verify:m12:run` | C1–C10 全 PASS，退出 0；C10 为 1,161,016 ms，未超时/超输出。含 lint、完整 typecheck、Schema、pack、agents、一次完整覆盖及各模块覆盖，阈值与并发未改 |
| M12 C11/C12 | `NOT_RUN_BY_POLICY`，总状态为 `DETERMINISTIC_PASS_PROTECTED_PENDING`，不声称安装、晋升或真实付费模型验收 |
| 正式 CLI/PTY/Pi 针对性路径 | 11 PASS：两认证路径、原生 codemode、实际跨进程互操作与确定性排队边界 |
| Host OAuth 与扩展负例批次 | 37 项中 36 PASS、1 个新夹具 FAIL，原失败保留；修正夹具并取得有效 RED 后，共享秘密输入/旧账号 API Key/OAuth PTY/活动记录保留测试 4 PASS；未拼接为一次 Full |
| 独立接收保留补验 | 原测试和 Pi 不改；仅在确认退出后、原临时目录删除前读取 stdio 接收文件。两认证路径 2 PASS，观察器独立冻结身份 |
| `npm run test:web` / `build:web` | 40 个测试、11 个文件 PASS；实际生产 WebUI 构建 PASS，均不是浏览器 B |
| `npm run secret:scan` / 文档链接 | PASS；收口文档再做静态复核 |
| 首次 Linux 既有 CLI | `79837f9`、Node 24.19.0 / Pi 1.3.0、隔离 arm64 glibc 容器 140 PASS/0 SKIP。源码前后相符，离线依赖及 `test:prepare` 成功，外网禁止；容器/VM 已停，默认 Docker context 保持。不是新 Linux MCP 验收 |
| 本票远程 CI | NOT_RUN；未创建 PR。main 原 run `39595145122` SUCCESS 是开工主线证据，不代本票 CI |

C10 使用现行门禁的脱敏摘要，保留输出字节数与摘要，不保留逐例输出和 SKIP
明细；不从历史轮次补写本轮 Full 的测试总数。C11/C12 的政策未执行与 Ego B
阻断分别陈述。没有扩大日常安装、发行或真实外部服务的授权。

普通未改 SDK 的两条 P 路径另保留独立接收：token 路径 7 个已停止运行、HTTP
业务接收 4 次（含一个 unknown），OAuth 路径 4 个已停止运行、HTTP 业务接收
2 次；各有 stdio 业务接收 2 次。业务身份正确，撤销及 unknown 后拒绝没有额外
业务接收；项目原文件哈希不变，未授权写入收到 EPERM。Pi 正常退出码 0，
进程组消失，所有已记录 stdio 接收文件可读，没有将缺失记录记成零。

## 已复现失败与最小修复

原 CLI 缺少 `omp mcp` 正式路由。公开入口先取得路由/认证 RED，再补安全终端
输入与 Pi 原生 OAuth。秘密 action 文件仍拒绝，认证不会启用服务器或授予许可。

真实 CLI 等待 OAuth 回调时启动另一 Host，原恢复逻辑错误写成 interrupted。
两个真实进程取得 RED 后，现有 OAuth 账本补入 owner PID/身份、短事务登录准入
及 flowId 防覆盖。Host 可查另一端活动状态，跨端取消明确拒绝，不误报为过期。
活动准入优先保留，再截断终态历史；固定 32 条上限不会挤掉活 owner 或身份未知
的旧 owner。原配置修改仍走 revision CAS，没有新建另一套认证账本。

真实 TUI 的排队续行暴露提前停止 MCP：原生 agent_end 后仍可消费真实 steering
queue，不再发 before_agent_start。公共 hook 只等待实际队列进入，取得确定性
RED 后，把 MCP 关闭移至原生 agent_settled；逐调用授权、撤权、快照及额度保留。
普通 SDK 路径与受控 hook 路径分别留证，不把后者当作未改 SDK 身份。

保留全部原始失败：混合 HTTP/stdio 接收夹具读取错误、两次失败现场的手工清理、
旧页脚重绘顺序假设，以及新元数据夹具的 undefined 字段。修正夹具/观测边界后
才取得对应 GREEN。未增加超时、放宽权限、替换账号/模型或删除业务断言，也未
把手工终止记成自然退出。

## 首次独立评审与后续收口

首次 Standards PASS：`5b566478...79837f9` 的完整 25 文件 diff，明确文档违规 0；有 1 项非阻断的 possible
Duplicated Code，涉及 commands 的项目和 revision 校验。保留局部校验，未发现
行为分歧，不为该启发式观察新增抽象。

首次 Spec：上述完整 diff 和八份同源回执，未发现新增源码阻断或范围扩展；**整票 PARTIAL**。
评审明确要求 AC4/5 的实际 GUI B。Linux 和最终 C10 是主线程随后独立回读的运行
结论，不追记为子代理已经审核过的内容。

首次 Ego 通道阻断及其 Host API 准备保持历史身份。用户随后授权强制重启，
实际 B 的补验与新发现的失败见上节；最终 Standards/Spec 尚须覆盖新增锁与夹具
修复。历史 25 文件静态评审不能代替本轮最终结论。

公开报告与本地原始证据分开，不上传凭据、模型原始请求/输出或本机私人路径。
私有 `codex/dev/cli-webui@7a52fc575634e9e3c672bc0b92a75f18e69d05ac` 的十个
WIP 和归档保持；没有提取旧私有增量或导入原 19 个 WebUI 文件。#21/#23 材料
阻断保持，#80–#83 不在本票实施。日常安装、发行、桌面和新 Linux MCP 能力未验收。
