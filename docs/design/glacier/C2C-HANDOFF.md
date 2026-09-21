[C2C]
STATE: DESIGN_READY
TASK_ID: glacier-webui-design
SCOPE: Conversation design artifact only
REPOSITORY_EXECUTION: NOT_EXECUTED
TARGET: only-my-pi
REQUIRED_CONNECTOR: Codex with ChatGPT · only-my-pi

GOAL:
在已认可的 Tide 设计基础上，保留分区 → 项目 → 会话，增加冰川蓝配色、适量玻璃与动效、独立底部 Terminal、输入框下方性能用量条。先 WebUI，后 React + Electron。不可引入“工作空间”导航对象，不照抄 Codex，也不把 SwiftUI 设为前置架构。

ARTIFACTS:
index.html 是可操作的自包含设计原型。
design-spec.md 给出统计口径、材质分层及接入原则。
integration-contracts.ts 只是拟议类型，不代表项目现有 API。
114 项 Chromium 断言通过；真实后端、PTY、React 工程和 Electron 未执行。

WORKSPACE_STATUS:
本轮没有获得指定连接器的工作区读取能力，未检查实际仓库。
没有通过其他连接器替代读取，也没有改动、打包或上传仓库。
不可从原型中的示例路径推断 only-my-pi 的真实目录或现有架构。

NEXT_EXPECTED_STEP:
先通过指定连接器执行 workspace_info。名称不是 only-my-pi 时停止。
名称匹配后，只读取必要的 package/前端入口/导航数据模型/运行事件与权限边界。
基于当前代码定位真实文件，再提出窄范围实现计划；不要把下面候选组件当成现有路径。

BOUNDED_IMPLEMENTATION_SLICES:
1. 现有 shell 与 tokens：保留正确三层导航，接入右侧／底侧两个独立状态；测试桌面、761px 边界、手机焦点返回。
2. TerminalDock：接宿主 PTY 或既有终端服务；Agent 输出只读，用户终端独立授权；关闭面板不终止进程；测试连接恢复、标签作用域、resize 和停止确认。
3. UsageStrip / UsageDetail：由后端归一化并记录请求级快照；缓存不重复加，未知不等于 0；按历史单价与货币汇总；测试重连去重、失败部分消费、切模型、缺字段、多币种。
4. 功能稳定后复用 React renderer 加 Electron 宿主适配，单独验证 preload／IPC／目录授权与打包。原生 macOS 材质不是 Web 验收前提。

ACCEPTANCE_INVARIANTS:
执行完成、人工审阅、Git 提交三者独立。
“继续”普通消息不是命令授权。
会话分支不继承授权、运行、排队或费用记录。
真实字段缺失不能用本原型 fixture 偷补。
真实演示／生产模式必须显式区分；fixture 不成为供应商报价或性能结果。
减少动效与透明度覆盖材质表现；不把所有内容做成玻璃。

REVIEW_AFTER_EXECUTED:
执行端报告 EXECUTED 后，审阅端通过指定连接器独立读 git 状态与差异。
execution_output 先 list；有可读项再 read。restricted 时忽略正文，从 git 审阅。
只报告已实际运行的测试与已确认的结果。
