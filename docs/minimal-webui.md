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
npm run dev:web:demo
```

1. Open the one-time pairing link printed in the terminal and add the printed demo project. The Host listens on loopback. In the UI select **CLI 配置（只读引用）** and **本地受控演示**.
2. Send `read project` and expand the tool result. Pi reads the demo project's README. The model responses come from a deterministic local server. No Provider account is required.
3. Send `stop stream`, then stop the task in the UI. Refresh and open the conversation to see its saved Pi history. Continuing requires an explicit selection and a new message.
4. Type `stop` in the terminal to shut down. Start the same command again and pair to see the project and history. Type `pair` if you need a fresh link. Keep pairing links private.

演示默认监听 `127.0.0.1:4317`，数据保存在此检出的 `.omp-dev-demo/`。前端变更会重新构建，看到 `Frontend ready` 后刷新。修改宿主代码需要重启。可用 `npm run dev:web:demo -- --port 4318` 指定其他端口。没有模型服务的独立开发入口是 `npm run dev:web`，它使用 `.omp-dev/` 中自己的配置。两个入口均不导入日常凭据。只读模式下可查看项目，受控编程仍须明确审批。启动器将开发目录绑定到当前检出和依赖锁，更换检出时保留旧目录并选择新的数据目录。

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
