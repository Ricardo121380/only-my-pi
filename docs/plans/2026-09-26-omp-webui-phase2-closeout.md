# M2 完成验收与日常安装记录

日期：2026-09-26，Asia/Shanghai。

结论：**M2 PASS，二阶段 WebUI 已晋升日常安装。** 最新一次受管 writer 完成真实执行与 Host/页面成功收尾，日常 Full 栈完成升级、回滚、重新应用和页面检查。该结论限于已约定的本机 macOS arm64、单用户协作边界及下表已测范围，不代表所有 Provider、恶意进程隔离或公开发行认证。

## 最终运行身份

| 项目 | 实际结果 |
| --- | --- |
| 产品源码 | `9130d0259bb53a82f8af290c994dc31fbdd8e028` |
| Full stack | `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0` |
| Pi / Node | 0.85.1 / 24.19.0，候选内嵌运行核心 |
| 日常入口 | 用户目录下 `.local/bin/omp` |
| 当前安装 | 用户目录下 `.local/share/only-my-pi/current-stack` 指向上述 stack |
| 升级前 active | `sha256:0b9e9e1c8b7e6d8b1b678dc0c02a5e728c29d47ac96e90853f3b61450ffe8847`，源码 `b5d4674` |
| 对外发布 | 未推送、未发布；仍为本机私有候选合同，packageVersion 保持 `0.3.0-preview.1`，以 sourceCommit / stackId 区分增量 |

产品源码在既有候选之后未改变；本轮新增的是仓库外验收脚本、证据与仓库内文档。因此沿用同一候选的有效技术证据，没有重新打包文档提交来伪造新的产品身份。

## 阶段门禁收敛

| 范围 | 结论 | 权威证据与限制 |
| --- | --- | --- |
| 2A 账号与模型 | PASS，约定范围 | GUI 独立账号、CLI 只读引用、实际子进程双身份与无回退检查；API Key/静态 Provider 页面闭环；[进度记录](2026-09-21-omp-webui-phase2-progress.md)。OAuth 为模拟合同，真实互操作只声明 CPAR Grok 4.5 |
| 2B 受控编程 | PASS | [真实小型修改](2026-09-26-omp-cpar-real-acceptance.md)完整成功；[writer 终态复测](2026-09-26-omp-writer-terminal-acceptance.md)覆盖审批、克隆、独立审查、应用、双 gate、Host succeeded 和页面完成 |
| 2C 所有权与恢复 | PASS，受支持 OMP 入口 | CLI/TUI/RPC 与 GUI 的准入、同项目单写、会话锁、正常释放/未知留锁已有技术证据；不声称 raw Pi、外部编辑器或任意守护进程参与协议；[Task 看板](2026-09-21-omp-webui-phase2-tasks.md) |
| 2D Monaco | PASS，已测基础闭环 | 多标签、搜索、条件保存、冲突与未保存处理已有定向检查；bb4111e 安装页面真实保存/释放通过，后续同模块未改；日常安装本轮只读打开入口，不再次写用户项目 |
| 2E xterm / PTY | PASS，本机协作式 | 安装包真实 shell 写入、重连、结束和项目锁释放；9130d02 安装 Host/PTY 回归及[资源轮次](2026-09-26-omp-resource-transfer-acceptance.md)再次确认进程清理；非 OS 沙箱 |
| 安全和异常 | PASS，既有定向矩阵 | 认证/Origin/协议、账号隔离、权限与迟到审批、路径/版本冲突、未知所有权留锁；DOMPurify/fast-uri 定向修复，详情见[候选报告](2026-09-23-omp-webui-phase2-candidate-acceptance.md)。不将依赖审计泛化为安全认证 |
| F01 输入与取消确认 | PASS，本机固定样本 | [普通窗口输入](2026-09-26-omp-input-performance-acceptance.md)30 样本 P95 8.4ms、返回复测 9.1ms；既有取消本地确认 P95 2.4ms。双 rAF / DOM 更新口径，不是物理像素或进程退出时间 |
| 资源和包体 | MEASURED，记录要求完成 | [资源与 Full 下载量](2026-09-26-omp-resource-transfer-acceptance.md)：140 个组合样本，Host/PTY/共享浏览器分列；Full 151,164,714 bytes，较 M1 增 30.92%，字节回放与解包身份 PASS |
| F04/F05 强度与用量 | PASS，实际所选路由 | 页面选择 low、Pi 回读 low；真实主 Agent 用量与页面一致，缺失价格显示未知；子代理预算单独记录 |
| 日常安装 | PASS，本轮实际执行 | Full 升级 → 明确回滚到本次升级前 active → 重新应用同一候选 → PATH 身份/内容验真/页面检查；不是只有 rollback plan |

