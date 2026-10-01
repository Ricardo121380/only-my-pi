# only-my-pi 项目规则

本文件所在目录是源码 Git 仓库。父目录中的分析报告、artifacts 和 archives 是材料或证据，按当前任务需要读取。

## Agent skills

### Issue tracker

任务和规格使用 GitHub Issues（`Ricardo121380/only-my-pi`）；处理任务或发布规格前，读取 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)，按其中的过渡规则定位尚未迁移的既有任务。

### Triage labels

使用五个默认 triage 标签；分类或修改标签前，读取 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)。

### Domain docs

采用 single-context：根目录 `CONTEXT.md` 和 `docs/decisions/` 中的 ADR。探索代码、讨论术语或设计决策前，读取 [docs/agents/domain.md](docs/agents/domain.md)。

## 开发与验证

- 子代理只做探索、检索和核验；实施、方案取舍及最终验证由主代理负责。架构、设计、交接文档和即将修改的具体代码由主代理亲自完整读取。
- 验证命令从根目录 `package.json` 及当前任务的门禁取得。文档配置修改检查内容、引用、格式和 diff；行为修改运行受影响的检查，批次验收完成该批必需门禁。
- 浏览器验收默认使用 Ego Lite 和 `ego-browser` Skill；不可用时记录具体阻碍及未完成项，替代工具按用户当次明确要求使用。
- 本地检查、实际 Pi、本地受控模型、真实 Provider、浏览器、Full 安装、日常晋升及公开发行分别留证。历史记录只在源码和适用范围匹配时复用；发布、安装切换和模型费用遵守当前任务的明确授权。
