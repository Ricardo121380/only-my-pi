---
status: accepted
date: 2026-09-20
---

# ADR-0015: GUI 多账号独立存储并由会话显式绑定

用户需要同一 Provider 保存多个账号，但 Pi 的单份凭据存储按 Provider ID 只有一个凭据槽位。OMP 因此管理独立账号身份和每账号凭据存储，由会话显式选择账号，保留原 Provider ID，并保持 CLI 原默认配置的管理归属；本决策是已确认设计，尚未实现。

## 决策与取舍

- 不用重命名 Provider 冒充不同账号，也不反复覆盖一个全局凭据槽位。
- Host 账号管理使用公开 `ModelRuntime.create({ authPath, modelsPath, modelsStorePath })`；worker 启动时注入对应 ModelRuntime，保留共同会话历史和受控资源。
- 首版不自建 OAuth 协议或凭据存储引擎，复用 Pi 公共认证流程及文件锁。CLI 默认账号可以作为只读管理引用使用，GUI 自有账号的修改不覆盖它。
- 会话保存非秘密的账号绑定；任务停止后才能切换账号。账号失效、缺失或额度不足都不触发自动换账号，也不静默使用环境中的隐含凭据。
- 账号切换、登出和删除须在受影响任务停止后处理，重新启动 worker 并重新验证编程授权。CLI 多账号入口不在首版范围。
- 秘密不进入模型提示、启动参数、浏览器持久存储或日志。认证接口只返回脱敏状态，不能直接序列化 Credential 或带 credential 字段的错误。
- OAuth 登录按运行时能力呈现，首版串行执行；“登录失败”与“凭据已存、快照同步失败”必须分开报告。

独立存储增加了账号目录、会话绑定和缓存一致性工作，但能保持同 Provider 多账号的身份与秘密隔离；显式选择也让真实任务和验收结果可归因于具体账号，而不引入自动轮换规则。

## 依据与关联

- 用户选择：讨论记录 Q10、Q18、Q21、Q22，见[决策记录](../plans/2026-09-20-web-desktop-discussion.md)。
- [Pi v0.85.1 ModelRuntime](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/model-runtime.ts)
- [Pi 公共服务注入](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session-services.ts)
- [Pi CredentialStore 与认证交互合同](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/auth/types.ts)
- [总体架构](ADR-0014-webui-to-electron.md)、[完整计划与验收](../plans/2026-09-20-omp-webui-desktop-plan.md)
