---
status: accepted
date: 2026-09-20
---

# ADR-0014: 以共享 WebUI 和 OMP Host 演进到 Electron 桌面端

用户经分轮讨论确认 **React + OMP Host + Pi RPC → Electron**：保留已有 Pi/OMP 运行能力，以本机 WebUI 作为中间产品，再由 Electron 承载共享界面。该选择优先复用现有受控启动、编程授权、子代理和验证流程，并减少后续桌面端重复建设业务界面的成本。状态为设计已接受，尚未实施或验收。

## 取舍

直接移植 Pi-Desktop 需要处理其 Rust Host、策略与数据模型和 OMP 的差异；移植 DeepSeek Harness 需要协调 DSH 与 Pi 两套运行语义；Tauri 需要额外处理 Node sidecar 与系统 WebView。当前选择以现有 OMP 为演进主体。

## 决策边界

- 第一阶段固化运行基线、在隔离候选栈验证 Pi 0.85.1，交付 Host 与只读 WebUI，并在 M1-T 技术通过后完成日常 CLI 切换、回滚及同候选重新应用（M1-I）；第二阶段交付可日用 WebUI；第三阶段交付 macOS Apple Silicon 自用安装包。
- 首版面向用户本人、本机单用户，采用中文三栏工作台，包含 GUI 多账号、基础代码编辑器和人工终端。保留现有 Linux CLI；Linux GUI、Windows、英文、远程访问与团队协作后续安排。
- 执行平面采用 Pi 正式 stdio RPC。Host 账号管理与受控 worker 启动注入使用同版本公开 API；不以实验性 Pi server/client 或私有 AuthStorage 为依赖边界。
- 保留 Pi 对模型、Agent loop 与会话历史的归属；OMP 管理产品控制事实、账号绑定与写入协调。共享历史只续接已停止会话，续接不恢复编程授权。
- [ADR-0015](ADR-0015-gui-account-isolation.md)确定多账号隔离；[ADR-0016](ADR-0016-host-lifecycle-and-project-writer-ownership.md)确定后台生命周期与项目写入所有权。
- [ADR-0017](ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)确定新旧运行合同兼容、栈内扩展副本和日常安装晋升；开发依赖升级不能替代实际候选和安装验收。
- 现有 CLI/TUI 的行为仍以[ADR-0013](ADR-0013-direct-terminal-coding-agent.md)与当前代码为基线。GUI 新入口不能通过放开普通 headless 权限实现。
- 用户负责产品方向，Codex 实施；阶段必需门禁通过后自动继续，不重复要求人工阶段批准。必需验证缺失或失败时不能标记通过。
- Open Design 中的 K3 为可选设计辅助：先核实入口与精确模型身份，可用则按该路由使用；不可用时说明，由当前 Codex 继续，不静默改用其他外部模型。
- 当前三阶段交付到自用安装包；签名公证、正式发布渠道和公开发布另设里程碑。

## 依据与执行入口

- [完整开发与自动验收计划](../plans/2026-09-20-omp-webui-desktop-plan.md)
- [Q1–Q22 讨论决策及共同理解确认](../plans/2026-09-20-web-desktop-discussion.md)
- [第一阶段详细计划](../plans/2026-09-20-omp-webui-phase1-plan.md)
- [第一阶段 P1-Q1–Q9 决策记录](../plans/2026-09-20-omp-webui-phase1-discussion.md)
- [Pi v0.85.1 正式 RPC](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md)
- [Pi-Desktop 固定快照架构](https://github.com/vastsa/PI-Desktop/blob/dad08fe602511f0a71c6e90614c2d398c8daeb23/docs/spec/02-architecture/01-architecture.md)
- [DeepSeek Harness 固定快照桌面实现](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/apps/desktop/README.md)

本记录沿用仓库既有 `docs/decisions/ADR-NNNN-*` 约定。以上版本是一手调研快照，不是日后执行时自动追踪 latest 的指令。