当前候选关联的 12 项回归日志已再次核对：12 PASS、0 FAIL、0 SKIP。原测试组成包含源码 Host + 候选 SDK/扩展以及直接安装 Host/PTY，并非全由安装包导入。本轮产品未改，未重复运行无关全量套件。

## 日常安装事务与页面

1. 切换前完整检查当前安装内容、未完成事务、Host 与相关 Pi 进程；Host 未运行、活动进程 0、约 15.4 GiB 可用。没有强停用户会话。
2. 升级事务 `a595ddf0-5150-4d22-aa21-3acfcf4c782b` 成功；PATH `omp admin version --json`、真实配对、静态资产、Host 状态与协议 2 均通过，`controlled=true`。
3. 正式 lifecycle rollback 明确指定升级前 `0b9e9e1c…ffe8847`，验证 PATH 恢复到 `b5d4674`；没有误用更早 LKG。
4. 重新应用事务 `2d63d5af-fb48-498d-99b5-549271ac60ff` 成功；最终完整内容核验通过，无未完成事务。
5. Ego Lite 空间 6 / p1 从日常 Host 配对，实际检查账号管理、CLI 只读引用、9 个模型目录、Grok 4.5 / low、受控模式弹窗、编辑工作区只读打开、终端面板正常就绪。截图已查看；没有新增模型任务、GUI 账号、编辑保存或终端进程，没有借此声明这些动作在日常目录重新全量执行。
6. 设置、auth/models 凭据文件、全部既有 Pi 会话文件摘要在事务前后及页面检查后保持一致；raw Pi 路径/文件摘要、用户 npm 根目录 inode 保持一致。Host 自有索引/状态可以正常更新，不等同整个配置目录逐字不变。
7. 专用 Ego 空间已结束，日常 Host 正常停止，私有配对文件已移除。用户运行 `omp web` 即可打开新界面。

## 真实调用与保留限制

- 二阶段累计任务 **3/3**、失败重试 **6/6**（原 1 次加各次明确上下文授权的补测）；本轮只增加一次 writer 复测，晋升过程新增模型请求 0。
- writer 主 Agent 3 轮、2 工具、13,670 token；子代理累计 21,883 token；费用未知。旧 writer 脚本失败保留，本轮有独立新证据。
- 撤权/取消真实模型验收通过的是模型续接期间。运行中 shell 的进程回收依赖本地模拟模型/真实 PTY 的既有证据；尚未做真实外部模型发起 shell 后取消的追加场景，不把两类证据互换。它不新增为约定三任务之外的强制收费门禁。
- 真实 OAuth 登录、实体 IME、跨设备性能、远程访问、Windows/Linux GUI 和 Electron 不在本次已验收声明内。OAuth 模拟分支和 composition 事件测试保留各自口径。
- 附件、插件市场、分区管理及部分顶部快捷动作仍标记“尚未接入”；本阶段完成条件是约定核心工作流，不代表原型每个装饰入口都变成已实现功能。

## 证据与下一阶段

仓库外 `artifacts/webui-phase2/daily-promotion-sep26/` 中的 `promotion.json` 是本次日常事务收据；`browser-acceptance.json`、`installed-page-state.json`、页面文本和 `installed-ready.png` 是页面检查证据。`promote.mjs` 位于回滚栈之外，可保留供诊断；不应无条件重复运行。阶段汇总为同级 `M2.json`。

按[总计划](2026-09-20-omp-webui-desktop-plan.md)，下一批为 **3A：Electron 承载**。复用当前 React WebUI 和 OMP Host，先处理单实例连接、窗口关闭与显式退出、菜单/目录选择及通知；运行核心打包与安装事务属于 3B/3C。M3 尚未完成，不把 M2 的 WebUI 安装当作 Electron 已交付。

**收口后的安排调整（2026-09-26）：** 上段保留M2收口当时顺序。用户随后通过Q1–Q23及[R1–R3补充讨论](2026-09-26-webui-report-followup-discussion.md)确认先完成S0安全与可靠性修复，再推进[WebUI优化U0–U6](2026-09-26-webui-optimization-plan.md)，最后进入Electron；当前执行入口是[新Task看板](2026-09-26-webui-optimization-tasks.md)，S0-01–08全部已验收，下一项U0-01尚未开始。本报告历史验收结论和限制不变，不据此验收新发现缺陷的修复或追加功能。
