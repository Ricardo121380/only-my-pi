# CPAR reasoning 修复后的 OMP 多轮验收

结论：**上次的生产 reasoning 能力阻断已解除；OMP 首轮推理、真实审批和非零用量回执通过，但批准后的第二轮请求被 CPAR 的 Responses 输入解析器拒绝。M2 仍未完成。** 新阻断是 `input` 中的 `type:"reasoning"` 历史条目未被接纳，不再是 `reasoning:false` 配置问题。

## 实测过程与范围

- 2026-09-25 用户再次告知“CPAR修复了，你继续看看呢”。本轮将其作为修复后一次有界重试授权，追加失败重试额度1，继承此前任务1/3、失败重试1/1；没有重置历史额度。CPAR 项目内单独授权的请求回放不计作 OMP GUI 验收成功。
- 产品候选仍为 `9130d0259bb53a82f8af290c994dc31fbdd8e028`，Pi 0.85.1、Node 24.19.0；安装栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。
- Ego Lite 任务空间3，原p1；安装 Host/UI/worker，临时GUI账号和合成项目。既有 `cpar-grok-build/grok-4.5` / Responses / low，输出上限2048；自动重试和自动压缩关闭，无Provider/身份回退。
- 时间：14:58:18–14:59:24 Asia/Shanghai。账号选择后第一次使用旧DOM引用失败，重新观察页面后继续；发生在发送模型任务前，没有重复请求。

| 验收点 | 结果 | 证据 |
| --- | --- | --- |
| CPAR 修复实际生效 | PASS | 活动配置 `production-grok-reasoning-20260925` revision1，Build候选override只含allow_unlisted_model；运行二进制SHA与已签名3a8e5af相同 |
| 首轮真实推理 | PASS | 返回request_coding_access工具调用；服务端首轮request/attempt/usage记录，attempt_outcome=succeeded |
| OMP 审批卡 | PASS，定向 | scope只有proof.txt，simple，三项orchestration均false；从页面批准后工具结果isError=false |
| 思考强度与用量 | PASS，首轮定向 | Host回读low；首轮input3209、output176、total3385、cache读写0；费用未知。最终2个模型回合中只有1个非零用量回执，界面显示部分回执 |
| 批准后模型续接 | FAIL | 第二轮返回HTTP400 ClientRequestError；Host显示MODEL_REQUEST_FAILED |
| 文件写入及回读 | NOT_RUN | write/read未执行，proof.txt保持before加换行。不能把审批工具成功称为写入成功 |
| 受管writer、撤权/取消 | NOT_RUN | 失败即停，保留原两个新任务额度 |

本轮用量是当前父任务已报告部分，不是完整账单。阶段累计任务 **1/3**；原失败重试 **1/1** 加本次追加 **1/1**，报告合计 **2/2**。后续不能重启脚本归零或用剩余新任务冒充同一失败项的额外重试。

## 可重复的根因证据

1. 本次会话中，第一条assistant消息含thinking与request_coding_access；批准后的toolResult成功。使用同一安装SDK的Responses序列化器重建下一轮请求，`onPayload`截获后主动中止，拒绝fetch计数为 **0**。这是合成验收历史的离线重建，不是生产网络抓包；系统提示与工具集合按离线夹具限定，结论聚焦历史条目结构。
2. 重建的input顺序为developer、user、reasoning、function_call、function_call_output。reasoning条目含id/status/type/content，content类型为reasoning_text；**本次没有encrypted_content**。仅分享结构和全合成最小样本，不复制实际思考内容。
3. CPAR `crates/protocol-openai-responses/src/lib.rs:441` 的 `decode_input_item` 只接纳function_call、function_call_output和带role的message，其他类型返回ClientRequestError。`crates/gateway-http-actix/src/lib.rs:1838` 在生成request context和usage observer前调用该解析器，因此这种400可发生在请求日志创建之前。
4. 使用当前CPAR源码库进行两组无网络回放：完整重建请求、全合成最小请求均在入口解析阶段返回ClientRequestError；每组仅删除reasoning条目的**诊断副本**均通过入口解析、CanonicalBridge投影、Grok Build编码/解码语义检查。删除行为只用于定位，没有修改OMP产品、真实请求或生产数据。

高置信度判断：这是一个已证实、足以阻断该续接结构的入口兼容缺口。CPAR本轮窗口日志找到首轮成功记录 `p1-request-b763edcc195a3e02ae4eb7b837c728cb-1`，没有找到第二轮结构化request事件；这与入口检查顺序一致，但不能把日志缺失本身作为唯一证据。生产原始请求没有抓取，修复后仍需真实多轮验收。

## CPAR 修复建议与完成标准

修复应由CPAR完成Responses reasoning历史条目的完整保留与回放：入口解码、Canonical表示、同协议投影、Grok Build编码一起收口。需要显式处理id、status、content/summary以及已支持范围内的opaque或encrypted数据，保持顺序和function_call/call_id关联；未知字段、错误类型、过大内容、重复字段、跨协议转换继续明确拒绝。不要把reasoning内容转换为普通可见assistant文本，也不要通过删除历史或把low改成off绕开验收。

最低回归矩阵：

1. 用本轮最小样本覆盖 `reasoning + function_call + function_call_output`，入口和同协议编解码均保持语义；覆盖合理的空summary/content及结束状态边界。
2. 覆盖伪造/无效字段、大小限制、跨协议拒绝，以及原工具调用回放不退化。encrypted_content仅在其所有权和保真语义被明确支持时测试，不把本轮无密文样本泛化为所有reasoning格式。
3. 用本地模拟Provider完成至少两个模型回合：首轮返回reasoning与工具调用，第二轮验证历史接收并返回终态；只验证首轮response.completed不足。
4. CPAR按其发布流程完成修复后，再授权一次OMP真实原任务重试。验收链为GUI发起→批准→write→read→终态/真实用量；通过后才使用剩余2个新任务完成writer与撤权/取消。

## 证据与收尾

证据目录：仓库外 `../artifacts/webui-phase2/live-cpar-sep25/`。

- `report.json`、`session-summary.json`：阶段额度、任务状态、脱敏消息形状、用量；`post-approval-failed.png`已查看，显示审批工具成功、任务失败、部分用量。
- `production-readback.json`：生产版本、候选配置、时间窗内脱敏日志，只读获取；未读凭据表。
- `continuation-shape.json`、`continuation-minimal.json`：可分享的结构与合成最小样本；`continuation-request-private.json`只留本机诊断，不作为对外示例。
- `offline-replay/`、`offline-replay.log`、`offline-minimal.log`：Rust离线复现入口、锁文件和两组正负对照；`../capture-continuation-sep25.mjs`记录SDK重建方式。
- `cleanup.json`：测试Host停止，临时凭据副本和配对清单删除，扫描未发现凭据泄漏，原CLI配置摘要一致。

本轮只更新OMP验收文档与仓库外诊断夹具；未修改OMP或CPAR产品源码、CPAR生产配置、日常安装、Pi版本。用户已有Glacier审计文档改动继续保留。Ego提示0.5.1.11有可用更新，本轮未升级浏览器，也未将更新可用视为F01已解决。M2保持IN_PROGRESS，普通输入绘制门禁仍未关闭。
