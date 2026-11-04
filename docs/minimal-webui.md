# Run the native Pi WebUI from source · 原生 Pi WebUI 开发版

The WebUI development source lives on `codex/dev/pi-native-web`. The terminal Preview remains available via Homebrew, npm and GitHub Releases. Use a new clone for the steps below. [Development branch](https://github.com/Ricardo121380/only-my-pi/tree/codex/dev/pi-native-web) · [Terminal Preview](https://github.com/Ricardo121380/only-my-pi/releases/tag/v0.4.0-preview.2)

## Start a local demo on macOS Apple Silicon

Use **Node 24.19.0**. The root lock supplies Pi **1.3.0**. The external lock supplies the permission extension used by the development Host. From a directory where you want a new checkout, run the following commands.

```sh
git clone --branch codex/dev/pi-native-web --single-branch https://github.com/Ricardo121380/only-my-pi.git only-my-pi-web
cd only-my-pi-web
node --version   # v24.19.0
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix contracts/release/external --ignore-scripts --omit=peer --legacy-peer-deps --no-audit --no-fund
npm ci --prefix prototypes --ignore-scripts --no-audit --no-fund
npm run dev:web:b2:demo
```

1. Open the one-time pairing link printed in the terminal and add the printed demo project. The Host listens on loopback. In the UI select **CLI 配置（只读引用）** and **本地受控演示**.
2. Send `read project` and expand the tool result. Pi reads the demo project's README. The model responses come from a deterministic local server. No Provider account is required.
3. Send `stop stream`, then stop the task in the UI. Refresh and open the conversation to see its saved Pi history. Continuing requires an explicit selection and a new message.
4. Type `stop` in the terminal to shut down. Start the same command again and pair to see the project and history. Type `pair` if you need a fresh link. Keep pairing links private.

B2 演示默认监听 `127.0.0.1:4317`，数据保存在此检出的 `.omp-dev-b2-demo/`。前端变更会重新构建，看到 `Frontend ready` 后刷新。修改宿主代码需要重启。可用 `npm run dev:web:b2:demo -- --port 4318` 指定其他端口。真实模型配置入口是 `npm run dev:web:b2`，它使用 `.omp-dev-b2/` 中自己的配置。保留的最小布局入口是 `dev:web:demo` / `dev:web`，分别使用 `.omp-dev-demo/` / `.omp-dev/`。这些入口不自动导入日常凭据。只读模式下可查看项目，受控编程仍须明确审批。启动器将开发目录绑定到当前检出和依赖锁，更换检出时保留旧目录并选择新的数据目录。

## B2 frontend with the native Pi Host

The B2 integration combines the native development branch with the selected
[B2 design](../prototypes/DESIGN.md). Its live entry is the selected development baseline. If the prototype
dependencies were not installed in the steps above, install them before starting:

```sh
npm ci --prefix prototypes --ignore-scripts --no-audit --no-fund
npm run dev:web:b2:demo
```

The B2 entry keeps the paper/ink design, reading column, collapsible sidebar,
resizable workspace, theme and keyboard controls. Its live entry uses the shared
native session controller; the comparison prototypes remain available through
`npm --prefix prototypes run dev` and retain their simulated data.

在终端打开新配对链接，添加演示项目，明确选择账号和模型。发送 `read project`
可查看真实 Pi 工具回执与流式回复。新会话选择“受控编程”后发送 `request write`，
批准前不会创建 `approved.txt`；选择项和授权范围来自运行时。`deny write`
用于验证只读拒绝及失败回执，`stop stream` 用于验证停止。查看历史只发起读取请求，
需要点击“继续会话”并发送新消息才执行；新执行进程不继承旧授权。

B2 默认使用 `.omp-dev-b2-demo/`；`npm run dev:web:b2` 使用独立的
`.omp-dev-b2/`，供配置自己的模型服务。它们沿用原生 Host 的目录锁、请求去重、
一次性配对和 Pi JSONL 历史。指定相同、兼容的 `--data-dir` 可以在两种前端之间
切换；先停止占用该目录的启动器。Host 重启后必须重新配对，项目和历史仍保留。

工作区保留计划、改动、文件和终端标签。文件标签浏览实际目录和 UTF-8 普通文件，
工具目标可跳转到当前磁盘内容。改动标签显示暂存和未暂存 Git diff，不包含未跟踪
及排除文件；终端标签呈现实际 bash 回执。独立计划产物、差异应用和自由终端仍待接入。

使用真实模型时，在“设置”中添加 API Key 产品账号，填写服务地址、API 协议和模型列表，
保存凭据后明确选择测试模型。连接测试只发一次最多 512 输出 Token 的短请求，可能计费，
不执行工具、不创建会话、不自动重试。CLI 配置保留只读引用，账号不会自动切换。
本轮应用实测仅使用获准的 Commandcode DeepSeek 模型；基础会话未加载应用子代理。

运行中可在原输入框准备文字，再明确选择“即时补充”或“留待下一任务”。前者在 Pi
可接收的位置生效；后者在前驱成功并结算后开启同一会话的新任务，旧授权不继承。
队列显示已保存、已接收、已消费、暂停与未知；未投递项可编辑或移除。停止、失败或
未知会暂停后续执行，核对后需明确恢复。查看历史和核对输入都不会重发原请求。
持久草稿与统一首条提交仍按 #91 单独补齐，不把本轮接入视为整票完成。

390 像素小屏一次显示对话或工作区；用面板关闭按钮返回对话，组件状态保留。
账号、文件、输入、固定版本真实模型旅程与已知边界见
[2026-11-04 验收记录](evidence/2026-11-04-b2-accounts-workspace-input.md)。

```sh
npm run test:web:b2
npm run build:web:b2
node --test tests/b2-native-web.test.mjs
node --test --test-concurrency=1 tests/host-account-probe.test.mjs tests/host-workspace.test.mjs tests/host-minimal-input.test.mjs
```

B2 tests use its own React installation. The root `test:web` retains the existing
WebUI regression suite. The host build includes dependency notices and the
[documented upstream notice supplement](../prototypes/notices/README.md).

## Source and verification

The [source snapshot](https://github.com/Ricardo121380/only-my-pi/commit/516e8780f6fa8da7a73646ac075ae0595a340803) includes the [native session services](https://github.com/Ricardo121380/only-my-pi/blob/516e8780f6fa8da7a73646ac075ae0595a340803/packages/direct-agent/minimal-services.mjs), [WebUI](https://github.com/Ricardo121380/only-my-pi/blob/516e8780f6fa8da7a73646ac075ae0595a340803/webui/src/MinimalApp.tsx) and [source launcher](https://github.com/Ricardo121380/only-my-pi/blob/516e8780f6fa8da7a73646ac075ae0595a340803/scripts/dev-web.mjs). It builds on the already-public shared-settings candidate. That candidate's [required CI failure](https://github.com/Ricardo121380/only-my-pi/actions/runs/39915720380) and the October 22 main revision's [separate CI failure](https://github.com/Ricardo121380/only-my-pi/actions/runs/39733201211) remain part of the project record.

在开发分支可运行以下受影响检查。最小构建和双入口构建共用输出目录，应依次执行。

```sh
npm run typecheck
npm run build:web:minimal
node --test --test-concurrency=1 tests/direct-minimal-runtime.test.mjs tests/dev-web.test.mjs tests/host-minimal-web.test.mjs tests/host-tool-stream.test.mjs tests/host-catalog.test.mjs tests/direct-agent-launcher.test.mjs
npm run test:web
npm run build:web
```

On 2026-11-03 the commands above passed on a clean dependency install at the public source commit. The native/Host/launcher group passed 23 tests, and the WebUI group passed 99 tests in 17 files. Both frontend builds and all four TypeScript checks passed.

The earlier integration run also retained a legacy CLI argument assertion about `-- web`. The historical Provider result, release qualification, installed runtime, long-running use and CLI/WebUI handoff each have their own scope. [Development roadmap and dated evidence](plans/2026-10-25-pi-native-client-reset.md)
