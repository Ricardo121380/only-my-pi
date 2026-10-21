# CLIENT-01C / #79：独立 CLI 认证 MCP 验收记录

**状态：实施中，整票未验收。** [#79](https://github.com/Ricardo121380/only-my-pi/issues/79)
的五条 AC 尚未全部成立。Ego Lite 自动化通道当前无响应，实际 GUI B 阻断；
独立评审、最终完整回归、Linux 受影响回归及远程 CI 尚未完成。本记录不把
Host API 测试当作实际页面操作，不预记 PR、主线或工单关闭。

使用方法见 [CLI MCP 指南](../cli-mcp.md)。本票只覆盖 GCLIENT-01 的 MCP 认证
与 GCLIENT-06 对应的 MCP/codemode 入口，不完成整个客户端阶段。

## 基线与范围

开工基线为干净 main `5b566478b77a128e3aca06e90d25a322c14b8221`，功能分支
`codex/feat/cli-authenticated-mcp`。开工独立回读 #79 最新正文、评论和完整原生
依赖，15 个祖先全部 CLOSED；前置 #78 已完成。main run `39595145122` 及两个
必需检查 SUCCESS。最终源码、运行产物与提交身份待冻结后补入。

开发与验证使用 Node 24.19.0、精确 Pi 1.3.0、当前 manifest/lock、干净 npm ci
和 `test:prepare`，不借用用户 Pi HOME，不升级 Pi。新增能力限 macOS arm64
受控服务；旧 Node22 证据保留历史身份，不恢复旧正向矩阵。

## 五条 AC 与证据映射

| AC | 当前证据 | 当前限制 |
| --- | --- | --- |
| 1 共用配置、覆盖/导入、独立凭据/OAuth、原件保留 | 实际 CLI 从空 MCP 配置保存、导入、隐藏/安全 stdin 凭据、原生 OAuth、取消、超时、刷新、撤销与崩溃恢复；配置/CAS/原文件负例 | 最终冻结回归待完成 |
| 2 两种连接、真实 Pi direct/codemode、发现与加载 | stdio + token/OAuth HTTP 的正式 CLI/PTY、真实 Pi/QuickJS；独立接收、逐次批准、deferred 搜索前后声明不同 | 排队输入生命周期 RED 后修复；普通两路径及确定性公共 hook 复验 PASS |
| 3 每个直接/嵌套调用的权限与快照、未知不重放 | 现有 Host OAuth 30 项当前分支回归 PASS；CLI/Pi 撤销待审批零新增接收；旧目标回调在交换前拒绝；快照/unknown 不重放实际 Pi 路径通过 | 不拼接较早候选成功为最终整票 PASS |
| 4 同身份/revision/引用、真实进程冲突、GUI | 实际 CLI/Host 进程：启动保留活跃 OAuth owner、第二登录在注册前拒绝、Host 创建身份供真实 CLI/Pi 使用、Host 撤销 CLI 后续调用、双向 stale revision 拒绝 | Host API 属 C/P；实际 Ego 页面 B 仍 BLOCKED |
| 5 同源 C/P/B、独立评审与适用回归 | 原始命令/退出、源码与 Node/Pi 摘要、受控接收和失败保存在独立本机证据中 | 最终完整回归、Linux、两轴评审与公开同步 NOT_RUN |

## 已复现失败与最小修复

原 CLI 缺少 `omp mcp` 正式路由，也拒绝从 action 文件输入秘密。公开 CLI 测试
先取得路由/认证入口 RED，再增加安全终端与原生 OAuth 入口；秘密 action 文件
仍拒绝，认证不会启用服务器或授予编程/工具许可。

真实 CLI 等待 OAuth 回调时启动另一 Host，原恢复逻辑将其写成 interrupted。
两个实际进程取得 RED 后，现有 OAuth 状态账本补入 flow identity 和真实进程
owner；短事务内登录准入、flowId 更新检查及安全恢复消除了相互覆盖。后续
CLI/Host 读回同一引用；配置变更仍使用原 revision CAS，不另造 OAuth 账本。

实际 TUI 连续任务暴露更早停止 MCP 的问题。第一轮混合传输接收器误把 HTTP
记录当 stdio 文件，保留 FAIL 并修正夹具；后续现场记录了第二/三条任务缺失
MCP run，以及 codemode 普通 read 成功但 MCP 成员不存在。两次失败 fixture
的手工清理单独记录，未当作产品自然停止。

当前 Pi 的公开 `agent_end` 后仍可处理真实排队输入，无新的 `before_agent_start`；
真正逻辑运行结束为 `agent_settled`。受控公共 hook 在真实 agent_end 等到实际
steering queue 非空，确定性复现同类失败；没有伪造事件或改造协议。最小修复
把 TUI 的 MCP 关闭移至 agent_settled，保留逐调用授权、撤销和快照/额度。该
门禁与普通独立 CLI/PTY 路径分别通过。原生增量终端不保证重绘不变页脚；
新测试去掉页脚先后顺序假设，保留本轮完成输出、逻辑运行停止及全部业务断言。

补充边界：Host 可查询另一 CLI 的活动 OAuth，跨端取消明确拒绝，不误报为
过期。状态保留先保存所有活动准入，再截断终态历史；固定 32 条上限不会挤掉
活 owner 或身份未知的旧 owner。实际 owner 准入及 flowId 防覆盖测试覆盖此行为。

针对性验证：11 项正式 CLI/PTY/Pi 旅程通过；加入 Host OAuth 回归后 36 项通过，
一项新元数据测试因夹具误传 undefined 字段失败。保留该失败，修正夹具后取得
活动记录被挤掉的有效 RED，再以最小保留顺序修复取得 GREEN。共享秘密输入
与原账号 API Key/OAuth 的实际 PTY 回归加元数据测试共 4 项通过。最终全套结果
另行记录；上述针对性结果不会拼作一次完整测试 PASS。

## 未完成与保留

Ego 首次创建任务在 25 秒内无 TaskSpace ID 或页面响应，最小运行时输出命令
也在 10 秒后超时；应用进程存在。已请求恢复通道，未换浏览器、重启用户应用
或用新 TaskSpace 绕过。旧 #78 的 Ego 证据不代本票 B。

本地原始回执与公开报告分开；不上传真实凭据、模型原始请求/输出或本机私人
路径。私有 `codex/dev/cli-webui@7a52fc575634e9e3c672bc0b92a75f18e69d05ac`
十个 WIP 提交及归档保持，没有整批集成或旧文件覆盖。#21/#23 材料阻断保持；
日常安装、发行、桌面、真实付费/外部 Provider、新 Linux MCP 能力均未验收。
