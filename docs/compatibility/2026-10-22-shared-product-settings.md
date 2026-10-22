# CLIENT-02A / #80：共享产品设置验收记录

**2026-10-23 公开工程收口进行中：** 已按本轮授权推送独立分支并创建 [PR #90](https://github.com/Ricardo121380/only-my-pi/pull/90)。首次必需 CI 在旧测试夹具的诊断资源装配和精确工具清单处失败；已保留 RED，并以仅测试提交 `e142b8bcce14605ef3ddc1e54c05d70d40c73da0` 修正，产品运行源码不变。当前 #80 仍 OPEN、未合并，保护条件未放宽。下方 2026-10-22 的本地验收、未同步及授权状态保留为当时快照；本次增量见文末。

2026-10-22（Asia/Shanghai）。**#80 六条 AC 本地验收 PASS：C/P、实际 Ego Lite B 及受影响的既有 Linux CLI 回归均已完成。** 用户明确允许重建丢失的浏览器任务空间后，完成两端修改、回读、下一真实 Pi 任务加载，以及冲突、失败、冻结、旧队列与撤权的正负路径。GitHub #80 仍 OPEN，尚未推送或公开收口；本结论也不汇总整个 GCLIENT-02、安装、发行或真实外部 Provider。使用入口见[共享设置指南](../shared-product-settings.md)。

## 基线、源码与运行身份

开工 `main = origin/main = e714c89a68c03e3fa42031aa5c1d0590f5cc60ab`，暂存区和工作树干净；末次远程回读 main 仍是该 SHA。独立分支 `codex/feat/shared-product-settings`，没有合入私有恢复分支，没有 reset、clean、stash 或整体暂存。#78/#79 CLOSED / completed，#89 已合并且其 PR 检查成功；#80 仍 OPEN。

| 本地提交 | 内容 |
| --- | --- |
| `18c4dbe888da1128b91d1d9c2ba716aac3c28086` | 共享设置、CLI/GUI、快照与 Pi 装配、初始测试及使用说明 |
| `22159d0c4d4a5fe9d2c1ee8f1591b8099e9f25da` | pack allowlist 夹具避免重复已必需的 YAML 条目 |
| `45dfd795a14fb9d9a35bbdb9037d7ba159bf970e` | 技能名称类型、原生技能即时撤权、模型快照绑定、失败加载状态 |
| `d8c719fb6a11158d4b477c00d10c08fb1b6365c3` | 保存前拒绝畸形项目范围及容量超限；最终功能源码身份 |
| `6a37c1cf3abc2a08fcf654e07b25524abac3ee72` | 记录当时 C/P 已通过、Ego 空间丢失导致 B BLOCKED 的历史文档快照 |
| `04352907e5a865e471826bc383e14c802fefc57e` | 增加真实 Host 技能首次使用的拒绝/允许回归；运行代码与 `d8c719f` 相同 |

Node **24.19.0**，精确 Pi **1.3.0**，macOS Apple Silicon。manifest/lock 未升级 Pi；YAML 2.9.0 从既有 Pi 锁定依赖显式声明为本产品运行依赖，pack allowlist 和第三方许可相应更新。2026-10-22 核对 [npm latest](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest)及[官方稳定 Release v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0)（2026-10-21T22:49:48Z），当前保留一个 minor 的差距，不在 #80 升级。

私有证据根为工作区 `artifacts/client-02a-20261022-odor6m6p`，不进入源码提交。`source80-boundary-manifest.json` 绑定最终功能提交的 1706 个跟踪文件字节、执行位和符号链接；`source80-final-manifest.json` 保留 `45dfd79` 的相同粒度身份。Linux 前后均全量核对这些文件、Node 二进制摘要及 Pi manifest。逐段日志、Pi 接收内容、PTY transcript、命令/退出码和原始失败保留，不以最终证据文档提交充当功能重跑。

本次 Ego 使用 `d8c719f` 的两个全新隔离源码运行环境，各有 474 个复制的运行文件逐一与上述 manifest 核对字节、执行位及链接；另记录 17 项关键运行文件、配套 Node、精确 Pi 和已锁定扩展的实际来源。前端使用最后一次构建的相同 React 源码，记录 92 个构建产物摘要。身份见 `ego-source-provenance.json`，行为汇总见 `ego-acceptance-complete.json`；`verify-ego-acceptance.py` 的最终核对退出 0。完整交付回执为 `client-02a-complete-receipt.json`；原 `client-02a-receipt.json` 保持当时 PARTIAL 的历史结论。

实际可选资源为仓库已有 `context-doctor@0.1.0`，本轮声明有界 `label`，由真实 Pi 的 `context_snapshot` 及 TUI 状态消费；入口和 metrics 绑定字节摘要。技能样本为明确标识的本地受控 Markdown，由 Pi 公共加载器与原生 `/skill:` 路径加载和展开。它们不是真实外部 Provider 或任意扩展市场的证明。

## 六条 AC

| AC | 已核实证据 | 本票结论 |
| --- | --- | --- |
| 1 最小双端入口及完整加载链路 | 正式 `omp settings`、实际 GUI 编辑默认/覆盖/重置，重建 Host 后持久化回读；GUI 设置由 CLI 的真实 `context_snapshot` 返回 `GUI-A`，CLI 设置由 GUI 的下一真实 Pi 返回 `CLI-A`。技能通过原生 `/skill:` 加载展开 | **PASS**；C/P 14 项及 B1/B2/B4 |
| 2 单一权威、覆盖与显式导入 | 工具/技能共用 config-runtime 权威；MCP/模型保留原存储并组合任务版本。A/B 隔离、显式来源/差异、摘要 CAS、导入停用及原件不变通过。GUI 导入与启用均不发送模型请求；首次使用另行确认，实际模型调用固定准入快照 | **PASS**；C/P 及 B1/B3/B4 |
| 3 真进程 CAS、拒绝与最后有效值 | 两个真实 CLI 同 revision 仅一个成功；非法参数、无 Schema、未知来源、不兼容、必需集合关闭、畸形 scope 及容量超限均拒绝。GUI 冲突保留草稿，显式采用新版本再保存；同版本资源摘要失败保留最后加载值、待生效状态与输入，请求数不增加 | **PASS**；C/P 及 B3/B5 |
| 4 冻结、旧队列和立即阻断 | 活动 Pi 保留 `queue-old`；设置改为 `queue-new` 后旧队列暂停。核对并保存后仍不发送，单独明确投递才执行。停用后再启用不复活旧工具或原生技能快照；新任务恢复。既有 agent_settled、凭据撤权、unknown 不重放、取消/退出回归通过 | **PASS**；C/P、账号/MCP 3+6 项及 B6/B7/B8 |
| 5 实际 CLI/GUI 相互修改、回读及运行 | Ego TaskSpace 4 实际操作产品 GUI，与独立正式 CLI 双向修改、回读、运行；独立本地模型接收端共 22 次请求，实际工具结果及原生技能内容对应任务快照。四张关键截图由主代理查看 | **PASS**；B1–B8。完整资源目录/通用旅程仍由 #50–#52/#56 复用，不提前汇总 GCLIENT-02 |
| 6 必需 C/P/B、身份与分轴评审 | 精确源码/运行组合、输入/受控服务、命令/退出码、原始失败、Standards 与 Spec 分开记录；最终 C/P 14 项、实际 B 八组通过，既有 Linux CLI 143 项及最终边界 4 项通过 | **PASS**；仅本票最低完整合同和已列平台/服务范围 |

## 验证与可复核回执

以下命令均通过配套 Node 24.19.0 执行；实际二进制绝对路径、SHA-256 和运行文件来源保存在私有回执。`--test-concurrency=1` 是这些实际进程旅程的执行组合，未提高产品或测试超时。

| 命令或用例 | 源码与结果 | 原始回执 |
| --- | --- | --- |
| `node --test --test-concurrency=1 tests/product-settings.test.mjs tests/product-settings-pi.test.mjs tests/model-call-runtime.test.mjs` | 测试提交 `0435290`、功能源码 `d8c719f`，**14 PASS，退出 0**。包括真实 CLI/CAS、Pi/PTY、原生技能撤权、LKG、FIFO、同 TUI 下一任务、实际分类接收，以及 Host 原生技能首次使用拒绝零请求/释放租约、明确允许后实际展开 | `candidate-settings-with-host-skill.log`、`host-skill-consent-first.log`，`pi-*.json`、`pty-*.json`、`skill-revocation-*.json`、`tui-refresh-*.json` |
| 实际 Ego Lite 操作与独立接收核对 | 功能源码 `d8c719f`，**B1–B8 PASS**；两个隔离运行环境 12+10=22 次模型请求；浏览器 finish、服务退出及 worker/lease 释放核对通过 | `ego-resume-01.log` 至 `ego-resume-21-finish.log`、`browser-cli-receipts.jsonl`、两份 `browser-*-behavior.json`、`ego-acceptance-complete.json` |
| `node --test --test-concurrency=1 tests/cli-account-pi.test.mjs tests/cli-account-oauth.test.mjs` | `45dfd79`，**3 PASS，退出 0**；实际账号、PKCE/OAuth、本地模型调用、缺失/失效凭据、取消/超时 | `accounts-serial-diagnosis.log`及对应 `CLIENT-01A` JSON |
| `node --test --test-concurrency=1 tests/cli-mcp-config.test.mjs tests/cli-mcp-pi.test.mjs tests/cli-mcp-queued.test.mjs` | `45dfd79`，**6 PASS，退出 0**；独立 CLI token/OAuth、真实 Pi codemode、逐调用审批、跨进程撤权、unknown 不重放及 agent_end 原生队列至 agent_settled | `mcp-serial-final.log`及对应 `CLIENT-01C` JSON |
| `node --test --test-name-pattern='received HTTP disconnect stays unknown' tests/host-mcp-http.test.mjs` | `45dfd79`，**1 PASS，退出 0**；本地复核远程 main 失败诊断中的实际用例，不能抹掉远程失败 | `baseline-D15-HTTP-focused-final.log` |
| 真实 Host readonly / controlled SIGKILL 恢复定向回归 | 较早本轮源码，**2 PASS**；保留原输入未知及无自动重放，不充当最终源码完整回归 | `crash-real-source.log` |
| Linux 既有 CLI 受影响 12 文件集合（launcher、TUI/RPC/session、ownership、真实 Pi CLI/terminal、settings） | `45dfd79`，Node 24.19.0 / Pi 1.3.0，**143 PASS，退出 0**。`d8c719f` 再跑改变的 `tests/product-settings.test.mjs`，**4 PASS，退出 0**；其余 139 项相关运行代码未变 | `run-linux80-final.py`、`linux80-final-*.log`；`run-linux80-boundary.py`、`linux80-boundary-*.log` |
| `npm run test:web` | `d8c719f`，**11 文件 / 40 PASS，退出 0**；这是 jsdom，不是 B | `candidate-web-tests-final.log` |
| `npm run typecheck`、`npm run lint` | `d8c719f`，**PASS / 退出 0**；lint 1706 文件、无发现 | `candidate-types-final.log`、`candidate-lint-final.log` |
| `node --test tests/docs-links.test.mjs tests/package-governance.test.mjs` | 本次 B 收口文档，**13 PASS，退出 0** | `closeout-docs.log`；此前 `candidate-docs-final.log` 保留 |
| `npm run lint`、`npm run pack:check`、`npm run secret:scan` | 本次收口源码及文档，**PASS / 退出 0**；1706 跟踪文件、1843 打包文件，无发现 | `closeout-lint.log`、`closeout-pack.log`、`closeout-secrets.log`；此前 `candidate-*-final.log` 保留 |
| `npm run build:web` | `45dfd79` 的最终 React 源码，**PASS / 退出 0**；该后端边界提交未改前端。保留既有大 chunk 提示 | `web-build-review-fixed-correct-command.log` |

账号/MCP 3+6 项在 `d8c719f` 的复用范围仅为既有账号/凭据/逐调用和生命周期路径；新功能提交只增加设置请求的错误 scope/容量拒绝，未更改这些运行路径。新增设置路径由最终功能源码及补充测试的 14 项覆盖；`candidate-settings-final.log` 的 13 PASS 是补充首次使用用例前的有效历史证据。React 单测、类型和构建复用未变的运行源码；收口只新增测试及文档，不重复整个后端或平台矩阵。早期 82 项合同、13 项 CLI/TUI、40 项 WebUI 及打包回执仍按原日志身份保留，不累计成最终源码 Full。

Linux 使用既有专项 Colima profile，缓存的 `node:24.19.0-bookworm` 镜像 `sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`；两个新的独立容器均 `--network none`，使用既有缓存执行 `npm ci --offline` 及 test:prepare。实际网络拒绝为 `ENETUNREACH`。测试前后源码一致，容器及 VM 已停止，Docker 默认 context 前后均为 `default`。最初误启动默认 Colima VM 后已恢复原停止状态；正式两轮只使用专项 profile。这不是新增 Linux 全能力、日常安装或发行验收。

## RED、复核与处置

- 公开 `omp settings list` 原先被当成 Agent 输入，报 `OMP_CONTROLLED_STACK_UNAVAILABLE`；保留 `red-cli.log` 后增加独立管理入口。
- 诊断工具最初被原权限扩展拒绝。适配仅准入已选择的无 I/O `context_snapshot`，上游显式 deny、账号及 MCP 审批保留。
- 输入桥的 resourceRevision 固定 0 导致显式改绑定后仍拒绝；改成任务固定版本。分类草稿旧测试也从公共设置接口取当前版本，保留实际绑定断言。
- 直接 `session.reload()` 导致第三方用量组件持有失效 UI ctx；改用 Pi 公开命令上下文 reload；原崩溃、修复后的同 TUI 实际加载回执均保留。
- 初轮 Linux **119 PASS / 18 FAIL / 5 CANCELLED**：通用 SDK/子运行夹具不装配 OMP 诊断工具、精确工具清单陈旧。修复装配适用范围和实际清单后取得上述 Linux 证据；没有扩大超时或删掉字段断言。
- 首次账号/MCP 并行旅程出现账号 60 秒取消与 OAuth TUI 就绪超时；完整保留 `accounts-pi-oauth-final.log`、`account-mcp-final-regression.log`。后一失败残留的测试 PTY 经识别进程组后终止，不记为正常产品退出。串行、原时限重跑取得 3+6 PASS；并发时序敏感性仍是该早期执行组合的限制。
- 第一轮独立 Standards：YAML 名称数组被 regex 隐式转字符串；第一轮 Spec：活动原生技能绕过撤权、CLI 模型快照未绑定、同版本加载失败仍显示已加载。`review-red.log` **4 FAIL / 7 PASS** → `review-green.log` **11 PASS**；没有弱化断言。
- 后续 Standards：畸形 scope 落入全局、项目容量发布后才失败。`admission-red.log` **2 FAIL** → `admission-green.log` **5 PASS**，当时最终功能源码全组 **13 PASS**，本次补充首次使用用例后 **14 PASS**。同时在发布前检查 1 MiB 及整数上溢，导入复制移到容量检查之后。

**Standards：已报告问题全部修复；独立关闭复核 PASS。** 最后复核针对 `45dfd79..d8c719f` 及邻近代码，无剩余可执行问题；未声称再次全仓审计。

**Spec：限定源码复核 PASS；本票六条 AC 的主代理实际验收 PASS。** 独立源码复核确认三项原缺口均关闭。本次独立证据复核确认双向实际加载、冲突/重置、技能确认/展开、失败 LKG、队列和撤权等所读证据 PASS；由于其限定材料未包含全部 CLI 回读、Host 重建及 OS 进程退出检查，全项独立证据审查为 **PARTIAL（审查范围）**，没有据此声称独立全量 B PASS。主代理亲自操作并核对上述完整原始材料、文件身份和进程退出，得到这里的最终 C/P/B 结论。#81 的新分类/生图绑定、#82/#83 的发现/交接未并入本轮。

## 实际 Ego Lite B

用户明确回复“允许，重建并继续 Ego Lite 验收”后，新建 TaskSpace `4`，名称 `Only my pi Issue80 20261022 resumed`，在同一空间的 `p1` 中完成产品交互。两套环境均使用真实配套 Pi、产品账号和正式 CLI，仅将模型路由指向各自回环受控接收端。所有 22 次请求实际 `model=shared`；GUI 明确选择了该测试模型。没有外部 Provider 调用。首套环境在过程中实际停止并重新创建 Host/控制器/目录，从磁盘读取配置，未以同一内存对象回读代替持久化。

| 场景 | 实际操作和独立结果 | 回执 |
| --- | --- | --- |
| B1 默认、A/B、覆盖与重置 | GUI 默认 `GUI-default`、A 覆盖 `GUI-A`；独立 CLI 同版本读 A/B，A 归项目、B 继承默认；GUI 重置后 A 恢复默认 | `ego-resume-02.log`、`ego-resume-07.log`、`browser-cli-receipts.jsonl` |
| B2 双向真实加载 | GUI→正式 CLI 的工具结果 `GUI-A:`；CLI→GUI 下一 Pi 为 `CLI-A:`；页面同时显示请求新版本和此前实际加载值。最终修复/启用后的 GUI 任务加载版本 10 | `ego-resume-05.log`、`ego-resume-06.log`、`browser-resume-behavior.json`、`ego-gui-loaded-cli-settings.png` |
| B3 冲突及声明约束 | GUI 旧草稿与 CLI 新写入冲突，草稿保留；明确采用版本 4 后保存为 5；非法参数禁用保存，必需集合不可停用 | `ego-resume-03.log`、`ego-resume-06.log`、`ego-resume-07.log`、`ego-conflict-preserved-draft.png` |
| B4 技能来源、持久化与使用 | GUI 展示来源/摘要/差异、导入停用；重建 Host 后回读版本 7。启用不发请求，原生首次使用另点 Allow once 后真实 Pi 展开 `BROWSER_SKILL_MARKER`；下一任务停用技能后实际列表为空 | `ego-resume-08.log` 至 `ego-resume-11.log`、`ego-resume-20.log`、两份行为 JSON；源文件摘要始终为 `0790deca…0024f04` |
| B5 失败保留与恢复 | 仅改受控的技能副本，同版本 8 显示 `RESOURCE_IDENTITY_CHANGED`、保留最后有效版本/输入、pending=true，模型请求保持 6；恢复副本后明确启动成功。停用工具后的下一 Pi 声明中无 `context_snapshot` | `browser-load-admission-clarified.json`、`ego-resume-12.log`、`ego-resume-13.log`、`ego-load-failure-lkg.png` |
| B6 活动冻结与旧队列 | 控制接收端挂起活动请求，GUI 改参；活动结果仍 `queue-old:`。旧队列明确投递被拒，核对/保存后仍暂停且请求数仍 2；另点明确投递才出现 `queue-new:` | `ego-resume-15.log` 至 `ego-resume-18.log`、`browser-queue-before-explicit-resume.json`、`ego-queue-explicit-resubmit.png` |
| B7 即时阻断与新任务 | 活动请求期间 GUI 停用再启用；旧任务工具结果 `RESOURCE_DISABLED_OR_REVOKED`，未执行资源；新任务真实返回 `queue-new:` | `ego-resume-19.log`、`ego-resume-20.log`、`browser-queue-behavior.json` |
| B8 结束与释放 | 持久任务均进入终态，无残留 worker，队列环境 workers/leases=0；受控父进程 95973/99921 退出 0 且 OS 核对不存在。TaskSpace 4 finish 一次成功，关闭 p1、保留无关页面数 0 | `ego-resume-21-finish.log`、两份行为 JSON、`ego-acceptance-complete.json` |

B5 是**创建新任务之前的准入拒绝**，没有新建失败任务。原 `browser-load-failure-observation.json` 的 `failedTask` 字段误名，实际指此前已成功任务；原件保留，另以 `browser-load-admission-clarified.json` 记录正确含义。保留最后有效回执不意味着在失败时自动回退执行。B7 的模型可以处理工具错误并正常结束任务，任务 succeeded 也不表示被撤权工具成功。

四张上述截图均由主代理查看。实际产品操作、独立 CLI 子进程、模型接收体和工具结果共同支持 B；Host API、DOM 或截图本身没有被单独当作完整链路。所有命令的参数、进程 ID、stdout/stderr 和退出码在 JSONL/逐段日志中；预期拒绝和成功分别保留。

### 历史阻碍与浏览器脚本失败

本票原 TaskSpace `3` 丢失，曾返回 `task space not found: 3` 且空间列表为空；`ego-final-01.log`、`ego-missing-space-inventory.json` 及提交 `6a37c1c` 保留当时 **PARTIAL / B BLOCKED**。依据 ego-browser 的空间恢复规则请求许可，用户随后明确允许新建，才完成上述验收。没有静默换浏览器。

本次三项脚本失败仍保留：`ego-resume-03.log` 误以为新增模型会自动选中，未发请求，随后在 GUI 明确选择；`ego-resume-09.log` 错等 dialog 而首次使用审批实际为内联卡片，未确认导致原有 `RPC_COMMAND_TIMEOUT` 且零新请求，随后读取实际控件并明确 Allow once；`ego-resume-14.log` 在最后操作已成功后引用过期快照 ref，成功结果由接收端和加载回执独立核对。没有增加超时、修改运行代码或盲目重投来得到 B PASS。这些失败不是成功脚本，也不改写为 PASS。

## CI、同步与范围（2026-10-22 本地验收冻结快照）

开工 main run [39733201211](https://github.com/Ricardo121380/only-my-pi/actions/runs/39733201211) 后续结束为 **FAILURE**：Node 24.19.0 在 M8 D15 超时（1802030 ms），诊断包含 HTTP disconnect unknown 不重放；M11 Q10 skipped。原始失败日志保留为 `baseline-main-ci-failure.log`。它是 `e714c89` 的远程结果，既不是本票候选检查，也不因本地定向 PASS 改判。

本地验证按配置/权限/生命周期/打包风险选择合同、实际进程及 Linux 回归，不额外触发远程 CI。候选 CI **NOT_RUN**：尚无推送、PR、合并或工单关闭授权。main 保护已刷新，strict=true，必需检查为 **Node 24.19.0**、**M11 Q10 macOS arm64 clean-home**；未来进入受保护合并必须完成实际必需检查，不放宽门禁。

安装、日常切换、桌面、真实外部 Provider、付费调用和产品发行均 **NOT_RUN**。只有本轮代码、必要文档和测试增量进入本地提交；没有远程写入。本票无剩余本地 AC 缺口；待授权的远程同步、PR、必需检查、合并与工单关闭分别执行并回读后，才能公开收口。后续能力切片为 #81，开工前刷新真实前置；#50–#52/#56 的完整资源页面、#82/#83 仍各自验收，不因本票 PASS 汇总整个 GCLIENT-02。

## 2026-10-23 公开工程收口增量

首次推送的远端分支独立回读为 `fb8fefda92ecb9a29515050421901e0aad330a41`。PR #90 的检查实际 checkout 为 `077670e1b29f191c0f06ae6931a074ca86bcbed7`，树 `0dcbac6b2475b7a33f4e8f9bf2a9652df6dd3e31` 与该 tip 一致。七个原提交的全部历史新增内容、42 条路径及 63 个历史文件版本已作公开范围复核，没有夹带私有恢复分支、原始证据、凭据或个人绝对路径。既有功能 manifest、20 份证据摘要、两套 474 文件运行来源及 92 个前端产物的限定核验匹配；这不是重新执行全部 B。

本轮 [CI 39803988904](https://github.com/Ricardo121380/only-my-pi/actions/runs/39803988904) 的首次 **FAILURE** 与历史 main D15 超时分别保留：本次第一个 release-gates-v1 的 `full-tests` 在 1731250 ms 后退出 1，**不是门禁超时**；后续 M8/M11 及 Q10 未放行。有界诊断只保留部分用例名、断言类型和 frame，不声称它枚举了全部失败。类型、lint、单元/合同/集成、e2e、pack 和 secret scan 等先行检查通过，不能抵消 full-tests 失败。

先在 `fb8fefd` 最小复现三个用例，**0 PASS / 3 FAIL，退出 1**：direct print 的 `RESOURCE_LOAD_FAILED`、Host 首个请求轮询失败，以及 Pi 1.3 工具清单少了默认启用的 `context_snapshot`。两个正向夹具加载了 `omp-direct`，却未装配诊断扩展。另定位到 Full-stack RPC/TUI 的显式工具选择缺项，分别保留原 15 秒取消 RED 和 TUI `RESOURCE_LOAD_FAILED` RED。TUI 红探针在未出现就绪时被主动终止，不记为干净退出；其进程随后已核对不存在。修正只涉及五个测试／夹具，未改变产品代码、时限、请求计数、所有权、撤权或失败断言，也未将精确清单改成包含检查。

| 本次定向检查（Node 24.19.0 / Pi 1.3.0） | 结果及源码边界 | 私有日志定位 |
| --- | --- | --- |
| HTTP MCP 与 descriptor-write 两文件，CI 并发 2 加 coverage | `fb8fefd`，**41 PASS / 0 FAIL / 0 CANCELLED，退出 0**，402403 ms；不能替代整个 D15，也不能抹掉历史 main 超时 | `80-d15-probe.log` |
| `pi130-runtime`、`direct-session-admission`、`host-pi110-runtime` 三完整文件 | 五文件修正中的前三项，**42 PASS / 0 FAIL / 0 CANCELLED，退出 0**；其后只补另外两个夹具的工具选择，相关源码未变 | `80-ci-regression-red.log`、`80-ci-regression-green.log` |
| Full-stack `direct-rpc-runtime` 完整文件 | 最终测试源码 `e142b8b`，**7 PASS，退出 0**；原 15 秒时限不变 | `80-full-stack-rpc-red.log`、`80-full-stack-rpc-green.log` |
| 默认 RPC 与 Host 受控／账号 RPC 三文件 | `e142b8b`，**12 PASS / 0 FAIL / 2 原有 installed SKIP，退出 0**；没有把无设置快照的隔离 worker 改成完整产品路径 | `80-companion-rpc-regression.log` |
| 真实 Full-stack TUI 启动与 `/quit` | `e142b8b` 的最终夹具，**PASS，退出 0 / signal 0**，通过标记存在、无加载失败、无残留进程；源码运行探针，不是安装晋升或发行 | `80-full-stack-tui-red.log`、`80-full-stack-tui-green.json` |
| Linux 两个受影响 CLI 文件 | `e142b8b`，**32 PASS / 0 FAIL / 0 CANCELLED，退出 0**；1706 个源码文件在前后匹配字节／执行位／链接，Node 24.19.0 / Pi 1.3.0，`--network none` 并实际 `ENETUNREACH` | `80-ci-linux-regression.log`、`80-ci-linux-source-before.log`、`80-ci-linux-source-after.log` |

Linux 使用既有专项 Colima profile 与缓存的 `node:24.19.0-bookworm` 镜像，镜像身份仍为 `sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`。依赖和 test:prepare 均离线完成；容器和本轮启动的专项 VM 已停止，Docker 默认 context 前后均为 `default`。没有改动全局工具配置或切换日常安装。

本次五文件测试修正及四份文档增量分别取得独立 **Standards PASS** 和 **Spec PASS**，无待修问题；范围限于该增量，不将其表述为重审原七个提交或重跑原始 B。主代理另核对受影响私有日志与结果。文档链接／包治理检查、lint、secret scan 及 `git diff --check` 通过。

以上均为分范围验证，不拼为同一源码 Full。最终功能仍为 `d8c719f`，原补充测试身份 `0435290` 与文档 tip `fb8fefd` 保留；新测试提交为 `e142b8b`。#80 原六条本地 AC 的未变运行源码证据按范围复用。原独立 Standards／Spec 复核范围和主代理实际 B 验收的区别保持。受保护合并仍须当前候选实际取得 **Node 24.19.0**、**M11 Q10 macOS arm64 clean-home** 成功并再次核对 strict 规则；本记录不提前关闭工单或启动 #81 实施。
