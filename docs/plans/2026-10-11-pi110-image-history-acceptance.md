# PI110-N13 / #74：历史图片、下载与显式项目导出局部验收

依据总规格 [#19](https://github.com/Ricardo121380/only-my-pi/issues/19)、[本票 #74](https://github.com/Ricardo121380/only-my-pi/issues/74)、[生图验收 #73](2026-10-11-pi110-images-acceptance.md) 和 [分类验收 #72](2026-10-11-pi110-classification-acceptance.md)。开始本票时原生依赖 #73、#63 均为 completed。两票共用实施批次，但独立验收、审查与关闭；本记录不关闭 #19、#43 或 #59。

## 行为与保护边界

历史图片读取 Pi 当前分支的 `omp-image-artifacts` custom entries，逐个核对原请求账本、原始 manifest、项目、大小和 SHA-256。不会从旧会话恢复模型、MCP、写入许可或登录资格，也不会调用 Provider。原生位置分支复制该位置已有 custom 引用与 codemode store，保留原会话、原请求、父脚本和来源；较早位置没有图片，较晚状态不会被带入。共享图片保持原会话来源，缺失或损坏时保留引用并明确标记，不重新生成。

WebUI 的“历史会话图片”、CLI `omp image history /absolute/session.jsonl --project /absolute/project`、TUI `/omp-image history` 只读原分支。CLI `download SESSION ENTRY REQUEST INDEX --project PROJECT` 将已验证 PNG 写到 stdout；浏览器的“下载 PNG”返回受保护的 attachment。下载与项目写入有不同入口，不需要恢复旧模型许可。新引用没有加入既有全文索引；图片读接口独立于原消息分页。

显式导出先选择当前项目内已存在父目录的相对 PNG 路径，再核对原图、父目录身份和目标版本。页面展示原图 SHA-256，以及已有目标的字节数和 SHA-256；必须明确允许项目写入，已有目标还必须明确确认覆盖。Host 协议 2、导出协议 1、有效本机认证、所选项目范围和共享项目 writer 是独立检查。CLI 导出同样经运行中的 Host，`commit OP --confirm-write [--overwrite]` 不直接落盘或绕过项目 writer。

路径拒绝穿越、绝对路径、敏感位置、符号链接、硬链接、缺失父目录和不安全目标。准备、发出前、发布前与 worker 发布时重新核对目录身份和已有文件版本。实际 macOS `/dev/fd/<directory>/child` 不支持预期目录访问，故未使用绝对路径回退；采用固定 cwd 身份的可信 Node worker 和 Seatbelt，只允许目标 PNG 与该操作临时文件写入，禁止网络和派生进程，环境不含账号凭据。新目标使用排他发布，覆盖通过已确认版本的 rename，目录同步并重新核对最终字节。版本检查与协作 writer 限制共同约束发布；不声称能锁住所有外部编辑器的最终 syscall 时间窗口。

导出是独立持久 Host 文件操作，不是模型请求或 tool grant。稳定操作 ID 和 `prepared/dispatched/unknown/completed/failed/cancelled` 回执保存在 version 1 导出账本；派发状态和 worker 身份在给 worker 输入前持久化。已完成操作幂等返回原回执。未知结果继续持有项目 writer，阻止新导出与原操作重放；重启后仅展示已有回执。显式 `reconcile` 只在 worker 已退出且目录身份、目标大小和内容摘要符合原来源时核对已存在字节并同步目录，不再次发布，不调用模型。源图片、模型请求账本和父脚本计费均保持独立。

审查后补足跨进程恢复：同一 unknown 操作经过原 owner token、受限 worker 来源和退出校验后，显式接管保留逻辑 token，同时更新实际 PID / 进程身份。核对失败或接管后、账本更新前再次退出，都不会使下一次显式核对永久失去原操作关联。锁的接管 guard、验证和释放仍比较物理 PID / identity；其他调用者的默认恢复仍生成新 token。

页面提供当前分支引用数、引用字节、可用空间、共享/缺失/损坏和导出状态，清理保持 `EXPLICIT_ONLY`。沿用 #73 的全局 256 MiB 生图存储预占；不为新输出删除历史、共享图片或项目原件。导出权限错误、目标版本变化和路径拒绝不会改动目标。页面收到未知回执后只允许核对原操作；已知拒绝需重新核对目标并重新明确确认。

## 数据兼容与回滚范围

新会话 custom entry version 1、图片请求 ledger version 2 和导出 ledger version 1 分别有读取保护。未知版本或损坏来源拒绝读取/写入并保留原字节。headless 的既有会话在 session admission 与 fork 之前执行兼容检查，避免旧 reader 先改写新历史。真实已安装 Pi 0.85.1 public SDK 对新图片历史在 admission 前返回 `SESSION_READER_UPGRADE_REQUIRED`，admission 次数为 0，文件字节不变；Pi 1.1.0 可以恢复同一来源。

这证明受控读取与数据保护边界，未执行安装切换、binary rollback 或完整恢复晋升；这些仍由 #59 验收。旧源历史和新图片可以保留，重新使用兼容 reader；不自动转换、补写、清零或重放。

## 实际身份与证据

证据根目录：`LOCAL_WORKSPACE/artifacts/issue-73-74-20261011`。批次起始 HEAD `f4147a59776feb987ad69decd7c6041ab395d645`；本票起始 HEAD `0de27a13dff37c1daad7ee06c67ccf115ea7ab5d`，分支 `codex/webui-phase1`。`baseline-74-files.json` 与完整原件固定当时 302 个既有修改/未跟踪文件。`owned-74.json` 固定本票归属；App 只提交新增 import 与历史图片入口，其余既有修改保留。提交前 301 个非归属文件 SHA-256 全部一致。

P 使用当前工作树复制的 OMP、真实 Pi 1.1.0、Node 24.19.0 / 22.19.0 和既有外部扩展私有副本，不安装、不切换用户栈、不复制真实 auth。每轮 receipt 固定源文件、SDK/Node 摘要、物理扩展、绑定、账本与受控 HTTP 服务接收数。`source-74-precommit.json` 固定所有本票源码、完整页面构建摘要和实际 B receipt；测试对象是 `LOCAL_CONTROLLED_SOURCE_HARNESS`，不是完整安装候选。

精确本地代码提交为 `dfeb220c65b3456189cb3e36bfe6424ff6e2264f`（26 文件）与 `3fa8990f646446d120a4acf5ae1fd6103941b3e1`（五文件恢复修复）；累计本票 30 个归属文件。`source-74-review.json` / `source-74-final.json` 分别固定审查和最终提交源码、实际工作树、Node 摘要、P/B 来源差异及未运行门禁。App 的既有工作树与提交版本区别单独记录，文案结论随后精确提交；未推送或发布代码。

固定 PNG 为 64×64 RGBA、253 字节，SHA-256 `e61ccede3be4b0179bfbfdf678991b58e81103a49f2c7ed7887f779450cd95d9`。合成生图账号 A 的 B 原请求为 `92901313-40eb-4d8c-80e3-1f05e84233e0`，当前分支 custom entry `3ccdb828`，来源会话 `01a12ab8-3893-770b-9845-d64bc50d9ea9`。部分用量输入 12、输出 null；不补零，不计入父脚本账单。

| 证据层 | 实际证据 | 结论与限制 |
| --- | --- | --- |
| C | `48-history-C-final.log`，7/7；`49-real-old-reader.log`，2/2 | PASS。实际受限 worker PNG 发布、0600、幂等 inode；写入权限/项目 owner/覆盖/版本拒绝；穿越/敏感路径/链接/缺父目录；发布回执持久失败后 unknown、重建 Host 导出模块不重放、显式目标核对；发布检查后父目录被替换仍不写外部文件；导出未来 reader 和真实旧 Pi reader 拒绝保留字节。来源在 C worker 用例为合成依赖，真实来源链由 P 验证。 |
| C / 进程退出后恢复 | `61-export-process-unknown.log`、`62-export-process-reconcile.log`，均 exit 0 | PASS。真实 worker 已发布 PNG 后注入 completion receipt 故障，父进程退出并保留 unknown owner；另一个实际 Node 进程先只读 unknown、拒绝重放，再明确 reconcile。两进程 PID 分别为 39887 / 40408，原 inode 不变，第二进程源读取次数为 0。该用例不依赖同进程的 owner Map。 |
| C / 接管失败与再次退出 | `63-export-recovery-red.log`、`64-ownership-physical-red.log` → `65-export-recovery-green.log`、`72-export-recovery-final.log`，均 13/13、exit 0 | PASS。修复前两条三进程链均在第三进程返回 `IMAGE_EXPORT_OWNER_CHANGED`；修复后“目标版本不符→恢复原字节→显式核对”以及“接管持久锁后、账本更新前退出→显式核对”均 completed，源读取次数为 0、worker 未重发、原 inode 不变。最终两组实际 PID 为 11173 / 11205 / 11219 与 11234 / 11247 / 11252。相同 token、不同物理 PID / identity 的旧 lease 不得释放新 owner，普通显式恢复仍轮换 token。红灯与每阶段原件单独保留。 |
| 共享 owner 回归 / 最终 P | `66-shared-owner-regression.log`，58/58；`67-P-after-recovery-node24.log`，3/3；`68-P-after-recovery-node22.log`，8/8；`71-typecheck-recovery-final.log`，均 exit 0 | PASS。输入 FIFO、会话 admission、TUI/终端、MCP 实际受限写入及未知状态继续遵守同一 writer。修复后重跑真实 Pi 历史/下载/导出链路（Node 22/24）与旧 SDK 保护；Node 22 也通过两条三进程恢复和物理 owner 检查。中间 `69/70` 类型红灯为 options 的 JS 类型推导缺少 recover，补齐具名参数声明后 `71` 通过；未改运行时门禁。 |
| P / Node 24 | `46-history-P-flow.log`，1/1 | PASS。实际 Host/Pi 生成一次、重启、只读历史、受保护 attachment 下载、权限拒绝、真实 worker 导出、CLI history/download/export；原生位置分支保留前置 codemode store 和共享原图片，较早位置无图片；恢复分支没有 image 请求/许可，服务接收数始终 1，源会话字节不变。 |
| P / Node 22 | `47-history-P-node22.log`，1/1 | PASS。同一完整真实 Pi graph 与 CLI/worker 链路实际执行。 |
| P / TUI | `55-TUI-history-scroll.log`，1/1 | PASS。真实 PTY 配置、逐任务同意、生成一次后 `/omp-image history` 查看原图摘要，服务接收数仍 1；正常退出。 |
| B | Ego Lite TaskSpace 48、p1/p2；`b74-final/01–11` snapshots/PNG/JSON、`browser-acceptance.json`、`browser-image-final-receipt.json` | PASS。生成一次→重启 Host→历史→实际浏览器 download→写入复选确认→导出；覆盖需两项确认，准备后目标改为 39 字节时拒绝且字节不变，取消旧计划、重新核对和明确覆盖后恢复原图；穿越拒绝；切项目清除旧引用，两窗独立保留正确来源；缺失、损坏标记及恢复；最终接收数 1。下载、源图片和项目结果摘要相同。受控服务正常退出并封存 receipt，TaskSpace 已 finish 一次。 |
| 复用账号/部分用量/未知 | #73 的 `B-account-busy.txt`、`B-class-partial.json/png`、未知前后账本及 receipt；本票 B 与全量 suite | #73 匹配源码的受控账号 busy、分类部分用量和未知不重放证据保留；本票 B 生图部分用量输入 12 / 输出 null，重启/历史/下载/导出接收数不变。全量结果另列，不用旧证据替代新行为。 |
| 页面全量 | `59-full-web.log` | PASS，17 文件 / 108 tests，exit 0，包含图片、历史恢复、未知回执与既有账号/输入/会话 UI。 |
| 类型 / 构建 | `60-typecheck-final.log`、`57-build74-caption.log` | PASS，exit 0。构建保留已有 chunk size advisory；实际 B 后半链路重载此构建。修正已有 codemode 提示中“图片生成尚未启用”的过时文字。 |
| Node 全量 | `58-full-node.log` | PASS，1774 passed / 5 skipped / 0 failed，exit 0。Node 24、4 个 test 并发；图片/分类本地验收标志与已安装旧 SDK 读取验证。五项跳过为两个 production SDK scout/writer、两个真实 Pi Host SIGKILL 场景和 installed Host/PTY；未启用其独立的 production/source/installed-package 门禁，不将 SKIP 记为 PASS。全量在接管修复前完成，最终后端变更另以 `65–72` 的受影响 C / 真实 Pi P / 类型检查留证，未重跑无变化的全仓与页面测试。 |
| I / L / Full / Linux / Windows / remote CI / release | 本批未执行 | NOT_RUN。导出受限进程当前仅 macOS；其他平台明确拒绝。真实付费调用、安装切换、Full、发布和 CI 不由局部绿灯授权或证明。 |

`b74-final/session-and-worker-identity.json` 保留实际 JSONL 原件摘要、三个导出操作及 worker Node/源码/Seatbelt profile 摘要；`exports-final.json` 为 completed / cancelled / completed，`04-rejected-file.json` 保留拒绝时未改动目标的证明，`05-recovered-file.json` 核对恢复后的原图摘要。最终命令与退出码另存 `commands-74.json`。

## 失败轮次与适用范围

保留 `29–41` 的实现红灯和诊断，不将它们整体记为 PASS：初轮缺历史接口、catalog 索引尚未就绪、macOS 目录 fd 访问不支持、初版 Seatbelt 缺 Node 熵源读取、导出 record 含 undefined、目标字段比较顺序、fixture 多轮脚本语义和 teardown 顺序均在对应边界修正后重跑。`39` 的四项 C 先通过，后扩展为 `48` 七项；完整 P 最终由 `46/47` 验证。

TUI `50` 在断言失败后 evidence 目录未创建导致 teardown 未完成，该轮记 FAIL/PARTIAL；只终止该轮确切自有进程，保留隔离目录和诊断。`53/54` 的图片摘要等待失败来自只读编辑器初始光标在末尾以及单次翻页只移动一行；`55` 通过实际键盘上移查看来源，未降低摘要断言。Ego 初轮保存前异步账号状态、隐藏 details、精确 accessible name、错误 wait 参数/文案及 38/39 字节等待造成操作/等待失败；均先回读实际页面，不盲重发。实际成功链路只生成一次，失败操作不作为 PASS 证据。

独立审查初轮 Standards 为 FAIL / P2，Spec 为 FAIL / P1：跨进程接管轮换锁 token，核对失败或再次退出后账本仍保留旧 token，后续恢复会永久拒绝。先在实际三个进程边界复现两条红灯，再修正逻辑关联及物理 owner 检查；初轮结论保留，不以已通过的同进程或双进程成功核对用例掩盖该缺口。页面和真实浏览器链路未改变；最终接管变更由新增跨进程 C 和重跑真实 Pi P 验证。

## 独立审查

Standards：PASS。初轮对 `0de27a13…dfeb220c` 的 26 文件报告一项 P2；新增故障复现及修复后，对 `dfeb220c…3fa8990f` 五文件及共享 owner 调用影响的独立 focused re-review 确认原 P2 闭合，剩余硬违规 0，新增 smell 0。原 token 绑定、worker 退出、物理 PID / identity 的 guard、verify、release 和普通恢复轮换均保持。未变部分承接原审查；App 未提交的用户改动不计入 diff。

Spec：PASS。初轮对同一 26 文件报告一项 P1；独立修复复核核实两条实际三进程链、无源读取、无新 worker、原 inode、Node 22/24 真实 Pi receiver=1，确认原 P1 闭合。剩余缺失/partial 0、scope creep 0、错误实现 0；未变部分承接原审查。两轴原文、固定 diff 和审查边界分别保存在 `review74-final.md`，原失败摘要保存在 `reviews-74-initial-summary.json`；不把审查补记为新的 B 或 I/L/Full。
