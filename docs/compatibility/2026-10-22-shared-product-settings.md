# CLIENT-02A / #80：共享产品设置验收记录

2026-10-22（Asia/Shanghai）。**整票 PARTIAL / B BLOCKED，#80 未完成。** 设置、CLI/真实 Pi、本地受控服务和受影响 Linux 回归已有通过证据；实际 Ego Lite 双端操作链路尚未完成，不能汇总为 GCLIENT-02 PASS。使用入口见[共享设置指南](../shared-product-settings.md)。

## 基线、源码与运行身份

开工 `main = origin/main = e714c89a68c03e3fa42031aa5c1d0590f5cc60ab`，暂存区和工作树干净；末次远程回读 main 仍是该 SHA。独立分支 `codex/feat/shared-product-settings`，没有合入私有恢复分支，没有 reset、clean、stash 或整体暂存。#78/#79 CLOSED / completed，#89 已合并且其 PR 检查成功；#80 仍 OPEN。

| 本地提交 | 内容 |
| --- | --- |
| `18c4dbe888da1128b91d1d9c2ba716aac3c28086` | 共享设置、CLI/GUI、快照与 Pi 装配、初始测试及使用说明 |
| `22159d0c4d4a5fe9d2c1ee8f1591b8099e9f25da` | pack allowlist 夹具避免重复已必需的 YAML 条目 |
| `45dfd795a14fb9d9a35bbdb9037d7ba159bf970e` | 技能名称类型、原生技能即时撤权、模型快照绑定、失败加载状态 |
| `d8c719fb6a11158d4b477c00d10c08fb1b6365c3` | 保存前拒绝畸形项目范围及容量超限；最终功能源码身份 |

Node **24.19.0**，精确 Pi **1.3.0**，macOS Apple Silicon。manifest/lock 未升级 Pi；YAML 2.9.0 从既有 Pi 锁定依赖显式声明为本产品运行依赖，pack allowlist 和第三方许可相应更新。2026-10-22 核对 [npm latest](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest)及[官方稳定 Release v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0)（2026-10-21T22:49:48Z），当前保留一个 minor 的差距，不在 #80 升级。

私有证据根为工作区 `artifacts/client-02a-20261022-odor6m6p`，不进入源码提交。`source80-boundary-manifest.json` 绑定最终功能提交的 1706 个跟踪文件字节、执行位和符号链接；`source80-final-manifest.json` 保留 `45dfd79` 的相同粒度身份。Linux 前后均全量核对这些文件、Node 二进制摘要及 Pi manifest。逐段日志、Pi 接收内容、PTY transcript、命令/退出码和原始失败保留，不以最终证据文档提交充当功能重跑。

实际可选资源为仓库已有 `context-doctor@0.1.0`，本轮声明有界 `label`，由真实 Pi 的 `context_snapshot` 及 TUI 状态消费；入口和 metrics 绑定字节摘要。技能样本为明确标识的本地受控 Markdown，由 Pi 公共加载器与原生 `/skill:` 路径加载和展开。它们不是真实外部 Provider 或任意扩展市场的证明。

## 六条 AC

| AC | 已核实证据 | 结论与缺口 |
| --- | --- | --- |
| 1 最小双端入口及完整加载链路 | `omp settings` 和 GUI 设置入口已实现；最终源码的 CLI→公共 Host 回读、Host→Pi 标签、反向 CLI→Pi 标签、原生技能 PTY 展开均通过；默认/覆盖/重置/持久化有真实进程检查 | **PARTIAL**：C/P PASS；尚无实际 GUI 编辑到运行的 B 完整演示 |
| 2 单一权威、覆盖与显式导入 | OMP 工具/技能复用 config-runtime；现有 MCP/模型保留原存储并组合单一任务版本；A/B 隔离、来源/差异、摘要 CAS、导入停用及原件不变均通过。模型实际调用使用准入快照而非临时重读值 | **C/P PASS**；GUI 导入的实际操作仍待 B，不扩大到 #50–#52/#56 |
| 3 真进程 CAS、拒绝与最后有效值 | 两个真实 CLI 同 revision 仅一个成功；非法参数、无 Schema、未知来源、不兼容、必需集合关闭、YAML 名称非字符串均拒绝。真实 Pi 语法加载失败及技能摘要变化不发新模型请求；保留成功回执并明确 pending/失败。同版本失败不会显示已加载。畸形 scope、1001 项项目容量在发布前拒绝，原配置字节保留 | **C/P PASS**；GUI 失败展示的实际操作待 B |
| 4 冻结、旧队列和立即阻断 | 活动真实 Pi 保留旧标签；旧 FIFO 暂停且请求数不增，显式改绑定与单独 resume 后才执行；停用再启用不复活旧工具或原生技能快照；同一 TUI 的下一逻辑任务才重载；既有 agent_settled、MCP 凭据撤权、unknown 不重放及退出回归通过 | **C/P PASS**；实际 GUI 核对、保存、明确投递链路待 B |
| 5 实际 CLI/GUI 相互修改、回读及运行 | CLI 与公共服务/Pi 双向链路已通过；React 入口、参数编辑、导入、任务配置与显式队列操作已实现 | **BLOCKED**：Host API、单测和页面连接均不能替代实际 Ego 操作；未完成此 AC |
| 6 必需 C/P/B、身份与分轴评审 | 精确源码、运行组合、独立接收、原始 RED 和受影响回归已记录；Standards 问题修复并独立复核，Spec 三项缺口已独立关闭；Linux 保留既有 CLI 范围 | **PARTIAL**：C/P 与 Linux 通过；B 尚未完成，因此整票不通过 |

