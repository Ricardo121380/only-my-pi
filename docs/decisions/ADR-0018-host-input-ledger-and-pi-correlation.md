---
status: accepted
date: 2026-09-26
---

# ADR-0018: Host保存投递意图，Pi公开SDK携带消费关联标识

2026-10-17 状态澄清：本决定已有 [U1 整批实现与历史验收](../plans/2026-09-30-webui-u1-06-integration-acceptance.md)，Pi 1.1.0 另有[同候选适配验收](../plans/2026-10-13-pi110-integrated-acceptance.md)。新版接入或封装删减须重验所影响的行为，不能将这些结果直接转成 Pi 1.3.0 或双端交接通过。当前方向见[开发蓝图](../plans/2026-10-17-product-direction-and-iteration-plan.md)。

固定Pi 0.85.1的原生steer/follow-up响应仅证明入队，消费事件不带原RPC ID；已ACK但未消费的输入在worker崩溃后也不会保存到Pi历史。采用Host私有持久投递记录与Pi公开`sendCustomMessage`的`details.inputId`关联消费，不升级或修改Pi内核，也不把标识拼入模型文本。此段保留 2026-09-26 的接口依据，后续实现状态由上方证据说明。

Pi历史仍是已执行对话的权威，Host不另造一份对话历史。Host负责未发送草稿、队列、版本和投递意图；先原子保存`dispatching`再调用worker。收到SDK ACK只显示待生效；关联的custom message进入消费事件/历史后显示已消费，但这不等于模型已完成回答或工具已成功。

丢失ACK时按ID查询，不盲目再发；崩溃后查不到ID不能推断未执行，更不能自动重放。状态转待核对，保留内容与配置快照，由用户处理。跨进程exactly-once不在本次可证明范围，采用稳定ID、幂等准入和保守恢复。

相比直接原生steer，增加一个版本化的SDK/IPC桥及自定义消息呈现适配，换来相同文本的可靠区分。相比给消息文本加ID，模型输入不受追踪元数据污染。需要在U1/U2/U3继续验证图片补充、compaction后的关联历史、队列取消及渲染/检索兼容；这些不能用本次文本探针代替。

指定消息分支使用公开`runtime.fork(entryId, {position: "at"})`，不误用原RPC默认的“用户消息之前”语义；仍要由Host检查活动状态、源/目标会话身份与锁，不继承授权或队列。

依据：[U0接口合同](../plans/2026-09-26-webui-u0-contracts.md)、[实际Pi探针](../evidence/2026-10-18-local-development-history.md#local-965efbefb09536f7)、[SDK实验桥](../evidence/2026-10-18-local-development-history.md#local-99a255bf3b22ac80)、[本轮记录](../plans/2026-09-26-webui-u0-progress.md)。沿用项目既有`docs/decisions/`编号体系。
