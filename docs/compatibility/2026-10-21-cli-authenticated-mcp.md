# CLIENT-01C / #79：独立 CLI 认证 MCP 验收记录

**2026-10-22 收口状态：本地实现与验证通过，GUI B BLOCKED，整票 PARTIAL。**
[#79](https://github.com/Ricardo121380/only-my-pi/issues/79) 的五条 AC 尚未全部满足。
实际 Ego Lite 通道无响应；Host API 和页面 HTTP 自检分别留证，均不代替实际页面
操作。本轮尚未推送功能分支、创建 PR、触发本票远程 CI、合并或关闭工单。

使用方法见 [CLI MCP 指南](../cli-mcp.md)。本票只覆盖 GCLIENT-01 的 MCP 认证
与 GCLIENT-06 对应的 MCP/codemode 入口，不完成整个客户端阶段。

## 冻结基线与运行身份

- 开工 main：`5b566478b77a128e3aca06e90d25a322c14b8221`，工作树干净；完整原生
  依赖的 15 个祖先全部 CLOSED，前置 #78 已完成。
- 功能分支：`codex/feat/cli-authenticated-mcp`。
- 实现与本地门禁提交：`79837f9729f2353e7ed24a376c4f48a6f6bc49ba`；tree：
  `550897595a6477b334c160b9b5c2c14feaf80028`。冻结 1,694 个跟踪文件的字节、
  权限及符号链接身份；门禁前后干净且未改变。之后仅补交文档收口。
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
| 4 同身份/revision/引用、真实进程冲突、GUI | C/P PASS：真实 CLI/Host 进程保留活 OAuth owner，竞争登录在二次注册前拒绝，双向 stale revision 拒绝；Host 创建身份被真实 CLI/Pi 使用，Host 撤销阻止 CLI 后续调用；接收/文件/退出分别核对 | **实际 Ego GUI 回读及反向页面操作 BLOCKED**；Host API 不代 B |
| 5 同源 C/P/B、独立评审与适用回归 | 当前源码 C1–C10、WebUI 和既有 Linux CLI 回归通过；精确组合/命令/退出/失败及独立两轴结论均留证 | **B 缺失，整票 PARTIAL**；本票 PR/远程 CI/合并/关闭尚未执行 |

## 当前验证结果

| 检查 | 结果与实际范围 |
| --- | --- |
| `npm run verify:m12:run` | C1–C10 全 PASS，退出 0；C10 为 1,161,016 ms，未超时/超输出。含 lint、完整 typecheck、Schema、pack、agents、一次完整覆盖及各模块覆盖，阈值与并发未改 |
| M12 C11/C12 | `NOT_RUN_BY_POLICY`，总状态为 `DETERMINISTIC_PASS_PROTECTED_PENDING`，不声称安装、晋升或真实付费模型验收 |
| 正式 CLI/PTY/Pi 针对性路径 | 11 PASS：两认证路径、原生 codemode、实际跨进程互操作与确定性排队边界 |
| Host OAuth 与扩展负例批次 | 37 项中 36 PASS、1 个新夹具 FAIL，原失败保留；修正夹具并取得有效 RED 后，共享秘密输入/旧账号 API Key/OAuth PTY/活动记录保留测试 4 PASS；未拼接为一次 Full |
| 独立接收保留补验 | 原测试和 Pi 不改；仅在确认退出后、原临时目录删除前读取 stdio 接收文件。两认证路径 2 PASS，观察器独立冻结身份 |
| `npm run test:web` / `build:web` | 40 个测试、11 个文件 PASS；实际生产 WebUI 构建 PASS，均不是浏览器 B |
| `npm run secret:scan` / 文档链接 | PASS；收口文档再做静态复核 |
| Linux 既有 CLI | 相同提交、Node 24.19.0 / Pi 1.3.0、隔离 arm64 glibc 容器 140 PASS/0 SKIP。源码前后相符，离线依赖及 `test:prepare` 成功，外网禁止；容器/VM 已停，默认 Docker context 保持。不是新 Linux MCP 验收 |
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

## 独立评审与未完成项

Standards PASS：完整 25 文件 diff，明确文档违规 0；有 1 项非阻断的 possible
Duplicated Code，涉及 commands 的项目和 revision 校验。保留局部校验，未发现
行为分歧，不为该启发式观察新增抽象。

Spec：完整 diff 和八份同源回执，未发现新增源码阻断或范围扩展；**整票 PARTIAL**。
评审明确要求 AC4/5 的实际 GUI B。Linux 和最终 C10 是主线程随后独立回读的运行
结论，不追记为子代理已经审核过的内容。

Ego 首次任务创建 25 秒无 TaskSpace ID/页面；最小 `console.log` 两次均 10 秒
超时，应用进程存在。已请求恢复自动化连接，未换浏览器、重启用户应用或新建
TaskSpace 绕过。实际 Host/页面 HTTP 启动与确认停止已准备通过，但不记 B。
最小所需输入为恢复 Ego Lite 自动化通道；恢复后先查已有 TaskSpace，再补实际
CLI→GUI 回读及 GUI→CLI 使用、冲突和撤销，随后才能进入 PR/CI/验收关闭。

公开报告与本地原始证据分开，不上传凭据、模型原始请求/输出或本机私人路径。
私有 `codex/dev/cli-webui@7a52fc575634e9e3c672bc0b92a75f18e69d05ac` 的十个
WIP 和归档保持；没有提取旧私有增量或导入原 19 个 WebUI 文件。#21/#23 材料
阻断保持，#80–#83 不在本票实施。日常安装、发行、桌面和新 Linux MCP 能力未验收。
