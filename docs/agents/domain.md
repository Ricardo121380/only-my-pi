# Domain Docs

## Layout

本项目采用 **single-context**。现有领域词汇和 ADR 继续使用以下位置：

```text
/
├── AGENTS.md
├── CONTEXT.md
└── docs/
    ├── agents/
    │   ├── issue-tracker.md
    │   ├── triage-labels.md
    │   └── domain.md
    ├── decisions/
    │   └── ADR-NNNN-<topic>.md
    └── plans/
```

`packages/` 是当前仓库的模块布局。新增领域划分应依据实际的独立上下文和已确认决策，沿用当前布局直到明确调整。

## Before exploring, read these

1. 完整读取根目录 [CONTEXT.md](../../CONTEXT.md)，理解项目、会话、账号、授权、写入协调、运行栈与验收的语言。
2. 按任务范围读取 [docs/decisions/](../decisions/) 中的相关 ADR，并检查其状态、日期和适用范围。产品边界与包拓扑见 ADR-0002/0003；终端编程涉及 ADR-0013；GUI、账号、生命周期、运行栈和输入协议涉及 ADR-0014–0018。
3. 处理开发任务时，按 [issue-tracker.md](issue-tracker.md) 定位对应 Issue 或尚未迁移的 Task，再完整读取相关计划、设计和验收约定。文档记录与实际实现分开核对。

架构、设计和交接文档由主代理亲自完整读取；即将修改的具体代码同样由主代理读取。子代理可定位出处和核验独立事实。

缺少领域文件时继续工作；在实际澄清术语或作出决策时，再用 `domain-modeling` 补充对应内容。

## Use the glossary's vocabulary

Issue 标题、规格、方案、代码和测试涉及领域概念时，使用 `CONTEXT.md` 的定义，并遵守其中的 Avoid 提示。遇到真实术语缺口时记录需要澄清的概念，避免自行引入与已有定义冲突的名称。

## ADRs and conflicts

新增 ADR 写入 `docs/decisions/`，先核对现有最大编号，沿用 `ADR-NNNN-<topic>.md` 编号体系，并记录状态、日期、原因及取舍。

输出或实现与已有 ADR 冲突时，明确引用冲突的 ADR 和原因，提出需要重新讨论的决策；得到相应决策后更新状态与继任关系，保留原决策的来源和历史。