## 验证与可复核回执

以下命令均通过配套 Node 24.19.0 执行；实际二进制绝对路径、SHA-256 和运行文件来源保存在私有回执。`--test-concurrency=1` 是这些实际进程旅程的执行组合，未提高产品或测试超时。

| 命令或用例 | 源码与结果 | 原始回执 |
| --- | --- | --- |
| `node --test --test-concurrency=1 tests/product-settings.test.mjs tests/product-settings-pi.test.mjs tests/model-call-runtime.test.mjs` | `d8c719f`，**13 PASS，退出 0**。包括真实 CLI/CAS、Pi/PTY、原生技能撤权、LKG、FIFO、同 TUI 下一任务、实际分类接收 | `candidate-settings-final.log`，`pi-*.json`、`pty-*.json`、`skill-revocation-*.json`、`tui-refresh-*.json` |
| `node --test --test-concurrency=1 tests/cli-account-pi.test.mjs tests/cli-account-oauth.test.mjs` | `45dfd79`，**3 PASS，退出 0**；实际账号、PKCE/OAuth、本地模型调用、缺失/失效凭据、取消/超时 | `accounts-serial-diagnosis.log`及对应 `CLIENT-01A` JSON |
| `node --test --test-concurrency=1 tests/cli-mcp-config.test.mjs tests/cli-mcp-pi.test.mjs tests/cli-mcp-queued.test.mjs` | `45dfd79`，**6 PASS，退出 0**；独立 CLI token/OAuth、真实 Pi codemode、逐调用审批、跨进程撤权、unknown 不重放及 agent_end 原生队列至 agent_settled | `mcp-serial-final.log`及对应 `CLIENT-01C` JSON |
| `node --test --test-name-pattern='received HTTP disconnect stays unknown' tests/host-mcp-http.test.mjs` | `45dfd79`，**1 PASS，退出 0**；本地复核远程 main 失败诊断中的实际用例，不能抹掉远程失败 | `baseline-D15-HTTP-focused-final.log` |
| 真实 Host readonly / controlled SIGKILL 恢复定向回归 | 较早本轮源码，**2 PASS**；保留原输入未知及无自动重放，不充当最终源码完整回归 | `crash-real-source.log` |
| Linux 既有 CLI 受影响 12 文件集合（launcher、TUI/RPC/session、ownership、真实 Pi CLI/terminal、settings） | `45dfd79`，Node 24.19.0 / Pi 1.3.0，**143 PASS，退出 0**。`d8c719f` 再跑改变的 `tests/product-settings.test.mjs`，**4 PASS，退出 0**；其余 139 项相关运行代码未变 | `run-linux80-final.py`、`linux80-final-*.log`；`run-linux80-boundary.py`、`linux80-boundary-*.log` |
| `npm run test:web` | `d8c719f`，**11 文件 / 40 PASS，退出 0**；这是 jsdom，不是 B | `candidate-web-tests-final.log` |
| `npm run typecheck`、`npm run lint` | `d8c719f`，**PASS / 退出 0**；lint 1706 文件、无发现 | `candidate-types-final.log`、`candidate-lint-final.log` |
| `node --test tests/docs-links.test.mjs tests/package-governance.test.mjs` | 最终文档，**13 PASS，退出 0** | `candidate-docs-final.log` |
| `npm run pack:check`、`npm run secret:scan` | 最终源码及文档，**PASS / 退出 0**；1843 打包文件，1706 跟踪文件，无发现 | `candidate-pack-final.log`、`candidate-secrets-final.log` |
| `npm run build:web` | `45dfd79` 的最终 React 源码，**PASS / 退出 0**；该后端边界提交未改前端。保留既有大 chunk 提示 | `web-build-review-fixed-correct-command.log` |

账号/MCP 3+6 项在 `d8c719f` 的复用范围仅为既有账号/凭据/逐调用和生命周期路径；新提交只增加设置请求的错误 scope/容量拒绝，未更改这些运行路径。新增设置路径全部由最终源码 13 项覆盖。早期 82 项合同、13 项 CLI/TUI、40 项 WebUI 及打包回执仍按原日志身份保留，不累计成最终源码 Full。

Linux 使用既有专项 Colima profile，缓存的 `node:24.19.0-bookworm` 镜像 `sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`；两个新的独立容器均 `--network none`，使用既有缓存执行 `npm ci --offline` 及 test:prepare。实际网络拒绝为 `ENETUNREACH`。测试前后源码一致，容器及 VM 已停止，Docker 默认 context 前后均为 `default`。最初误启动默认 Colima VM 后已恢复原停止状态；正式两轮只使用专项 profile。这不是新增 Linux 全能力、日常安装或发行验收。

