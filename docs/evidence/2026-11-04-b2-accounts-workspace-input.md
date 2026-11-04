# B2 账号、文件工作区与原生输入验收

日期：2026-11-04。范围：macOS Apple Silicon 的开发源码、实际 Pi 1.3.0、Ego Lite、指定 Commandcode DeepSeek 账号，以及独立的本地受控服务。

## 源码与运行身份

功能提交为 [`c6c3f86d78b31edb8f43385aee208d96be16741d`](https://github.com/Ricardo121380/only-my-pi/commit/c6c3f86d78b31edb8f43385aee208d96be16741d)，tree 为 `0c523f1dee137ab95c6ec8c09913d68ed3cd1a2c`。账号提交为 `660db366e7a147db27c9ba31f124a0b9ea23e30e`。B2 基线已通过 [PR #97](https://github.com/Ricardo121380/only-my-pi/pull/97) 合入 `codex/dev/pi-native-web`。最终真实模型旅程期间，检出保持在干净的 `c6c3f86`；本文和使用指南是后续文档增量。

| 输入 | 身份 |
| --- | --- |
| Node | `24.19.0`，可执行文件 SHA-256 `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1` |
| Pi | coding-agent / agent-core / pi-ai 均为 `1.3.0` |
| 根 lock | SHA-256 `5e073aa01af1b9414818cb2e2026d406b636aade46868e12b6a9ba27e8d893a1` |
| B2 lock | SHA-256 `3038c65d77c54b6af316eb72885de493c7c7d671c0d42c682f53a7b8319a817f` |
| 真实模型 | `commandcode/deepseek/deepseek-v4.1-flash`，`low`，测试配置最大输出 4096 Token |
| 隔离项目初始 Git 提交 | `1cdbda949ed0144883b7070e3b6de83bcf77a726`，原始两项测试均失败 |
| 原生会话 | `01a1a4d7-2a96-7377-83ba-f5789adb9b2c` |

两种构建入口使用各自已锁定的 Vite，产物分别记录。浏览器 HTTP 字节与实际开发 Host 的资产文件逐项相符。

| 构建 | JavaScript SHA-256 | CSS SHA-256 |
| --- | --- | --- |
| `npm run build:web:b2`，B2 Vite `8.3.5` | `b3505eb8a3ef581ac0da590d75ec8a89922c785737a77fb299ed0e17a7a200ce` | `ee12f8086f356dae0b7d7f60a24100e102a5222233e24eb6f28a58faadcf042a` |
| 开发 Host，根 Vite `8.3.0`，host/watch | `eb10e64be85fff0542417ee0879a3c0fc69f163f4ff9450b5bddf1adf7c82fae` | `ee12f8086f356dae0b7d7f60a24100e102a5222233e24eb6f28a58faadcf042a` |

开发 Host 的 stack ID 由检出位置、锁、Node 和 Pi 组合生成，`sourceCommit` 为 null；它本身不标识一次源码提交。本次使用上述 Git/tree、二进制、锁和实际资产哈希补充源码身份。后继 Pi 适配仍由 [#93](https://github.com/Ricardo121380/only-my-pi/issues/93) 单独验收。

## 实际交付

- B2 设置提供产品 API Key 账号创建、改名、凭据保存/状态/登出、完整聊天模型配置读取及保存、显式选模和一次连接测试。CLI 默认配置继续只读引用。连接测试最多 512 输出 Token、不用工具、不创建会话、无自动重试；401/403、429、超时和不完整响应分开呈现。请求取消后，账号占用延续至实际子进程退出。
- 文件标签读取真实项目目录和 UTF-8 普通文件；继续使用 512 KiB、目录边界、符号链接与排除文件限制。改动标签显示实际暂存和未暂存 Git diff，排除未跟踪及禁止预览的路径。read/edit/write 回执只投影项目内目标路径，文件内容、edits 和原始参数不随目标元数据公开。目标跳转读取当前磁盘内容；工具成功与当前 Git 差异分别呈现。
- 即时补充复用 Pi 的公开 `sendCustomMessage(..., { deliverAs: "steer" })`；排队复用现有 Host 持久输入记录和 FIFO，前驱成功并结算后开启同一会话的新任务。每个后续任务从 Inspect 起步。B2 支持未投递编辑/移除、两级 revision/CAS、消费核对和显式恢复；已接收、已消费、暂停和未知分开显示。未知结果不自动重发，未处理队列阻止普通续接绕过核对。
- 保留 B2 的颜色、阅读列、主题、快捷键和桌面可调整工作区。390 像素时一次显示对话或工作区，来回切换保留组件状态；900 像素保留双栏。
- CI 将 Host 输入、文件工作区和账号探测归入 Web 检查，每个 Node 文件仍只分配一次；共享后端修改继续触发所需旧 CLI 与安装回归。

## 指定真实 Provider 的五个任务

应用实际模型仅使用上述 DeepSeek。基础会话未装配或调用应用子代理。外部 Codex 测试代理与应用账号、模型分别处理。

| 旅程 | Task ID | 结果与独立核验 |
| --- | --- | --- |
| 新项目只读读取 | `2daf2d6c-9885-4c11-a32a-ce3211c35d61` | succeeded；三次 read；返回未写入提示词的随机 README 标记，指出两项原始失败 |
| 审批后修复和测试 | `ac10e9b6-89f9-4a9e-8cbb-ded326b5035f` | succeeded；待审批时刷新仍保留同一操作，批准前 Git diff 为空；仅 `src/total.mjs` 从加法改为乘法；模型运行测试后，主线程再次独立运行，两项通过 |
| 流式停止 | `4dd242b6-ab0b-4479-875a-ec085df5c4fb` | cancelled；实际流式文字出现后停止，无工具调用；终态后进程回收、access 为 Inspect |
| 新进程显式续接 | `69c6572f-1022-431d-99be-45cf67b2ffb7` | succeeded；PID `78626` → `79330`，epoch 改变；旧 Host 认证返回 401；重新配对后仍是 11 个既有任务，明确发送才增加任务；Session ID 相同，修复仍在，无旧编程授权 |
| 完整长输出 | `700a72f4-2ac5-43a3-aa66-30c0d7b37c8b` | succeeded；80 个唯一编号、2189 字符、正常 stop 和结束标记均核对；刷新仍可见第 80 行，任务总数保持 13 |

这组冻结旅程为四次成功、一次主动取消；同数据目录此前的三次 DeepSeek 探索与受控任务另外保留，没有混入五个任务的通过数。费用以 Provider 为准，未报告的估算费用保持未知。

最终历史重载捕获的脚本异常、未处理拒绝和 console.error 为零，localStorage/sessionStorage 无测试密钥。合成 CompositionEvent 期间 Enter 没有提交任务、中文正文保留；此项不代替系统输入法验收。测试结束后 Host/模型服务停止，worker 数为零；仅删除此隔离环境的两份测试账号 auth 文件、临时 key 输入副本和失效配对 URL，保留项目、Pi 历史与失败记录。原 dsh 和日常凭据未修改。

## 受控服务、回执与回归

Ego Lite 通过公开 B2 入口完成一次 steer、三条 queue、编辑第二条、移除第三条。三条有效输入分别进入原生历史，按 inputId、正文、contentDigest、entryId 对应；移除项没有历史载体。随后关闭页面连接并阻断网络，界面进入断线且禁用发送，重连仍为同一执行；停止后后续输入保持 paused，只有明确恢复才开启新任务并消费。原生历史中共四个唯一有效载体，独立回环接收服务记录七个请求（原读取/补充三次、两次 FIFO、停止流一次、显式恢复一次）。刷新、回查未增添任务或消费载体。

本地检查均成功退出；不把同一组的重复运行相加：

| 检查 | 结果 |
| --- | --- |
| B2 Vitest | 23 tests / 4 files |
| 既有 WebUI Vitest | 99 tests / 17 files；其中共享输入 14 项另作针对性回归 |
| 账号探测 | 5 项；选定身份、401/429、配置保密、取消占用、公开 minimal API |
| 工作区/catalog/tool stream | 9 项；分页前路径关联、参数隔离、文件边界、Git 不执行外部程序 |
| minimal 公开输入 | 1 项；实际 Pi、steer、编辑/移除、FIFO、持久消费 |
| 实际 Pi RPC 输入 | 10 项；安全边界、启动、丢 ACK、失败、取消、SIGKILL、重开与清理 |
| Host server / minimal 核心 | 10 项 |
| CI 路由合同 | 7 项；单次分配、必需失败、跳过和来源约束 |
| 类型/构建/静态 | 四项 TypeScript、B2 host build、lint、secret scan、diff check 通过 |

可复用的针对性命令：

```sh
npm run test:web:b2
npm run test:web
npm run typecheck
npm run build:web:b2
node --test --test-concurrency=1 tests/host-account-probe.test.mjs tests/host-workspace.test.mjs tests/host-tool-stream.test.mjs tests/host-catalog.test.mjs tests/host-minimal-input.test.mjs tests/host-input-rpc.test.mjs tests/host-server.test.mjs tests/host-minimal-web.test.mjs tests/ci-plan.test.mjs
```

## 保留的失败与边界

| 观察 | 处理与归属 |
| --- | --- |
| 旧 dsh 凭据 401 | 找回此前获准的测试凭据；真实 DeepSeek 连接及五任务已通过；未要求再次提供 key |
| 把 Terra 请求送入 Commandcode 的 403 | 属于外部测试路由误用，不计为 DeepSeek 应用失败；后续 Codex CLI 路由认证也未成功，Terra Max 外部代理仍为 NOT_RUN，未以其他模型冒充 |
| 429 响应含 authentication_error 文案 | 先按 HTTP 状态分类；受控 401/429 区分通过，保留初始失败 |
| 再选当前账号使模型列表为空 | 同账号选择改为幂等；B2 回归和后续实际选择通过 |
| TS1294：输入异常类的参数属性 | 使用等价的字段赋值，保留严格编译配置；两种前端构建通过 |
| 窗口缩到 390 像素后半屏挤压；首次修复仍留空白 | 首次隐藏的是 Panel 内层，后改为隐藏尺寸包装层；原图与首次修复 RED 保留；最终对话/工作区各 374 像素，桌面缩小与直接打开均通过 |
| 密钥扫描命中字面量 Bearer fixture | 测试期望改为复用同一合成凭据变量；未增加扫描忽略项，最终零命中 |
| 把 Host 的 JS 与独立 CLI 构建比较产生哈希断言失败 | 查明两个锁定 Vite 调用者；保留两组哈希，改为将 HTTP 字节与实际服务资产比较 |
| 新测试的 200/202、重复文件按钮与 fieldset 禁用断言 | 修正测试对既有 HTTP/DOM 合同的表达；未放宽生产断言或提高超时 |

本地原始记录位于本轮 `checks/`，包含 `b2-c6-source-manifest.json`、`b2-c6-host-asset-manifest.json`、`b2-c6-real-summary.json`、原生历史证明、测试日志和 RED 截图；凭据与原始服务认证内容未提交。

尚待完整验收：多日连续使用、系统真实 IME、完整 [#91](https://github.com/Ricardo121380/only-my-pi/issues/91) 持久草稿/统一提交及跨端准入、后继 Pi、CLI/WebUI 配套交接、日常安装晋升、Electron 与公开发行。旧 [#80 / PR #90](https://github.com/Ricardo121380/only-my-pi/pull/90) 的失败记录与 UNKNOWN 保持原归属。
