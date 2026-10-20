# U1-06 整批联调与验收

日期：2026-09-30（Asia/Shanghai）。**U1-06 已验收，G1-01–G1-06 在规定的 C/P/B 层次通过；U1 为 6/6，产品 Task 总计 20/44。** 本次不是全部 WebUI、Full 安装、日常升级或收费 Provider 验收。下一项是 U2 入口 G2-00；该门禁未通过前不实施 U2 产品集成，更不进入 Electron。

依据：[完整计划](2026-09-26-webui-optimization-plan.md)、[Task 看板](2026-09-26-webui-optimization-tasks.md)、[验收矩阵](2026-09-26-webui-optimization-acceptance.md)、[U1 进展](2026-09-29-webui-u1-progress.md)、[U1-05 历史范围](2026-09-30-webui-u1-05-recovery-acceptance.md)。先前各轮子集和失败记录保留，本次仅补齐整批集成与故障链路。

## 1. 源码、运行身份与证据位置

- 工作区：`LOCAL_WORKSPACE/repo`；分支 `codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`，带原有未提交改动，不以 HEAD 单独标识本次源码。
- 基线 `baseline-1790743339839.json`；最终非文档源码指纹 `2070fe0660c85e702563d02fa3944017d825ae7fb4d427880703b786a4fa54aa`，见 `closeout-1790747480194.json`。相对基线仅改变下列 10 个非文档文件，没有意外差异；原日常 stack 链接、Glacier 交互审计和 HEAD/分支未变。
- 支持矩阵：macOS arm64，Node 22.19.0 / 24.19.0；实际 Pi 0.85.1。浏览器及崩溃夹具使用已验真的私有 SDK 栈 `sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b`，其包源码提交为 `cb27c6a9ede6cdb8bbedd155bf74e29e1198210a`；当前 Host 来自工作区，不将 SDK 包提交冒充 Host 源码提交。
- 崩溃探针的 Host 分别运行在 Node 22/24，Pi 子进程均使用该私有发行包要求的嵌入 Node 24。普通真实 Pi RPC 测试在两种 Host Node 下分别运行 SDK 子进程。这是 P 层身份记录，不是新 Full 安装验收。
- 证据根为仓库外 `../artifacts/webui-optimization/U1-06-0930-6w4tzW/`，即 `LOCAL_WORKSPACE/artifacts/webui-optimization/U1-06-0930-6w4tzW`。以下 JSON、日志和截图路径均相对该根；保留原始失败/中间态，不在文档写私有配对 URL 或凭据。
- `final-source-applicability.json` 按文件核对早期报告：最终 UI/类型检查仅晚于一个浏览器夹具 guard 修改；Host/Pi/崩溃回归仅晚于该夹具及弹窗 class/CSS 修改，所有生产 `packages/` 和相应被测源码未变。最终 UI 已另行测试、构建并由 Ego 页面验真，不声称全部报告全仓指纹相同。

## 2. 本轮补丁与风险

