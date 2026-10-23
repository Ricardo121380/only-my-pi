# CLIENT-02A / #80：共享产品设置验收记录

**2026-10-23 公开工程收口进行中：** [PR #90](https://github.com/Ricardo121380/only-my-pi/pull/90) 的两次必需 CI 失败均保留。首次旧夹具装配和精确工具清单修正为仅测试提交 `e142b8b`；第二次 Host 撤权用例 20 秒超时的根因仍 **UNKNOWN**。随后独立复现 Host→Pi 关闭准备 IPC 与 stdin EOF 的排序竞态，最小运行修复为 `289fbac5414c69be7bb813d2ed486c16b5460417`，没有增加原 500ms 准备预算或替代最终 clean/进程组退出证明。原功能源码 `d8c719f`、原补充测试 `0435290`、原文档 tip `fb8fefd` 的身份保留；新候选的实际 B、CI 和合并结果单列于文末，不回填为原候选 Full。#80 仍 OPEN、未合并，保护条件未放宽。下方带日期的本地验收及授权状态保留为当时快照。

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

以上为第一轮测试修正的分范围验证，不拼为同一源码 Full。原功能 `d8c719f`、原补充测试 `0435290` 与文档 tip `fb8fefd` 保留原身份，新测试提交为 `e142b8b`。后续运行修复及其证据如下；原独立 Standards／Spec 复核范围和主代理实际 B 验收的区别保持。

### 第二次 CI RED、诊断边界与关闭顺序修复

[CI 39814144459](https://github.com/Ricardo121380/only-my-pi/actions/runs/39814144459) 在文档 tip `3b4f2eaec1d7ad19db051cfe3b5edddf064917d2` 的合并检查源码 `301acfde8cb65d82ebd4c7615d33cfb3a47913d4` 上 **FAILURE**；两者树均为 `0e9a880e64f4fbbdd38e7813d4c3d9d7044f7f57`。`full-tests` 在 1390628ms 退出 1，有界诊断包含 `public Host coding revoke is scoped to one project and worker lifetime`、`20000ms`，Q10 skipped。CI 未保留子进程原始输出，不推断它枚举全部失败。[并行的额外检查 39814144460](https://github.com/Ricardo121380/only-my-pi/actions/runs/39814144460) 八个任务成功，包含平台构建和隔离 Homebrew／CLI 检查；这不替代必需检查，也未发行或切换日常安装。

在未改动的 `3b4f2ea` 上，以相同 Node 24.19.0、npm 11.17.0、默认 discovery 及并发 2 的 `npm test` 保留本地 RED：**1794 tests、1785 PASS、0 FAIL、1 CANCELLED、8 SKIP，退出 1**，1255830ms。取消为同一用例自己的 20 秒超时，运行器总超时和输出上限均未触发。当前 full-tests 没有 coverage；此前 HTTP 定向 coverage 探针不代表这里的执行组合。原 main D15 超时、第一次夹具失败及本次 20 秒取消分别保留。

阶段观测和外部被动观测各取得 **1786 PASS / 8 SKIP**，但都带明确诊断 overlay／`--import`，是基线诊断，不能作为未修改官方门禁或修复后 Full。20 次有界定向采样没有再现 RED，结论为 **NO_RED_WITHIN_BOUND_INCONCLUSIVE**。被动观测首次脚本语法错误发生在测试执行前，未计为产品失败或成功。以上原件保留，原 20 秒超时根因仍 UNKNOWN；不以这些通过结果声称已修复。

独立的可重复 RED 通过已复制的真实 Pi 1.3.0 SDK，将实际 `prepare_shutdown` IPC message 的交付延后 50ms。没有伪造准备 ACK、最终 clean 回执或模型结果：旧源码确实出现 `prepare_queued → stdin_eof`，公开终态 `failed / RPC_TERMINATION_UNCONFIRMED`，独立模型接收数 1，**0 PASS / 1 FAIL**。这是两条进程通道的关闭排序缺陷；它与前述 20 秒取消的关系为 **NOT_PROVEN**。

`289fbac` 只修改父端关闭等待、子端准备 ACK 和两份相关测试。子端同步撤权之后发送同 nonce 的 `shutdown_prepared`；父端在原有 500ms 内等实际准备 ACK，再关闭 stdin。准备 ACK 不等于最终 clean；执行探针、MCP 终止、进程身份／进程组退出和 ownership 保留条件继续生效。丢失、错误 nonce 或超过准备预算仍进入既有有界清理，不能凭准备 ACK 释放所有权。

| `289fbac` 受影响检查，Node 24.19.0 / Pi 1.3.0 | 结果 | 私有回执定位 |
| --- | --- | --- |
| 独立排序竞态及 Host extension／worker／Pi runtime 四文件 | **28 PASS，退出 0**；真实顺序为 `prepare_queued → prepare_delivered → stdin_eof`，公开 succeeded、恰好 1 请求，worker、session/project lease、账号保留均为 0；原 20 秒撤权、慢初始化和丢失最终 clean 负例保留 | `80-controlled-shutdown-order-red.log`、`80-controlled-shutdown-order-red-receipt.json`、`80-controlled-shutdown-order-green.log` |
| 受影响的实际 MCP 写入、撤权、取消和丢失 stop 回执 | **6 PASS，退出 0**；未改变未知、单写和 ownership 保留断言 | `80-shutdown-fix-mcp-controlled.log` |
| 账号 controlled RPC | **4 PASS / 2 原有 installed SKIP，退出 0** | `80-shutdown-fix-account-controlled.log` |
| 类型、lint、secret scan、diff | **PASS，退出 0**；文档链接／包治理 13 PASS、pack 检查通过 | `80-shutdown-fix-checks.json`、`80-shutdown-closeout-checks.json` |
| Linux 两个既有 CLI 文件及 controlled extension 单测 | **36 PASS / 0 FAIL / 0 CANCELLED / 0 SKIP，退出 0**；1707 个跟踪文件在容器测试前后匹配，`--network none` 实际拒绝，Node／Pi 精确身份一致 | `80-shutdown-linux-regression.log`、`80-shutdown-linux-source-before.log`、`80-shutdown-linux-source-after.log` |
| 实际 Ego Lite GUI → 真实 Pi、本地接收与停机后正式 CLI 回读 | **补充 B PASS**；GUI 保存 `shutdown-289`，真实工具返回同标签，界面回读实际加载版本 1；正常任务 succeeded，另一已接收请求由 GUI 取消后 durable cancelled；四类保留均为 0，晚到释放后仍恰好 3 次独立接收；Host 停止后正式 CLI 读回同设置 | `80-ego-shutdown-receipt.json`、`browser-shutdown-v3-behavior.json`、`80-ego-cli-after-host-stop.json`、两张 `80-ego-*-289.png` |

Linux 继续复用上述专项 profile、镜像和离线缓存，新容器及本轮启动的 VM 均已停止，默认 Docker context 不变。运行修复的四文件取得独立 **Standards scoped PASS** 与 **Spec scoped PASS**，未发现新增源码问题。审查覆盖关闭协议、同 nonce、同步撤权、最终 clean／进程组及保留条件，不覆盖整个 #80 或当前候选 B／CI。准备 ACK 丢失、超时和错 nonce 尚未逐例故障注入；源码路径已审查，既有丢失最终 clean 的负例继续通过。

补充 B 使用本次同一 Ego TaskSpace `5`，保留给后续 #81，尚未 finish。最终环境的 474 份运行文件在运行前、停机后核对字节和执行位，使用真实锁定扩展和精确 Pi 1.3.0；复用未变 WebUI 源码的 92 份既有构建产物。两张截图由主代理查看。此前另一独立环境的两个正常任务／4 次接收另存；其私有服务把结构化输入转为对象字符串，未实现预期挂起，**不计作取消验收**。首套零任务环境的一次性配对和 stdin 控制问题、各次定位器／等待脚本失败都保留，未计作产品成功；同一 Ego 空间继续使用，未另换浏览器。最终正常与取消任务、独立接收、持久终态、停机后正式 CLI 以及退出共同支持上述补充 B，不以 DOM／API 单独替代。

原始绿色日志本身未内嵌提交号。`80-shutdown-fix-receipt.json` 明确区分主代理对“先测试精确补丁、后提交且期间代码未改”的绑定记录与独立重跑；四份 Git blob、日志摘要及 Linux 在执行前冻结的 manifest 一并保留。新源码完整门禁、受保护合并和工单关闭仍须分别取得当前候选证据，不能拼接为 Full；#81 实施继续等待 #80 完成。

### 第三次 CI RED 与原始 D15 复核

[必需 CI 39839344877](https://github.com/Ricardo121380/only-my-pi/actions/runs/39839344877) 检查文档 tip `9c0b33bfdb63a3678d66a0a054b68586583bd39a` 的合并源码 `4ba54d69b4a2bd112c0e5a3f4e1c25dc37e73e38`，树均为 `06ae7df81939e4a27d1edbebc02d57468ce10440`。两轮 `full-tests` 分别 **PASS / 1480730ms**、**PASS / 1571502ms**；M8 D1–D12 PASS，D13/D14 NOT_RUN_BY_POLICY，D15 **FAIL / 1802031ms**，`exitCode=null signal=SIGTERM timedOut=true outputLimitExceeded=false`，Q10 skipped。首个有界失败名是 stdio 只读审批用例，后续多个文件在总门禁终止后取消；没有内部阶段证据，不能据此认定 stdio 是整个 D15 的停滞位置，或将前述排序修复表述为这次超时的修复。

在干净的同一 `9c0b33b` 上，以原 `runCheck(D15)`、Node 24.19.0、原命令／环境／并发／覆盖率及 1800000ms 上限运行一次，私下保留原始输出，**PASS / 1773694ms / exit 0**。global coverage 为 **1796 tests / 1788 PASS / 0 FAIL / 0 CANCELLED / 8 SKIP**，1698448ms；两个专项 coverage 及其余五项检查均通过。测试前后 HEAD 和工作树一致。这是一次原始本地 D15，不是全 M8、远端 CI 或 Q10；距上限仅剩 26306ms，不能抵消远端 RED。stdio 只读用例在其中 PASS / 18210ms，不能证明 CI 同阶段的行为。

私有回执为 `80-local-d15-result.json`、`80-local-d15-stdout.log`、`80-local-d15-stderr.log`。外部只读观察器未改变测试，但其两个版本分别因错误的持久文件路径、进程命令行解析失败而未取得目标阶段记录；失败脚本及说明保留，**不作为阶段或验收证据**。现有日志没有独立计量夹具复制／哈希耗时，不把重复复制操作推断为已证根因。

该失败暴露了确定的诊断缺口：M8 已输出固定 START/PASS 标记，但有界错误投影全部忽略；stdio 用例也没有内部阶段标记。后续诊断增量仅增加固定白名单阶段和数字耗时，保留既有 1200 字上限及不写入正式 report 的边界，不输出请求、响应、凭据或路径。真实小子进程被总门禁终止的测试先得到 **RED / tests=UNPARSEABLE**，再得到阶段保留及非法文本过滤的 GREEN；与实际 stdio、门禁及报告测试合计 **29 PASS**。所有产品代码、原测试 timeout、并发、覆盖率阈值、请求数和断言保持不变。此增量补足定位信息，**不是已证明的超时修复**；远端新候选仍须完成必需检查。

该五文件增量的独立 Standards scoped PASS；Spec 首轮指出 `approval-visible` 可能在实际没有审批时提前输出，已将标记移至原审批断言之后。修正后实际 stdio 与诊断测试 **9 PASS / exit 0**，独立复核确认该 finding 关闭、scoped PASS；该次关闭复核直接核对当前代码和日志，没有重新建立完整五文件 diff。完整增量沿用前轮独立审查范围，由主代理复核最终 diff；不将诊断审查扩称为产品或全部 CI 验收。

[额外平台检查 39839344855](https://github.com/Ricardo121380/only-my-pi/actions/runs/39839344855) 为 **7 SUCCESS / 1 FAILURE**。macOS 隔离安装任务先通过本候选安装、离线身份／版本、原始 Pi、fresh npx 与卸载，随后安装既有公开 `only-my-pi@0.4.0-preview.1` 时在原 120000ms 子进程边界失败，`code=1 killed=true signal=null`，stdout/stderr 为空。底层原因 UNKNOWN；升级、重装、迁移及后续 Full/Thin 检查未完成。脚本和 workflow 未被 #80 改动，此旧包装组合的 Pi 0.84.3 也不是开发 Pi 1.3.0 证据。保留失败日志及七份部分产物，不将该任务记为 PASS，不改变安装时限或重跑相同候选；本地未执行安装切换或发行。

### 第四次 CI RED 与 write 夹具准备成本

诊断源码 `cc332a9dedd1dc93ea855863b93f1f70876a45f0` 的 [必需 CI 39859262706](https://github.com/Ricardo121380/only-my-pi/actions/runs/39859262706) 为 **FAILURE**。合并检查源码 `b567d3af5dc4cb3c0d810d750884136013d7ead4` 与分支树均为 `99fd45d6eeafcec10d8b1419da407052b2096b42`。release、Subagents 两组 full-tests 分别 **PASS / 1432534ms**、**PASS / 1401363ms**；D15 再次在 **1802031ms** 被原总门禁 SIGTERM，Q10 skipped。新诊断明确 stdio 断言于 26431ms 完成，cleanup 于 26674ms 完成；M8 停在 global-coverage。首个文件标签为 `host-mcp-write.test.mjs`，没有该文件的子用例超时或 cleanup 标记，不能区分执行较慢、after／文件退出未完成或总门禁取消顺序；根因仍 **UNKNOWN**。私有原始日志、摘要和精确源码绑定保留在 `80-pr90-ci-fourth-red-receipt.json`，不与历史 RED 或本地 PASS 相互覆盖。[该源码的附加平台 CI 39859262564](https://github.com/Ricardo121380/only-my-pi/actions/runs/39859262564) **8/8 SUCCESS**；此前旧版安装失败仍按历史保留，不改判其根因。

原始本地 D15 的 write 文件 24 个用例打印耗时合计 451619ms；这不是全套 wall time 或 CI 归因。一次本地配对诊断使用新建、删除后重建同路径、另一个全新路径的真实 Pi stdio 旅程，初始化区间分别约 5849ms、1552ms、5526ms。它只支持调查安装路径的重复准备成本，没有独立测量编译阶段，也不支持将差值乘以夹具数量作为可回收 CI 时间。原件为 `80-stdio-setup-cost-receipt.json`，不是正式 D15 或功能验收。

本次测试增量仅在 write 文件的 20 个正常 Host 场景复用已有 `createSourceFixtureRoot`：必须等正常 stop 确认后完整删除上一个根目录，才重建同一路径。所有源码、配置、账号、项目、会话和 ownership 重新创建，已占用或失败保留目录不复用；两次独立 TUI、故意制造孤儿进程的场景及丢失 stop 回执 guard 继续使用独立路径。未改变 24 个用例、原时限、并发、覆盖率阈值、接收数、UNKNOWN 或清理断言，没有产品运行代码变化。

该文件在 Node 24.19.0 / Pi 1.3.0 / macOS arm64 下带 coverage 定向 **24 PASS / 0 FAIL / 0 CANCELLED，退出 0**；使用 `packages/**` include，不能冒称完整 global coverage。独立 **Standards scoped PASS**、**Spec scoped PASS**；它们核验上述唯一源码增量，不证明 CI 根因或 D15 完成。私有结果为 `80-write-path-reuse-receipt.json`。冻结候选的原始 D15 及必需 CI 仍须完成；#80 保持 OPEN，#81 尚未实施。

### 第五次结果与分类等待的失败即停修正

测试准备源码 `f4a288fcd4546f6b20d27db4f762a44904ad1043` 的 [必需 CI 39871557035](https://github.com/Ricardo121380/only-my-pi/actions/runs/39871557035) 为 **FAILURE**：第一组 full-tests **PASS / 1240126ms**，Subagents 组 full-tests **FAIL / 1306489ms / exit 1**，诊断为正式 CLI／原生 Pi OAuth 用例 `EINVAL`，非总超时或输出超限；后续 D15 未执行，Q10 skipped。该错误原因尚未确定，不能与历史 D15 超时或本地分类失败合并归因。[附加平台 39871556872](https://github.com/Ricardo121380/only-my-pi/actions/runs/39871556872) **8/8 SUCCESS**，不替代必需检查。

同一干净源码的原始本地 D15 在 **1654717ms / exit 1** 结束，`timedOut=false outputLimitExceeded=false`。唯一失败为分类超时负例的 `Timed out: provider received`，不是 D15 总时限。原始日志与 `80-write-reuse-d15-result.json` 保留；测试完成后源码仍干净。一轮单项 coverage 诊断未复现：接收 1 次、请求为 unknown、原占额与未知费用保留。该通过不能覆盖原 RED 或证明根因已修复，未继续重复采样。

已确认的测试缺口是只轮询接收数，不检查任务终态：真实 Pi 已拒绝错误模型、零请求账本的情况下仍等满接收窗口，最后只报笼统超时。先以已有真实 Pi wrong-model 场景复现 **1 FAIL / exit 1**，再在同一等待入口加入终态检查；未接收且任务已结束时立即抛 `CLASSIFIER_ENDED_BEFORE_RECEIVE`，保留任务／请求状态和安全错误码，不附带响应体、凭据或路径。两次只读查询后再次核对接收数，避免查询期间已接收却误报。

受影响的 wrong-model、429、timeout、output-limit、cancel 五项带 coverage **5 PASS / 0 FAIL / 0 CANCELLED / exit 0**。分类调用的原 1000ms 预算、用例时限、全部独立接收数及不退款／未知断言保持；未增加用例或修改产品运行代码。主代理分别完成 **Standards scoped PASS** 与 **Spec scoped PASS**，这是本次测试增量的静态复核，不冒称独立子代理或全量评审。私有 RED／最终定向日志分别为 `80-classifier-fail-fast-red.log`、`80-classifier-fail-fast-final-green.log`。本增量只修正失败等待和诊断；偶发未接收及远端 OAuth `EINVAL` 仍为 **UNKNOWN**。本轮未再执行 Full、推送或触发 CI；#80 未合并／关闭，#81 尚未实施。

### 继续收口：异常清理与确定性的分类故障边界

`6740ab3` 之后的本次增量限于测试、验证脚本和记录；`bin/`、`packages/`、`extensions/`、`bundles/`、`webui/` 相对运行修复 `289fbac` 无差异。原功能、实际 C/P/B 和 Linux 回归继续按上述源码范围复用，不重标为本次重跑。

OAuth 夹具存在独立可复现缺陷：真实子进程启动错误使 `child.closed` rejected，原清理再次等待该拒绝并跳过服务关闭／目录清理。真实缺失 cwd 的 RED 被外层原 10 秒截止终止；修正后实际观察物理 close 再传播原启动错误，对所有子进程完成清理，服务／证据／目录各步骤均尝试执行。仍有未关闭子进程时保留目录，清理错误不吞掉。登录提示等待同时检查启动错误和提前退出，避免再等满提示窗口。account add、login 启动失败及原完整正式 CLI／原生 Pi OAuth 旅程 **3 PASS / exit 0**；保留原 90 秒正常旅程、PKCE、双账号、环境凭据不兜底及撤权／超时／取消断言。这证明夹具异常路径修复，**不证明原 CI 的 EINVAL 根因**。新增回归最初继承 Node test-child 环境而得到 V8 协议输出，原日志保留；嵌套独立 runner 明确移除该内部上下文后验证。

分类原负例隐含发送前工作须在 1000ms 内完成。对真实 Pi 分类入口施加同一 1200ms 准备延迟后，旧墙钟用例稳定 RED：接收 0、请求 `not_sent`、预占 1，未进入它要验证的已发超时。该确定性 RED 不改判历史 f4a 失败根因。现在分别覆盖：新增**真实墙钟**发送前截止，接收 0、保留请求和占额，重启不重放；原 429／timeout／output-limit／cancel 四个已发负例明确标注**受控模型时钟**。只在隔离的复制 worker 内控制匹配 1000ms 的两个模型 deadline，仍调用真实 Pi、真实 dispatch、真实 HTTP 和原账本；保留同一 1200ms 准备延迟、1000ms 参数、原 35 秒用例截止及全部单次接收／未知／不退款断言。timeout 由独立服务确认接收后才推进至 1000ms，核验两层 deadline 均在该时刻到期；重启保持相同请求 ID、unknown 和占额，接收仍为 1。**5 PASS / exit 0**。受控时钟不作为真实墙钟已发延迟或原 CI 复现证据；真实发送前墙钟分支另列，不能互相代替。

原 Actions run 经 artifacts 和 annotations 独立核对，没有可恢复的完整失败栈／syscall。验证脚本补充固定白名单 syscall 和有界整数 errno，仅保留错误根字段，丢弃 syscall 参数、路径及 assertion payload；1200 字上限和 report 不存 raw output 的边界不变。原生文件错误和隐私／原门禁回归 **10 PASS**，相邻 M8／receipt **12 PASS**。原生 metadata 测试最初使用 TAP 而失败：Node 24 TAP formatter 本身不透传该原生属性；改为与 CI 一致的 spec reporter 后验证，不声称能恢复 TAP 已丢字段，原失败原件保留。

以上为分范围定向证据，不能拼成 Full。私有日志为 `80-oauth-cleanup-red.log`、`80-oauth-login-launch-red.log`、`80-oauth-lifecycle-green.log`、`80-classifier-presend-assumption-red.log`、`80-classifier-deadline-green.log`、`80-native-error-diagnostic-spec-green.log` 和 `80-final-lifecycle-gate-companions.log`。类型、lint、diff 通过；完整候选的必需 CI、正常合并及工单关闭仍须取得真实结果。#81 尚未实施。
