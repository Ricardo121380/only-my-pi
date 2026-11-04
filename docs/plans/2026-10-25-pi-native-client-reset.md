# Only my pi 开发路线

方向确认于 2026-10-25。进度核对于 2026-11-04。

**Pi 版本。** 上游于 2026-11-02 发布 [Pi 1.5.0](https://github.com/earendil-works/pi/releases/tag/v1.5.0)。本项目的 WebUI 开发源码和本次验证锁定 Pi 1.3.0。1.5.0 在本项目上的适配与同候选验收仍待完成，见 [#93](https://github.com/Ricardo121380/only-my-pi/issues/93)。

目标是基于原生 Pi 的个人桌面 Agent 客户端。首先在 macOS Apple Silicon 上交付可用的中文 WebUI。用户应能选项目与模型、开始会话、看见流式回复及工具结果、停止任务，刷新或重启后查看同一历史，并明确选择是否继续。现有 Linux CLI 继续维护。[设计决定](../decisions/ADR-0022-pi-native-web-first.md) · [运行 WebUI 开发版](../minimal-webui.md)

## 交付顺序

| 阶段 | 用户应得到什么 | 截至 2026-11-04 |
| --- | --- | --- |
| 1 · 原生 Pi 基础 | 一个执行者使用实际 Pi 完成请求、工具调用、取消、退出和历史恢复。基础会话只加载需要的资源。 | 开发源码提供显式 `--minimal`，保留只读起步、审批和会话占用。开发依赖锁定 Pi 1.3.0。 |
| 2 · WebUI | 从项目进入会话，看到流式事件，在刷新、断线或重启后安全地找回历史。 | B2 已接入原生 Pi/Host、产品账号、文件查看、Git diff、即时补充及排队。固定源码上的五个 DeepSeek 任务为四次成功、一次主动取消；长输出、待审批刷新和新进程续接已核对。多日使用与后继 Pi 仍待验收。 |
| 3 · 按需模块 | 一次增加一个实际选定的功能。关闭后，基础旅程仍可用，后台资源能回收。 | 待选择优先级。材料转换、搜索、生图、人工终端和工作流分别评估。 |
| 4 · CLI 联动 | 匹配版本的 CLI → WebUI → CLI 能查看同一原生历史，在上一个执行者停止后显式接续。 | 保留最终目标。完整跨进程交接、账号身份与授权重建仍待验收。 |
| 5 · Electron | 安装后能独立启动，窗口和应用退出语义明确，更新失败后可恢复、数据保留。 | 核心 WebUI 稳定后进入。尚无这条新路线的桌面安装包。 |

模块按需持续加入。进入桌面阶段取决于选定核心体验的稳定程度，旧清单的条目数量不决定何时打包。执行权限沿用当前产品策略。基础权限体验若需要调整，另行决定。

## 当前 WebUI 开发顺序

B2「静室·编码」是后续 WebUI 的界面与交互基线，见[设计规范](../../prototypes/DESIGN.md)。
比较原型保留；实时入口使用原生 Pi/Host，入口为 `npm run dev:web:b2:demo`，
使用真实模型时为 `npm run dev:web:b2`。两者使用独立开发数据目录。

1. B2 基线已通过 PR #97 纳入 `codex/dev/pi-native-web`。账号与工作区增量继续按
   独立提交、所选 CI 通过后集成，保留旧 CLI 与失败记录。
2. 真实账号设置、显式连接验证和核心 DeepSeek 旅程已通过本轮验证。应用模型仅
   使用 DeepSeek；外部 Codex 测试代理与应用模型分别处理。
3. 实际文件树、文件查看、Git diff、工具目标跳转及现有 Host/Pi 补充与队列已接入。
   已接收、已消费和未知分别呈现；#91 的持久草稿、统一提交及跨端准入尚待完整验收。
4. 固定 `c6c3f86` / Node 24.19.0 / Pi 1.3.0 完成一轮多任务、长输出、断线、
   待审批、停止与重启验证。多日连续使用和外部 Terra Max 验收仍待完成。

本轮的源码、锁、两类构建资产、真实任务和受控回执见
[11 月 4 日账号与工作区验收](../evidence/2026-11-04-b2-accounts-workspace-input.md)。

后继 Pi 适配沿用独立的 [#93](https://github.com/Ricardo121380/only-my-pi/issues/93)，
开工重新核对并冻结精确稳定版本，不混入旧 RED 候选。适配阶段和同候选/安装阶段
分别记录；阶段通过不关闭整票。日用验收使用最终匹配、已验证的版本组合。

## 哪些结果已经见到

- 10 月 28–30 日的开发候选使用实际 Pi、回环模型服务和 Ego Lite 验证读取、审批、停止、刷新和 Host 重启后的历史恢复。WebUI 采用 A＋D 会话布局。快捷卡片只填入草稿，工具输出和详情来自真实任务。
- 11 月 3 日的首次真实连接返回 HTTP 401。随后使用独立测试凭据，在同一指定 DS 模型和合成项目上，完成读取、审批后编辑、独立测试、流式停止、刷新与重启续接。五个任务中四个成功，一个按用户操作取消。这个结果限于当时的开发源码和该模型。通用 Provider、长时日用、Full 安装和 Electron 仍待验证。
- 11 月 4 日选定 B2 并接入原生 Host。真实 Pi 与本地回环模型通过读取、审批写入、拒绝、停止、刷新与新进程重启后续接；7 项 B2、99 项既有 UI、6 项原生/启动/许可测试通过。两项慢网络并发缺陷先复现后修复；这组受控结果不代替真实 Provider 或日用验收。[B2 源码与证据](../evidence/2026-11-04-b2-native-host.md)
- 11 月 4 日后续增量提供账号管理、文件工作区和原生输入操作。23 项 B2、99 项既有 UI 及针对性后端检查通过；同一干净源码上的 DeepSeek 五任务、独立项目测试、80 行长输出和新进程续接通过。受控队列另以原生历史与独立接收服务核对，未计为外部模型验收。[本轮记录](../evidence/2026-11-04-b2-accounts-workspace-input.md)
- 源码同步有独立的公开提交和本地检查记录。已发布的终端预览版有自己的版本与安装说明。[开发源码与检查](../minimal-webui.md) · [终端预览版](https://github.com/Ricardo121380/only-my-pi/releases/tag/v0.4.0-preview.2)

## 如何读旧工单

| 已有工作 | 在当前路线中的用途 |
| --- | --- |
| [#78 产品账号](https://github.com/Ricardo121380/only-my-pi/issues/78)、[#79 认证 MCP](https://github.com/Ricardo121380/only-my-pi/issues/79) | 已合入公开主线的 CLI 能力。 |
| [#80 / PR #90](https://github.com/Ricardo121380/only-my-pi/pull/90)、[#92 集成](https://github.com/Ricardo121380/only-my-pi/issues/92) | 原共享设置与整合工作。保留其失败记录，只按新核心的具体需求选用。 |
| [#91 输入](https://github.com/Ricardo121380/only-my-pi/issues/91)、[#39 历史元数据](https://github.com/Ricardo121380/only-my-pi/issues/39)、[#41 搜索](https://github.com/Ricardo121380/only-my-pi/issues/41) | 输入确认和历史身份可按行为复用。全文索引单独决定。 |
| [#84 材料](https://github.com/Ricardo121380/only-my-pi/issues/84)、[#81 模型绑定](https://github.com/Ricardo121380/only-my-pi/issues/81) | 按需模块。材料格式与分类、生图有各自的验收条件。 |
| [#82 会话发现](https://github.com/Ricardo121380/only-my-pi/issues/82)、[#83 交接](https://github.com/Ricardo121380/only-my-pi/issues/83)、[#94 桌面安装](https://github.com/Ricardo121380/only-my-pi/issues/94)、[#95 更新恢复](https://github.com/Ricardo121380/only-my-pi/issues/95) | 最终跨端与桌面目标。旧票仍反映创建时的依赖。 |
| [#93 后继 Pi](https://github.com/Ricardo121380/only-my-pi/issues/93) | 在固定的后继版本上验证公开接口与实际行为。当前开发依赖继续使用已核验的精确版本。 |

历史方案、失败和原始验收条件保留在原路径。处理旧功能时从对应 Issue 找到需求和消费者。只有替代路径已经通过、没有运行或打包消费者、并且有恢复点时，才移除旧实现。[10 月 17 日蓝图](2026-10-17-product-direction-and-iteration-plan.md) · [原 WebUI 规格](2026-10-01-webui-remaining-spec.md) · [Task 与验收映射](2026-09-26-webui-optimization-tasks.md)
