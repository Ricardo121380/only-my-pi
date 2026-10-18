# U1-04 补充、队列与独立停止验收

日期：2026-09-30（Asia/Shanghai）。**PASS，限当前源码的C/P/B子集；U1为4/6、总Task为18/44。** 页面已接即时补充、FIFO队列、未投递项编辑/移除和独立停止，不以按钮变亮、HTTP ACK或模型同文案证明消费。完整G1、日常安装、Full和真实收费Provider未验；下一项U1-05。

依据：[开发计划](2026-09-26-webui-optimization-plan.md)、[Task看板](2026-09-26-webui-optimization-tasks.md)、[验收矩阵](2026-09-26-webui-optimization-acceptance.md)、[设计合同](../design/glacier/2026-09-26-u0-design-contract.md)、[输入关联ADR](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。U1-01/02/03历史记录保留，不覆盖其证据及限制。

## 1. 源码、运行身份与范围

- 仓库为`LOCAL_WORKSPACE/repo`；分支`codex/webui-phase1`、HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`。本次基于脏工作树实施，没有提交、推送或覆盖已有用户改动。
- 支持矩阵Node22.19.0/24.19.0；真实进程使用已核验Pi0.85.1运行栈，stack ID `sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b`。Ego空间29连接当前源码Host、当前WebUI构建和loopback-only受控SSE模型，不连接用户项目/账号/外部模型。
- 仓库外证据根：`LOCAL_WORKSPACE/artifacts/webui-optimization/U1-04-0930-PkQFIf`。第二个可交互夹具在其`tty-rerun-R1W3mO/`下；公开记录不包含私有配对URL或token。
- 最终非文档源码/模式指纹：`7dc3b5048cbf6beb255863460faa5f632edd8a3f08bc6693945e6f8d1b832d45`。基线1303文件→1305，仅11个本轮所有权文件变化，unexpected为空；HEAD/分支、日常active链接、旧Glacier审计文件哈希不变。
- 最终UI报告与最终源码完全一致。较早类型报告仅CSS不同；Host/Pi报告仅前端文件不同，生产Host/Pi及被测后端源码未变。`final-source-applicability.json`逐文件核对适用性，不把较早报告称为最终全仓同哈希。

## 2. 实际改动

| 文件 | 交付与约束 |
| --- | --- |
| `webui/src/useInputDraft.ts` | 保存投递方式；冻结task/目标/正文/绑定/ID，单飞与保守恢复；ACK后只读对账，权威队列持有完整同一内容才清源草稿；另一窗口的新草稿不被清除；编辑/移除使用双revision |
| `webui/src/InputQueue.tsx`（新增） | 展示queued/accepted/consumed/paused/unknown/removed及持久依据；只允许queued/paused编辑移除；版本变化保留编辑文字并禁提交；native dialog与polite状态 |
| `webui/src/App.tsx` | 接补充/排队入口；配置不一致显式核对，不自动扩权；停止绑定当前运行任务而非正在看的旧任务；结束后非prompt草稿必须显式转换 |
| `webui/src/Composer.tsx` | 明确选择即时补充/排队；发送与停止独立；保留IME、忙碌和重复键盘提交保护；运行配置冻结 |
| `webui/src/DraftNotice.tsx`、`api.ts` | 未确认投递锁定原请求，仅查询不重发；队列/版本/绑定/已结束错误解释 |
| `webui/src/host-ui.css` | Glacier原tokens；窄屏44px、去嵌套纵向滚动；回到最新改正常布局流并40/44px，避免遮挡发送说明 |
| `input-delivery-ui.test.tsx`（新增）、`conversation-flow.test.tsx` | 新增14项：不确定ACK/多窗口CAS/晚响应/结束竞态/队列版本/IME和单飞；停止当前FIFO运行者而非旧视图任务 |
| `tests/fixtures/host-input-browser.mjs`、`scripts/probes/webui-u1-storage.mjs` | 可选真实read工具边界、本地模型故障和生命周期证据；U1-04限域closeout白名单。夹具不改变生产权限集合或Pi SDK |

本轮没有改变生产Host协议、持久存储schema、Pi版本、CLI/TUI配置、模型路由、依赖或日常安装。用户选择每条即时补充或排队；一条投递完成后下一条默认排队，不能把排队文本按内容猜作补充。已投递内容不存在“撤回成功”的假动作。

## 3. 自动化验收

| 检查 | Node22.19.0 | Node24.19.0 | 证据（相对证据根） |
| --- | --- | --- | --- |
| 全WebUI/新增负例与Vite生产构建 | 65 PASS，build退出0 | 65 PASS，build退出0 | `ui-1790734450916.json`及对应stdout |
| 根/安全/Host/WebUI四组类型检查 | 4组PASS | 4组PASS | `types-1790732825565.json`；之后只改CSS，类型源码未变 |
| Host投递与HTTP | 29 PASS | 29 PASS | `delivery-1790731984085.json` |
| 生产Host＋真实Pi＋本地可控模型 | 4 PASS | 4 PASS | `pi-input-1790731984515.json`与`pi-receipts-*.json` |
| 源码/模式、日常链接、旧审计及提交边界 | PASS | 共用工作树检查 | `closeout-1790734513421.json`、`final-source-applicability.json` |
| 文档链接与最终diff | PASS | PASS | `docs-*.json`；`git diff --check`退出0。最终汇总为`final-acceptance-summary.json` |

逐命令包含绝对Node路径、版本、argv、退出码、耗时、stdout及进程组退出核对。成功命令的stderr限于runner未单独返回，报告如实标记，不声称已保存不存在的stderr。整体仓库完整回归本轮NOT_RUN：生产Host/所有权/终端代码未变，执行受影响WebUI全测、投递与真实Pi检查；完整U1集成由U1-06承担。

可复核入口（`OUT`表示上面的确切证据根，Node/stack须按报告中的已验证路径指定）：

```text
node scripts/probes/webui-u1-storage.mjs --output OUT --phase ui --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase types --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase delivery --node22 NODE22 --node24 NODE24
OMP_TEST_STACK_PACKAGE=VERIFIED_PACKAGE node scripts/probes/webui-u1-storage.mjs --output OUT --phase pi-input --node22 NODE22 --node24 NODE24
node scripts/probes/webui-u1-storage.mjs --output OUT --phase closeout --baseline OUT/baseline-1790731195774.json --scope u1-04
```

浏览器夹具开启`OMP_INPUT_BROWSER_DELIVERY=1`并显式TTY运行，stdin本地控制只释放夹具read等待，不发HTTP补充绕过页面。正式操作由实际Ego点击、键盘或原生CDP模拟触控完成；API读取只核对实际结果，不注入React状态。

## 4. Ego页面与实际Pi证据

| 场景 | 实际观察与判定 | 证据 |
| --- | --- | --- |
| 工具执行期间补充/重复提交 | read仍等待，模型请求数不增；补充仅accepted、无编辑/移除；双快捷键只准入一次 | `B01-accepted-tool-pending.json`；第二夹具`B07-FIFO-pending.json` |
| 队列编辑/删除 | 三项保留，键盘编辑第二项/确认移除多余项，不停止原工具；完整正文已进权威队列才清输入 | `B02-queue-edit-remove.json` |
| 多窗口编辑冲突 | 窗口B更新后窗口A禁保存但保留文字；Escape返回编辑按钮，不覆盖远端正文 | `B04-multiwindow-queue-conflict.json` |
| 触控排队/移除/编辑 | 原生CDP触控点击；排队及确认移除实际生效，触控编辑后的新正文进入实际Pi历史 | `B05-touch-mobile.json`；第二夹具`B12-final-fixed-layout-touch-edit.json`、`B13-final-edited-queue-consumed.json` |
| 真实FIFO与持久消费 | 两条steer在工具后各消费一次；三条queue按1→2→3执行，移除项不在Pi历史 | 第二夹具`B08-FIFO-consumed.json`、`pi-carriers-FIFO.json`；真实custom carrier逐ID/正文/entry核对，非同文案推断 |
| 实际超时失败 | 故意等待的工具达到TASK_TIME_LIMIT：未确认steer保留unknown，未投递项paused；刷新没有模型重放 | `B06-timeout-pause.json`及`B06-timeout-pause-verified-state.json`；首份误查`/api/snapshot`不作状态依据，后一份用正式`/api/state`核实 |
| 独立停止、取消与刷新 | 原生触控停止当前任务；未投递queue立即暂停；释放夹具工具边界后实际cancelled，steer结果未知不可撤回；刷新请求数不增 | 第二夹具`B10-final-layout-touch-cancel-request.json`、`B11-cancel-pause-reload.json`、`pi-carriers-final.json` |
| 最终样式/构建 | 390/761/1440px无水平溢出或投递控件裁切；运行按钮桌面≥40px/窄屏≥44px；回到最新不覆盖composer，最终40/44px；服务返回JS/CSS/index与本地dist哈希一致 | 第二夹具`B12-final-fixed-layout-touch-edit.json`、`B14-final-served-build.json`；最后只加回到最新min-height，功能源码不变 |

截图`final-v2-1440.png`/`final-v2-390.png`及最终`accepted-390.png`已实际打开核对，Glacier风格与右侧默认收起保留。较早桌面/触控及失败截图保留；实体触屏、屏幕阅读器实机与物理IME均NOT_RUN，组件IME负例不冒充实体输入法。

首次夹具为非TTY，stdin控制已关闭，不能释放人为等待；保留超时和取消路径，不声称其FIFO成功。停止并回收该自有夹具后，以同源码TTY夹具补齐成功FIFO/合作式取消。原任务取消不等于强行中止任意工具/远端计费；取消中保持真实状态，直到进程退出确认。无新增收费授权或替换Provider。

其他过程错误包括不支持的snapshot选项/根ref、脚本语法、native CSS与Ego选择器混用、焦点/滚动未就绪导致的等待超时；没有据此伪造产品PASS。窄屏42px按钮、嵌套滚动与悬浮遮挡在本轮修复后重新核对；已聚焦元素在resize后不自动滚动，触控前用原生滚轮定位并命中测试，不用DOM伪点击。

## 5. 回收、风险与后续

- 两个夹具分别5/13个**本地**模型请求、5/10个worker；所有进程组退出、pending input为0、会话租约及账号预留为0。关闭后由新HostInputStore重读草稿和队列；`fixture-cleanup-verified.json`再次核验进程及临时根不存在。
- 仅删除两个夹具自己创建的私有临时根，里面只有临时项目/账号/会话；运行证据、日志、截图、队列回执保留。用户项目/历史/配置及日常active未动。
- Ego空间29只finish一次，p1/p2关闭，无保留/用户未跟踪页面；`ego-finish.json`留证。
- 风险：队列编辑采用完整shard和input双revision，其他项变化也可能使编辑失效，这是防止覆盖的有意保守行为；不确定投递无跨进程无条件exactly-once保证，仍须只读核对，不自动重放。UI请求必须绑定当前任务配置，不能扩权或自动切模型。
- U1-05继续实现真实步骤/等待原因、失败/取消/断连/重启后的核对与显式恢复入口；U1-06复验G1-01至06完整旅程。当前只有G1-03/04及部分G1-05的C/P/B子集，不把完整G1改PASS。
- I/Full/日常安装和L真实Provider均NOT_RUN；新增收费场景NOT_AUTHORIZED。G2-00的发行闭包/Full仍阻断U2产品集成，历史FAIL/PARTIAL/OPEN_UNATTRIBUTED保留；不进入Electron。