## RED、复核与处置

- 公开 `omp settings list` 原先被当成 Agent 输入，报 `OMP_CONTROLLED_STACK_UNAVAILABLE`；保留 `red-cli.log` 后增加独立管理入口。
- 诊断工具最初被原权限扩展拒绝。适配仅准入已选择的无 I/O `context_snapshot`，上游显式 deny、账号及 MCP 审批保留。
- 输入桥的 resourceRevision 固定 0 导致显式改绑定后仍拒绝；改成任务固定版本。分类草稿旧测试也从公共设置接口取当前版本，保留实际绑定断言。
- 直接 `session.reload()` 导致第三方用量组件持有失效 UI ctx；改用 Pi 公开命令上下文 reload；原崩溃、修复后的同 TUI 实际加载回执均保留。
- 初轮 Linux **119 PASS / 18 FAIL / 5 CANCELLED**：通用 SDK/子运行夹具不装配 OMP 诊断工具、精确工具清单陈旧。修复装配适用范围和实际清单后取得上述 Linux 证据；没有扩大超时或删掉字段断言。
- 首次账号/MCP 并行旅程出现账号 60 秒取消与 OAuth TUI 就绪超时；完整保留 `accounts-pi-oauth-final.log`、`account-mcp-final-regression.log`。后一失败残留的测试 PTY 经识别进程组后终止，不记为正常产品退出。串行、原时限重跑取得 3+6 PASS；并发时序敏感性仍是该早期执行组合的限制。
- 第一轮独立 Standards：YAML 名称数组被 regex 隐式转字符串；第一轮 Spec：活动原生技能绕过撤权、CLI 模型快照未绑定、同版本加载失败仍显示已加载。`review-red.log` **4 FAIL / 7 PASS** → `review-green.log` **11 PASS**；没有弱化断言。
- 后续 Standards：畸形 scope 落入全局、项目容量发布后才失败。`admission-red.log` **2 FAIL** → `admission-green.log` **5 PASS**，最终功能源码全组 **13 PASS**。同时在发布前检查 1 MiB 及整数上溢，导入复制移到容量检查之后。

**Standards：已报告问题全部修复；独立关闭复核 PASS。** 最后复核针对 `45dfd79..d8c719f` 及邻近代码，无剩余可执行问题；未声称再次全仓审计。

**Spec：限定源码复核 PASS；整票验收 PARTIAL。** 独立复核确认三项原缺口均关闭；其结论仅覆盖源码及对应测试设计，不能替代实际测试或 B。#81 的新分类/生图绑定、#82/#83 的发现/交接未并入本轮。

## Ego Lite 阻碍与未完成项

本票原 Ego TaskSpace `3` 曾用于连接和定位页面，但未完成实际设置修改/运行验收。最终源码准备验收时，`taskSpace(3)` 返回 `task space not found: 3`，当前 `listTaskSpaces()` 返回 `[]`；回执见 `ego-final-01.log`、`ego-missing-space-inventory.json`。未静默更换浏览器，也未用 API/DOM 代替实际双端操作。

适用 ego-browser Skill 明确要求不能用新 TaskSpace 恢复丢失空间，无法继续时须询问用户；已请求重建空间的许可，当前尚未取得答复。受控 Host 已停止；不安排未经确认的后台继续执行。AC1 的实际 GUI 完整演示、AC5 和 AC6 的 B 仍未完成；AC2–4 的 GUI 交互覆盖也待同一验收补齐。恢复后须使用最终功能源码新建受控运行环境，完成实际 GUI 默认/覆盖/重置、CLI 反向回读与运行、GUI→真实 Pi、冲突草稿保留、技能显式导入、活动快照与旧队列核对/明确投递，以及失败状态展示。

## CI、同步与范围

开工 main run [39733201211](https://github.com/Ricardo121380/only-my-pi/actions/runs/39733201211) 后续结束为 **FAILURE**：Node 24.19.0 在 M8 D15 超时（1802030 ms），诊断包含 HTTP disconnect unknown 不重放；M11 Q10 skipped。原始失败日志保留为 `baseline-main-ci-failure.log`。它是 `e714c89` 的远程结果，既不是本票候选检查，也不因本地定向 PASS 改判。

本地验证按配置/权限/生命周期/打包风险选择合同、实际进程及 Linux 回归，不额外触发远程 CI。候选 CI **NOT_RUN**：尚无推送、PR、合并或工单关闭授权。main 保护已刷新，strict=true，必需检查为 **Node 24.19.0**、**M11 Q10 macOS arm64 clean-home**；未来进入受保护合并必须完成实际必需检查，不放宽门禁。

安装、日常切换、桌面、真实外部 Provider、付费调用和产品发行均 **NOT_RUN**。只有本轮代码、必要文档和测试增量进入本地提交；没有远程写入。下一项仍为完成 #80 的实际 B，然后再判断整票及 GCLIENT-02 汇总；不将 #81 或完整资源页面提前当成本票完成条件。