| 改动文件 | 已证实问题及补丁 | 风险与保护 |
| --- | --- | --- |
| [useInputDraft.ts](../evidence/2026-10-18-local-development-history.md#local-f423e05274e70cdc)、[DraftNotice.tsx](../evidence/2026-10-18-local-development-history.md#local-33912591b4556b6c) | 浏览器异常恢复副本不再被当成空草稿；保留原始字节，锁住编辑、保存和发送，先只读加载 Host 草稿供比较。显式选择 Host 草稿前先备份异常副本，备份失败不清原文 | 新增的恢复动作有明确影响说明。备份只在本标签页 `sessionStorage`，关闭前仍须复制重要内容；不承诺跨标签关闭的持久备份，不更改 Host 权威内容 |
| [useInputDraft.ts](../evidence/2026-10-18-local-development-history.md#local-f423e05274e70cdc)、[useInputDraft.test.tsx](../evidence/2026-10-18-local-development-history.md#local-8d8580a8972b8722) | 保存已提交但 HTTP 确认丢失时，组件卸载曾再次自动 POST；错误态卸载现在不重发，重新加载先 GET 核对。新增损坏、未知 schema、备份容量失败与丢 ACK 回归 | 用户新的显式编辑仍可保存；未知结果不靠重发探测。测试验证一次原保存，刷新可恢复已提交文本 |
| [InputQueue.tsx](../evidence/2026-10-18-local-development-history.md#local-b529319bbdb71859)、[host-ui.css](../../webui/src/host-ui.css) | 为移除 Portal 弹窗提供明确作用域，编辑/移除/恢复及草稿异常按钮满足桌面 40px、窄屏 44px 最小目标 | 只改本批控件尺寸与作用域，保留 Glacier 和对话优先布局；最终稳定态与动画中间态分列 |
| [host-input-store.test.mjs](../../tests/host-input-store.test.mjs) | 补读取后的草稿/队列损坏及 schema/digest 负例，验证准入、编辑、保存/清除拒绝，原文件字节不被默认值覆盖 | 仅隔离夹具，不破坏用户历史；存储检查共 23 项，包含于相关回归 |
| [host-input-crash.test.mjs](../../tests/host-input-crash.test.mjs)、[host-input-crash.mjs](../../tests/fixtures/host-input-crash.mjs) | 新增真实 Host `SIGKILL`，等待实际 Pi 工具/持久会话后强杀，重启核对草稿、队列、锁、旧 cookie 与授权 | 只杀自有 Host/worker，不触碰日常服务；受控孤儿保留锁并 fail closed，不越权自动解锁或伪装自动恢复 |
| [host-input-browser.mjs](../../tests/fixtures/host-input-browser.mjs)、[webui-u1-storage.mjs](../evidence/2026-10-18-local-development-history.md#local-0a68cbaea5200199) | 注入实际成功 HTTP 响应丢失、会话占用、模型缺失、Host 草稿坏字节；补受控重启和源码边界检查。修夹具将未启动 worker 的空 PID 当进程组 0 的错误 | 注入仅夹具，不修改生产 handler/React 状态来制造成功；通用 Node 矩阵与精确私有栈分开，生产发行身份校验不降低 |

## 3. 自动化与真实 Pi 结果

| 层次/检查 | Node 22.19.0 | Node 24.19.0 | 证据 |
| --- | --- | --- | --- |
| C：WebUI 全部组件/流程回归 | 11 文件、92 通过、0 失败 | 11 文件、92 通过、0 失败 | `ui-1790744705251.json` 及各 stdout |
| C：Vite 生产构建 | 退出 0 | 退出 0 | 同上；最终 HTML/JS/CSS 与实际服务哈希一致 |
| C：root / safety / Host / WebUI 类型检查 | 4 组退出 0 | 4 组退出 0 | `types-1790745516852.json` |
| C/P：Host、配置、打包及文档相关回归 | 168 项：163 通过、5 跳过、0 失败 | 168 项：163 通过、5 跳过、0 失败 | `regression-1790744530752.json` |
| P：实际 Host/Pi RPC 安全位置补充、三条 FIFO、模型失败、未知输入、新建草稿 | 4 通过、0 跳过/失败 | 4 通过、0 跳过/失败 | `pi-input-1790744613121.json`、`pi-receipts-*.json` |
| P：实际 Host 强杀，readonly / controlled 两种恢复边界 | 2 通过、0 跳过/失败 | 2 通过、0 跳过/失败 | `crash-1790744516995.json`、对应 `pi-crash-*.json` |

通用回归的 5 项 SKIP 是既有 3 项专用 SDK scout/writer/installed Host 和 2 项须精确栈的崩溃用例；后两项在独立崩溃阶段实际运行，不将跳过填成 PASS。不是全仓所有测试、所有 SDK 路径或 Full 安装通过。

真实强杀结果：readonly 新 Host 将旧运行标为 `HOST_RESTARTED`，恢复输入但保留暂停/未知，不增加 task/模型请求，旧认证失效，旧 worker 已退出；controlled 新 Host 检测孤儿并以 `CONTROLLED_ORPHAN_REQUIRES_RECONCILIATION` 拒绝启动，保留项目/会话锁，没有恢复审批或写入。这证明所测安全边界，不提供突然崩溃后无人工介入的恢复承诺。

## 4. Ego 31 整批旅程与 G1 结论

Ego Lite 空间 31，两个自有页面，连接当前源码 Host、最终 Vite 构建、真实 Pi 和仅 loopback 的受控模型。用户操作通过实际页面控件完成；仅故障设施使用自有存储/模型/HTTP/租约和 native socket/CDP 注入，不修改 React 内部状态或直接调用 handler 代替操作。

| Gate | 观察与结论 | 主要页面/链路证据 |
| --- | --- | --- |
| G1-01 PASS C/P/B | 停止历史直接发送沿用真实 session；独立新建生成不同 session。缺账号/缺模型不隐式回退且保留草稿；会话占用返回 `OWNERSHIP_HELD` 不发模型请求，释放后显式重试沿用原历史，未继承授权 | `B01`、`B11`、`B12b`、`B12c`、`B13b`、`B16`；Host 准入回归 |
| G1-02 PASS C/B | 两项目/会话草稿隔离并刷新恢复；离线第二窗口与新 Host 版本产生明确双文本冲突，显式 CAS 选择后同步。保存丢 ACK 先核对；浏览器/Host 损坏内容保留且阻止发送，不写回默认空值 | `B08`、`B09` 两份、`B10-host-corrupt-recheck.json`、`browser-corrupt-preserved-1790745582736.json`、`B14` 两份、`B15`；新增草稿/存储负例 |
| G1-03 PASS C/P/B | 实际 read 工具等待时补充显示 accepted，未打断工具；释放后由真实 Pi carrier 证明消费。独立停止进入取消/未知保护，进度和待审批状态来自实际事件 | `B01`、`B02`、`B05`、`B17`、`B18`；`pi-carriers-integration.json` |
| G1-04 PASS C/P/B | 排队三条，第二条键盘编辑、第三条移除；丢队列 ACK 未重发。失败后暂停，显式恢复后前两条按 FIFO 各消费一次，移除项无 carrier；重复 ID、绑定漂移、结束竞态由 Host/实际 Pi 定向回归覆盖，不偷偷换身份 | `B03`、`B04`、`B07`、`pi-carriers-integration.json`；投递/HTTP/RPC 回归 |
| G1-05 PASS C/P/B | 失败、取消保留暂停项，unknown 只读核对仍未知且阻止恢复；旧审批以正确协议头返回 409/`APPROVAL_EXPIRED`。native 断连禁用审批、重连不恢复授权；受控重启刷新/核对请求 5→5、task 5→5，显式恢复才请求 5→6且新 task 为 Inspect；实际强杀行为另列 | `B06`、`B17`、`B18`、`browser-restart-final/B20`–`B22`；真实强杀报告 |
| G1-06 PASS B | 历史续接→实际工具与进度→补充/三条队列→编辑移除→模型失败暂停→键盘显式恢复形成一段完整旅程；Escape 返回触发控件焦点。重启后模拟触控在 44px 控件显式恢复，确有新 task/真实消费，不只是界面变亮 | `B01`–`B07`；`browser-restart-final/B22-post-restart-explicit-touch-resume.json` |

稳定响应式结果：390/761/1440px 无横向溢出、右侧默认收起；编辑/恢复按钮最终实际目标为桌面 40px/窄屏 44px，移除弹窗最终 computed min-height 同口径。`browser-restart-final/B23-final-build-responsive.json` 校验实际 HTML/JS/CSS；`B23c-settled-grid-layout.json` 及 `accepted-workbench-1440-v3.png` / `accepted-workbench-390-v3.png` / `accepted-recovery-390.png` 为实际已打开核对的最终截图。v1/v2 和弹窗缩放中间态保留，不用中间尺寸冒充稳定结果。

`pi-carriers-integration.json` 验证两夹具共 10 项 consumed：每项 inputId、正文、规范 digest、task/session/project、entryId 对应一次实际 Pi carrier。primary 为 8 consumed / 1 removed / 1 paused / 1 unknown；restart 为 2 consumed。未找到 carrier 不等于已证明从未执行，unknown 不因此降为安全重试；所测各一次不等于任意故障下无条件 exactly-once 保证。

## 5. 失败台账、回收与边界

- 初次保存丢 ACK 测试发现卸载再次保存，红测后修复；损坏副本/备份失败负例保留。首次精确栈/通用 Node 环境混用导致 `DIST_MANIFEST_INVALID`，`crash-1790743907874.json`、`crash-1790744159925.json`、`regression-1790744318461.json` 仍保留；最终将验证路径区分，不绕过 manifest 校验。
- primary 浏览器夹具的重启/停止收据曾因未启动 worker 的空 PID 触发错误断言，原 exit 1 与 `B19-restart-assertion-diagnosis.json` 保留。逐 PID 核验真实 worker 已退出，实际私有存储和 Pi 历史恢复到 `browser-fixture-manual-closeout.json`；原模型请求正文数组未落盘，明确记 `NOT_RECORDED_AFTER_FIXTURE_ASSERTION`，仅使用此前实测请求数，不补造正文。
- 修夹具 guard 后在同一 Ego 空间运行独立 restart 夹具，实际制造一次启动前占用失败，验证空 PID 不再被判存活；随后受控重启、显式恢复、正常 stop 退出 0。它补齐失败的重启/回收阶段，不代替或抹除 primary 完整旅程。
- 两浏览器夹具分别 11/6 次本地模型请求、10/5 个实际生成 Pi worker；累计 17 次请求、15 个真实进程组，不含单独 C/P 探针。`fixture-cleanup-verified.json` 确认所有实际生成组退出，仅删除两个自有临时根；证据保留。正常 restart 夹具 pending input、租约、账号占用归零；primary 手动收口口径单列，不夸大为同一正常 shutdown 收据。
- Ego 空间已 finish 一次：两个受管页面、0 untracked，见 `ego-finish.json`。没有日常安装晋升、用户历史清理、依赖/Pi 升级、提交/推送或外部模型调用。
- **NOT_RUN**：新 Full/纯安装/日常入口；收费 Provider（仍 NOT_AUTHORIZED）；物理断网、断电、实体触屏、物理 IME 和屏幕阅读器。native socket 关闭＋CDP offline 与模拟触控仅证明具体注入/操作路径，不能泛化为上述硬件场景。性能总体验收仍在 U6。
- 本轮使用前端技能补齐异常状态、原生键盘焦点与点击尺寸，保留 Glacier 风格和既有组件；没有进行无关视觉重设计。

## 6. 下一项

沿 [发行材料/Full 实施清单](2026-09-29-webui-u0-parser-full-integration.md)和[阶段调整](2026-09-29-webui-parser-gate-adjustment.md)执行 **G2-00**：新的资源/源码身份与 F01–F06、完整对应源码/许可/构建闭包、默认发行接线及 ledger/双 SBOM/notices、精确候选内容、隔离 Full 断网安装。从实际精确资源验证，不借 checkout/全局回退。

当前 G2-00 完整门禁 NOT_RUN、U2 入口 BLOCKED，F02/F03 PARTIAL，Full NOT_RUN；旧 FAIL 与 `OPEN_UNATTRIBUTED` 保留。未通过前不开始上传/材料卡片/RPC/快照产品集成，不把发行义务延期至 U6；U2–U6 共 24 个产品 Task、25 个完整门禁（含 G2-00）尚未完成，Electron 仍在 U6 后。
