# PI110-N06 / #67：受控 MCP 项目写入本地验收

规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)，US-099–103；任务：[GitHub #67](https://github.com/Ricardo121380/only-my-pi/issues/67)。前置 [#66](https://github.com/Ricardo121380/only-my-pi/issues/66) 已于 2026-10-10T11:45:04Z 关闭，实际回读 state 为 CLOSED、state_reason 为 completed；其独立交付见 [stdio 验收](2026-10-10-pi110-mcp-stdio-acceptance.md)。确认前置后才开始本票写入实现。

## 源码、原生依赖与证据身份

本票基点 `f15db67a1e3b290cd0df0908b8da905d28f6e704`，沿用分支 `codex/webui-phase1`。批次开始基点是 `f411c29a2d9fa438c442344f6b9f0cd5248a9690`，索引为空，304 个既有修改/未跟踪文件逐一保留 hash。300 个原有文件字节未动；重叠的 package.json、pack manifest、App.tsx 和 TaskControl.tsx 只加入任务差量，原始内容留存在 before。TaskControl.tsx 本票只提交 MCP 写入四项条件的一句增量。

绝对证据目录为本机留存位置，不冒充远程可下载包：

```text
LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-66-67-1010-mW7m1w
```

真实 Pi SDK 与原生 McpClient 均为 **1.1.0**，Node 24.19.0 与 Node 22.19.0 的实际支持路径分别运行。node-pty 1.1.0 在实际 CLI TUI、人工终端用例中加载。P/B 使用 OMP 源码候选和实际安装扩展的受控副本；合成账号只访问回环模型协议服务，没有用户 Provider 凭据迁移、付费服务请求或日常安装切换。页面使用实际 build:web 产物。

`67-b/67-browser-input.json`、`67-b/67-browser-runtime.json` 保存实际运行时九个模块 hash、输入、Node/Pi/McpClient 身份，均与候选工作树一致。源码和命令收据另存于 `67-source-identity.json`、`67-command-receipts.json`；304 文件保留检查见 `67-preservation.json`。原始失败日志保留。

## C：四项准入与物理写入合同

- MCP 工具许可、当前 Coding 授权、真实 canonical 项目写入所有者、服务器物理权限同时成立才启动写入进程。Host 私有引导闭包逐次回读任务、worker PID/start、projectOwnerToken、项目和会话 owner 文件及其活进程身份。CLI 使用其实际持有的同一项目租约。环境变量或 `ownsSession` 布尔值不能替代实际项目所有权。
- 写入策略必须明确 `effect: "write"`、`writeMode: "descriptor"`、目标参数和项目相对范围。只准入已有的普通单链接文件，当前文件上限 64 KiB。拒绝创建文件、目录/文件符号链接、硬链接、越界目标、Git/Pi/秘密路径、配置根和服务器代码文件。尚无经过验证的物理边界的 path 模式服务器明确拒绝写入准入。
- OMP 以 O_RDWR / O_NOFOLLOW 打开并钉住文件描述符，核对 inode、realpath、链接数与初始 digest。获准服务继承 FD 3，实际 MCP 参数变为 `/dev/fd/3`。macOS Seatbelt 不授予任何项目路径写入权，服务经 canonical 项目路径自行写入遭 OS 拒绝；网络、fork、其他项目/私有配置的限制沿用 #66。文件描述符只指向已批准的 inode，审批或分派后路径替换无法把它重定向到项目外文件。
- 写入进程启动本身可能产生已批准目标的副作用，因此在启动前持久记录 dispatched。启动写入后 schema 核对失败也保持 UNKNOWN，不能将 tools/call 接收零次写成实际文件零影响。工具 schema、目标、凭据、配置 epoch、Coding grant 和 owner 身份在审批后、分派前再次核对。
- MCP 写入期间阻断 OMP 内置变更工具、人工 shell 和其他 MCP 写入；已有 shell 或变更调用使 MCP 写入拒绝。跨 CLI、人工终端和 Agent 使用既有项目单写租约。无法确认退出的服务保持忙状态和项目保留，不能因 Coding 主进程崩溃释放残留。
- 记录任务、调用、父调用、工具、定义、目标、输入、项目 owner、inode 与前后 digest。结果分别记录 applied / not_applied / unknown、是否观测字节变化、verification: not_run；工具返回不等于项目验证通过。实际效果后丢失回执保持 UNKNOWN，重启历史不改变其结论，后续 MCP 写入须先核对而不会自动重放或回滚用户文件。

`67-final-node24.log` **14/14 PASS**；`67-affected.log` **40/40 PASS**，覆盖 direct shell/session、Host terminals/manual/controlled/RPC/resume、OMP Direct 与 stdio/config 回归。新增 fixture 失败清理后，`67-full-failure-recheck.log` 的本票 15 项全部通过，但整条 57 项组合为 **56 PASS / 1 FAIL**，不能把该命令记为 PASS。随后共享准入竞态与 handled 输入观察修正，`67-green-admission-final.log` **43/43 PASS**。`67-final-node22.log` **1/1 PASS**，`67-cleanup-node22.log` **2/2 PASS**。WebUI `67-web-first.log` **94/94 PASS**；类型检查、lint、pack:check PASS，打包 **1594** 个文件。最终准入差量的类型检查、lint 及真实 P 另存 `67-typecheck-admission.log`、`67-lint-admission.log`、`67-admission-p-node24.log`、`67-admission-p-node22.log`，后两条均 **2/2 PASS**。

Spec 首轮查出 owner SIGKILL 绕过 catch 后，孤儿写入会同时显示 UNKNOWN 与 not_applied。主线程在真实 Pi 崩溃用例补断言取得 RED（`67-red-owner-result.log`），再将启动前的 durable application 设为 unknown，并对旧 dispatched 写入作 unknown 的只读投影；不重写旧历史、不推测最终 digest。页面将 absent observedChange 显示为“字节变化尚未核对”。UI fixture 首次缺少 jsdom dialog 方法的失败独立保留，补齐后得到对应文案 RED（`67-red-owner-ui-boundary.log`）。修复后 Node 24 六个受影响真实 P 场景 **6/6 PASS**，Node 22 owner 崩溃 **1/1 PASS**，WebUI **95/95 PASS**，类型检查、lint、build:web PASS；见 `67-green-owner-node24.log`、`67-green-owner-node22.log`、`67-green-owner-web.log` 及 `67-*-owner.log`。真实崩溃用例还覆盖旧 application: not_applied 的 dispatched 记录能正确投影 unknown，磁盘历史保持原字节。

## P：真实 Pi、实际接收账本与文件效果

受控 stdio 服务 `tests/fixtures/mcp-write-server.mjs` 独立记录启动、tools/call 接收和实际 effect，且故意声明 readOnlyHint: true。产品依据显式策略和物理权限判断，而不信任此 hint。

14 项专项覆盖：

1. 四项准入成立，服务实际接收一次、写入一次；真实 README 字节变化，记录 applied、inode/owner/digest 身份及 not_run。
2. Inspect 或未批准工具没有真实写入；Coding 授权不能代替 MCP 决定。
3. 目录 symlink、文件 symlink、硬链接和范围外目标均零接收、零效果，项目内外字节不变。
4. 审批等待期间替换目标使审批失效，写入进程零启动；分派后替换路径也不能影响项目外文件，旧 inode 的已发生变化如实 UNKNOWN。
5. 实际修改后服务崩溃，回执 UNKNOWN；模型再试遭 MCP_WRITE_RECONCILIATION_REQUIRED，重启历史仍未知，新任务仍需重新 Coding 授权。
6. 真实接收后 revokeTask 与 cancelTask 竞态停止服务、保持 UNKNOWN，不把已分派写入虚构为未执行。
7. 启动服务自行使用 FD 产生效果、随后未收到 tools/call，仍记录 UNKNOWN 与实际 digest 变化；未经批准的发现进程无法使用写描述符。
8. 人工原生 PTY 实际写入，Agent/CLI 因项目租约拒绝；终端确认退出后交接给 Agent/MCP，待审批期间又拒绝人工入口，任务终止后 CLI 可取得释放的租约。
9. 真实 CLI TUI 键盘逐次批准 Coding 与 MCP，实际写入一次并正常退出；没有注入审批状态。
10. 已批准 Coding 后丢失真实 Host owner token，仍拒绝工具写入，零接收且真实文件不变。
11. Pi Coding owner 崩溃后 MCP 残留实际产生副作用，Host 与 CLI 不释放/接管项目；UNKNOWN 和 reconciliation 留存。测试只核实并清理其自己的临时进程身份。
12. 新写 schema 和凭据撤销都使旧许可失效，零实际工具接收、零文件变化。

RED `67-red-write-clean.log` 保留最初尚不支持 write scope 的真实失败。`67-write-boundaries-first.log` 是 6 PASS / 3 FAIL，失败在测试观察 runtimeDir/接收文件尚未出现的短暂状态；有界观察修正后 `67-write-races.log` 3/3 PASS，最终 14 项整体 PASS。第一次 RED 的 fixture 在配置失败时未及时关闭，已补充失败清理并仅终止该 fixture 的核实进程；原日志保留。

## B：Ego Lite 实际页面

沿用同一 TaskSpace **43**、p1，使用真实 Host、Pi 1.1.0、原生 MCP 与 build:web 页面。从 MCP 服务器 JSON 保存/停用、启用，经过实际 Coding 与“仅本次”审批取得实际文件写入。随后在待 MCP 审批时停止任务，再用崩溃模式取得 UNKNOWN；新任务重新批准 Coding 后被已有 UNKNOWN 拒绝，没有第二次写入审批或工具接收。停用并实际重启 Host 后四条历史和拒绝原因仍可回读，新草稿回到未选账号、Inspect，不恢复旧许可。

`67-b/67-browser-runtime.json` 四条运行按执行顺序：

| 场景 | tools/call 接收 | 实际 effect | 状态 | 结果含义 |
|---|---:|---:|---|---|
| 明确批准当前文件 | 1 | 1 | completed | applied，观测字节变化，项目验证未运行 |
| 审批前停止 | 0 | 0 | rejected | not_applied，前后字节不变 |
| 写入后回执丢失 | 1 | 1 | unknown | unknown，页面明确不会自动重试 |
| UNKNOWN 后的新任务 | 0 | 0 | rejected | MCP_WRITE_RECONCILIATION_REQUIRED |

崩溃场景写入与前次相同的内容，账本实际 effect 为 1，但前后 digest 相同，因此页面如实显示“未观测字节变化”；P 的独立崩溃用例从初始文件写入不同内容并核对实际 digest 变化。不能将此处相同 digest 当作未执行或回滚。

所有运行进程 status: stopped、alive: false；raw Pi 配置字节保持，九个 runtime 模块 hash 与候选一致。`67-fixture-stop.json` 实际 HTTP 200，fixture 正常退出。保存实际审批、停止、崩溃、阻断及重启 snapshots。390×844 页面截图已查看，页面宽度无水平溢出；图中保留拒绝原因和“项目验证未运行”。截图为 `67-pending-stop.png`、`67-write-unknown.png`、`67-host-restart.png`、`67-narrow.png`。一个脚本等待了错误的“本次任务已结束”字串而超时，实际取消状态为“任务已取消”，随后据真实 snapshot 和字节核对，并未重做或伪造业务结果。

共享 Host 准入修复后的实际页面另保存在 `67-admission-b/`：重新启用、选择账号/模型/受控模式、原生批准 Coding 与 MCP，一次真实接收、一次真实文件效果，applied、字节变化与未运行项目验证分别展示。实际 fixture 停止 HTTP 200、退出码 0；记录增加 HostTasks 在内的十个 runtime 模块 hash，与修复候选一致。原完整 B 与此准入差量 B 分开绑定，不改写原始运行身份。

Spec 结果修复后的 Ego Lite 差量 B 保存于 `67-owner-b/`。原生批准 Coding 和 MCP“仅本次”后，受控服务实际收到 tools/call，按已核实身份 SIGKILL 本 fixture 的 Pi owner；服务随后实际写入 README。页面与公开账本均为 reconciliation、unknown / application: unknown，且明确“字节变化尚未核对”，不把未经核对的变化说成没有变化。`67-browser-before-cleanup.json` 保存实际 **1 接收 / 1 effect**、文件字节和十一项 runtime 模块 hash，与候选一致；`67-owner-unknown-visible.png` 已查看。产品没有确认残留退出，继续保留写入所有权；留证后仅按 PID/start 身份清理本 fixture 的一个残留进程，见 `67-fixture-only-cleanup.json`。这次 fixture 关闭 HTTP 200、进程退出 0，不能将测试材料的身份清理写成产品自然完成或自动恢复。原 raw Pi 配置字节保持，所有 fixture 进程最终已退出。页面脚本曾因错误的入口/审批精确文字、重复匹配及选择到其他 dialog 而中断，均根据当前 DOM 在同一 TaskSpace 恢复；审批只提交一次，业务接收与效果未重放。

## 批次全量、失败基线与适用限制

- 本次 #66→#67 批次唯一一次全量 Node 24 命令为 `node --test --test-concurrency=4`，实际退出 **1 / FAIL**：**1626 项，1616 PASS、3 FAIL、1 CANCELLED、6 SKIPPED**，见 `batch-full-node24.log`。原始结果永久保留；局部复验不把这次全量改写为 PASS，也没有再跑第二次全量。
- 三项 FAIL 是既有 docs-links、Host 相同 requestId 的并发去重、handled prompt fixture；CANCELLED 是本票路径替换用例触发 25 秒测试时限。该文件所有 14 项结束后只剩 fixture 模型监听端口，核实测试子进程身份和无后代后 SIGTERM，以结束全量报告。身份与限定范围见 `batch-full-fixture-termination.json`，不把人为结束写成自然通过。
- 增加实际 HTTP fixture 关闭检查，并让 Host stop 回执失败也在 finally 关闭该 fixture 的模型端口；失败时保留其材料目录。路径替换测试总时限改为 45 秒，MCP 服务的 10 秒物理调用预算不变。相应本票 15 项通过；原整组 56/57 失败仍保留。
- 主线程另在公开 HTTP 入口用两次真实请求固定 MCP snapshot 的异步边界，`67-red-admission.log` 重现同 requestId 创建两个任务。将 snapshot 读取移到最终去重/容量检查之前，检查与任务登记之间再无 await。`67-green-admission.log` 为 42 PASS / 1 FAIL，剩余是 fixture 错过 handled 输入已结束的短暂 running 状态；仅对此 handled 情况允许观察 succeeded，保留全部原结果断言。`67-green-admission-final.log` **43/43 PASS**。真实 Pi stdio 读与写的修复后复验在 Node 24 与 Node 22 均 **2/2 PASS**，页面差量见上述 `67-admission-b/`。共享修复也追补到 #66 验收，不能把产品去重回归称为原有 docs-links 基线。
- docs-links 开始基线 **FAIL**：2 项中 1 PASS / 1 FAIL，同四条既有越界 artifacts 链接；带入本票，不为专项通过改写其结论。
- secret:scan **FAIL**：既有 `docs/plans/2026-10-07-g2-n01-prerequisite-preflight.md:40` mac-temp-path，原文件 byte/hash 不变。打包/类型/专项通过不覆盖此全量失败。
- 只对已实测 macOS Seatbelt、已有普通单链接文件及 descriptor 服务器放行写入。未支持创建/rename/path-based 项目写入或 Linux MCP；其他平台/无法实现物理边界的服务器明确拒绝准入。对当前产品和现有 CLI 的适用合同留证，不宣称通用跨平台隔离。
- I 完整候选安装、L 真实外部服务、发行、部署、远程 CI、日常切换 **NOT_RUN**。本地源码/安装扩展副本不是完整安装晋升；本票不关闭 #19 或整个 GP110-05。

## 独立评审与完成结论

首轮固定范围 `f15db67...7173dab` 的 Standards **PASS**（一项锁文件路径构造重复的 P3 非阻断判断）；Spec **FAIL**（owner 崩溃后的应用结果矛盾 P2），分别保存于 `67-standards-first.md` 和 `67-spec-first.md`。当时未宣称本票完成；随后主线程完成真实 RED→GREEN、Ego Lite 差量验证和修复提交，再作双轴独立只读评审。

最终固定范围 `f15db67...526dc66`（25 个文件；`d5e63ba`、`7173dab`、`526dc66`）已由两位独立只读探子分别评审，TaskControl 均读取提交版本，未把用户的工作树差量纳入归责。

- Standards **PASS**：硬规则违反 0；保留一项 P3 possible Duplicated Code，指出 Host 项目所有权核验中重复构造锁文件地址。它是维护建议，没有功能失败或文档硬违规，本次不引入无关重构。报告 `67-standards-final.md`。
- Spec **PASS**：新增阻断发现 0，确认首轮 P2 已实质消除，且四项准入、实际隔离、撤权/取消、单写竞争、未知结果及无重放均符合当前切片。核对实际 B 的一次接收/效果、十一项模块与面板 hash，以及 28 条命令收据 hash；没有运行或声称额外测试。报告 `67-spec-final.md`。

本票必需 **C / P / B 与 Standards / Spec PASS**，限定上述 macOS descriptor 范围。实现提交为 `7173dab48ee39a11c6c5de9afb3385eaf138aa18`，结果语义修复为 `526dc66c827d27821f5992f4e009062c3c794d5b`，前置共享准入修复为 `d5e63ba9463d9d3b7cdb71bb698ca50024e77ec1`。全量 **FAIL**、docs-links/secret:scan **FAIL**、I/L 与发行/远程 CI **NOT_RUN** 继续保留，不能据本票专项收口宣称全仓或 GP110-05 完成。GitHub 状态回填与关闭回读单独保存在本票证据目录。
