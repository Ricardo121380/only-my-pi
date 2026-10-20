# PI110-N11 / #72 分类执行验收

日期：2026-10-11。规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)，交付：[#72](https://github.com/Ricardo121380/only-my-pi/issues/72)。本批范围为 US-109、111–118 的分类部分及 GP110-07 分类切片；#73/#74 的图片生成、产物保存和 GP110-07 整体仍待后续。

## 基线与边界

- 起点：`1ba85ac02f616bc025ad47d2cafcacc785c9674d`，分支 `codex/webui-phase1`。初始 302 个已有修改/未跟踪文件逐文件保存字节与 SHA-256；不回退既有工作。
- 实施前实时回读 #19/#72 正文、#70/#71 状态及原生 dependencies；#70/#71 为 CLOSED / completed，#72 唯一原生前置 #70 已满足。先提交 `18b6a7e` 同步总看板与映射，再实施分类。
- 证据根目录：`LOCAL_WORKSPACE/artifacts/issue-72-20261011`（下文 `E`）。`baseline-files.json`、`baseline-files/`、`baseline.diff`、`baseline-status.z`、工单正文和 `native-dependencies-*.json` 保存原始状态。
- 验收使用真实 Pi **1.1.0**、受控本机分类协议服务、合成账号和隔离配置目录；实际加载本机已有的 permission-modes、subagents、agent-extensions、lsp、usage 扩展副本。每份 P/B receipt 保存解析版本、integrity、物理来源摘要。
- 候选身份是 `LOCAL_CONTROLLED_SOURCE_HARNESS`。测试栈标识用于夹具隔离，不是可晋升发行候选。没有替换日常 Pi 0.85.1 安装，没有调用真实收费模型。I / Full、L / 外部 Provider、Linux、远程 CI、发布和日常晋升均 **NOT_RUN**。

## 产品与运行合同

分类账号、模型和额度独立保存在项目配置。CLI `omp classifier list ACCOUNT --project /absolute/project` 查看目录，`apply /absolute/config.json --project /absolute/project` 使用 revision 做 CAS 保存，`status --project /absolute/project` 读取账本。TUI `/omp-classifier` 提供选择、预算编辑、停用和只读账本；也支持 `list`、`apply`、`status`。WebUI 项目“分类模型”面板使用同一合同。

配置文件示例（账号和模型必须来自该账号的当前分类目录）：

```json
{
  "revision": 0,
  "classifier": {
    "accountId": "explicit-account-id",
    "model": "provider/classifier-id",
    "budget": {
      "requests": 4,
      "concurrency": 1,
      "maxInputBytes": 8192,
      "maxOutputBytes": 8192,
      "inputBytes": 32768,
      "outputBytes": 32768,
      "timeoutMs": 10000
    }
  }
}
```

保存只改变后续任务；每次任务开始固定账号、模型定义摘要、预算、项目版本及撤权版本。聊天账号/模型与分类绑定分离。停用即时阻断新分类请求；修改项目选择不会把正在运行任务切到新账号。脚本无法改变绑定或扩额。Host 同时占用聊天和独立分类账号，活动期间登出、删除、替换凭据返回 `ACCOUNT_BUSY`；沿既有 worker 终止确认路径释放，未确认终止继续占用。

`packages/model-calls/` 收拢目录/账号解析、持久账本和原生请求适配。控制点是 Pi codemode 实际使用的 ModelRegistry，覆盖普通 `tool_call` 之外的 `models.classify`；生命周期使用公开 `agent_start`，包括 WebUI 保存草稿后 `sendCustomMessage(triggerTurn)` 的真实路径。image namespace 保持禁用，交给 #73。

当前开放三个单次 HTTP 分类协议：`typesafe-system-one`、`openai-decisions`、`cloudflare-workers-ai-system-one`，均核对原生 adapter 的真实请求/回执。其他分类协议显示不支持；例如需要多次模型 HTTP 调用的协议尚不能可靠对应一个请求预占，不能静默开放。账号配置中的分类定义保存为专用 `classifiers.json`，经 Pi 公开注册接口加载；不把 Pi 只创建 chat 模型的 `models.json` 当成分类目录。

发出前检查当前账号凭据、任务许可、固定模型摘要、协议目标与输入预算。传入原生 SDK 的环境为空且 API key 来自明确账号；无账号/环境兜底。请求重试数固定为 0，拒绝重定向和不匹配目标；发送时再次核对凭据/绑定，并在线性化的账本写入后发出。

## 预占、用量与恢复

- 每个实际请求具有稳定 UUID、父 codemode toolCallId、任务/会话/项目、账号/模型、输入摘要、价格快照与来源。实际 HTTP 请求携带同一 `x-omp-model-request-id`，可与服务接收记录一一核对。
- 发出前原子预占次数、并发及完整的单次输入/输出字节额度；同一任务所有父脚本共享。次数和字节预占保守保留，不按响应大小退款。成功或明确失败释放并发；未知结果保留并发、次数及字节，并阻断该任务继续派发，即使剩余并发大于零。
- 这些原生协议无法承诺可靠的单次货币硬上限，因此配置/许可/结果均明示费用上限未知。每个任务首次调用前须选择“本任务，按其他额度运行”，默认拒绝；headless CLI 无交互许可时不发请求。保存项目配置不是任务授权。
- Provider 报告 token、价格快照、SDK 估算和未知覆盖分别记录。缺少用量时为 `unknown` / `null`，不能记成零；部分回报按字段保留 `coverage`，页面显示已知输入与未知输出，缺字段不补零。估算不是账单或货币硬上限。脚本通过 `accounting{requestId,usage,priceSnapshot}` 取得同一账本事实，不再暴露会被原生父 codemode 自动求和的 `result.usage`。
- Pi 原生解析器要求模型具备 cost 结构；未知价格仅在内部解析时使用零占位，公开账本/页面保持价格和费用未知，原生返回的零估算不作为真实价格或用量公开。
- 断连、超时、取消、超限截断、worker 被杀及 Host 重启保留稳定请求和原占额；不自动重试、返还或恢复授权。账本核对按钮/CLI status 只读。未知结果使 Host 任务失败并触发现有队列暂停；提示用户按请求编号核对 Provider 结果。
- 损坏账本、非法额度、重复 ID、模型摘要不匹配等拒绝读取/执行，不清空或重建额度。孤儿 owner 的已发出请求按 unknown 呈现，持久发出标记继续保留。此批没有自动对账释放额度或供应商账单导入功能。

## C / P / B 证据

| 层次 | 当前结果 | 证据与范围 |
|---|---|---|
| C | PASS | 公共配置 CAS、固定选择、共享预占、零接收拒绝、损坏 fail-closed、稳定 ID、未知阻断及 UI 合同；与真实 Pi 集成测试一起执行，未以 helper-only 代替产品行为 |
| P / Node 24.19.0 | PASS（26 个场景，分轮证据） | `52-p24-final` 为 25 PASS / 1 FAIL；账号释放观察竞态修正后 `54-p24-account-final` 为 1/1 PASS。其余 25 场景的运行时代码未改；保留失败轮，不声称单轮 26/26。`post-review-p24/` 与 `post-review-p24-fixed/` 保存真实 CLI/TUI/Host、三个分类协议及已安装扩展副本回执 |
| P / Node 22.19.0 | PASS，10/10 | `55-p22-final.log` / `post-review-p22/`；公开配置、CLI/TUI、账号占用、完整/部分有价用量、并发、未知结果/重启和草稿投递 |
| B / Ego Lite | PASS，明确源码范围 | 单一 TaskSpace 46 / p1；`final-b/` 页面快照、PNG、实际接收数组及重启/最终 receipt；源码为 `e77586e` 对应工作树，评审后变更影响见下文 |
| 类型检查 / WebUI / 构建 | PASS | `41-review-typecheck.log`、`42-web-final.log`（103/103）、`44-web-build-final.log`，exit 0 |
| 最终全量回归 | PASS，1733 PASS / 0 FAIL / 0 CANCELLED / 6 SKIP | `51-node-full-final`，共 1739 项，exit 0；对应 `f969108` 工作树。随后仅加强账号测试等待并定向补验，运行时源码未改；首轮 `45-node-full` 的 1 FAIL 保留 |
| 工程检查 | PASS | pack `48`；收尾 lint `56`、secret scan `57`、文档链接 `58/59`，均 exit 0；扫描首轮 `47` 失败保留 |
| Standards | PASS，已确认问题关闭 | 独立核验发现分类账号占用遗漏及 LOW 配置文案冲突，修复后分别复核；1 条非阻断标题前缀维护建议保留 |
| Spec | PASS，已确认问题关闭 | 独立评审发现有价模型部分 token 被 SDK 补零及父工具重复累计；真实协议 RED 后修复，独立增量复核 PASS |

P 覆盖：明确选择、独立聊天账号、当前/下一任务绑定、脚本换模型拒绝、无许可/撤权/缺凭据/输入超限零接收、两个并发及多个父脚本竞争一次额度、缺用量、429 无 retry、超时、输出超限、取消、断连、真实 worker SIGKILL、Host 重启、损坏账本、原生 CustomMessage 草稿投递。TUI 真实 PTY 展示许可与 positive 结果，正常退出；CLI 配置与账本走公开命令。

| Ego Lite 页面旅程 | 服务累计接收数 | 可见结果 |
|---|---:|---|
| 配置与任务授权 | 0 → 1 | 项目明确保存；任务等待时 0；许可后 positive，输入 12 / 输出 3，费用未知和价格来源 |
| 拒绝任务许可 | 1 | 本任务 0 次请求 |
| 同一脚本两次并发 | 2 | 只新增 1 次，另一请求预算拒绝 |
| 缺失 Provider 用量 | 3 | 结果可见，用量/费用未知，不显示零 |
| 等待许可时停用项目分类 | 3 | 撤权后 0 新请求 |
| 发出后服务断连 | 4 | unknown，1/1 并发占用，8192 字节输入/输出预占；任务失败/队列暂停 |
| Host 实际重启、重新配对、打开任务、核对账本 | 4 | 请求 `64beb2b5-bf50-4383-bf42-1d3bbfb1ecc1` 与全部占额不变；无恢复许可/重发 |
| 390px 窄屏 | 4 | 页面宽度与 scrollWidth 均 390；无横向溢出，授权数 0 |

截图通过图像查看核对。浏览器中的动作均从实际页面完成；测试脚本只切换本机协议服务返回和重启隔离 Host。没有把 API 调用当作页面点击证据。TaskSpace 46 已 finish，受控服务正常退出。

B 的快照在评审修正前取得，不改标为最终源码重跑。后续改动为分类账号加入已有 busy 生命周期、部分用量/父脚本记账修正及相应文案；已测 B 旅程的未知价格、完整 token、完全缺用量、撤权、断线/重启分支保持原语义。受影响的账号入口和有价完整/部分用量通过真实 Pi 公共入口补验，新增部分用量渲染通过 WebUI 合同验证；最终协议回执绑定修正后的源码。保留 `pre-review-source.json`、`full-source-b89.json` 与逐命令源码快照，便于核对该差异，不声称新页面条件已有浏览器截图。

## 命令、输入身份与失败保留

最终 P 命令以对应 Node 的绝对路径执行（`N24` / `N22` 指下面二进制）；环境变量仅选择本机受控夹具，不含生产凭据：

```sh
OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1 OMP_CLASSIFIER_EVIDENCE_DIR="$E/post-review-p24" "$N24" --test --test-concurrency=1 tests/host-classification.test.mjs tests/classification-cli-tui.test.mjs
OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1 OMP_CLASSIFIER_EVIDENCE_DIR="$E/post-review-p24-fixed" "$N24" --test --test-concurrency=1 --test-name-pattern='active task protects' tests/host-classification.test.mjs
OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1 OMP_CLASSIFIER_EVIDENCE_DIR="$E/post-review-p22" "$N22" --test --test-concurrency=1 --test-name-pattern='public configuration|public CLI|real Pi TUI|concurrent classifier|lost response|WebUI saved|unknown result|active task protects|priced classifier' tests/host-classification.test.mjs tests/classification-cli-tui.test.mjs
npm run typecheck
npm run build:web
```

- Node 24.19.0：`$HOME/.local/share/only-my-pi/stacks/7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0/node/bin/node`，SHA-256 `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`。
- Node 22.19.0：`LOCAL_WORKSPACE/artifacts/only-my-pi-artifacts/multichannel-2026-09-12/node22/node-v22.19.0-darwin-arm64/bin/node`，SHA-256 `0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1`。
- Pi SDK 文件 SHA-256 `5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30`；完整来源与被测源码摘要保存在逐夹具 receipt，最终工作树冻结另存 `final-source.json`。
- `01`–`38` 日志保留全部阶段结果。早期暴露了原生目录全为 chat、账号注册缺失、QuickJS 异步模型选择、缺价格解析、canonical JSON 摘要、PTY 时机等实际问题；后续分别修复，不把 RED 删除或记 PASS。
- `26-browser-seam-red.log` 复现实际 WebUI CustomMessage 绕过旧生命周期钩子及未知请求仍可占剩余并发；`27` 修复验证。`32-unknown-task-red.log` 复现 Host 把未知结果结束为 succeeded；`33` 验证任务失败并暂停。`34` 验证另外两个原生协议。
- `28-web-regression.log` 的一项旧“分类禁用”文案断言失败已更新为本票新行为，最终 Web 回归单独记录。`30-adjacent-regression.log` 在开发机 Node 26 出现 5 项 MCP 启动 ENOENT；同一现状支持的 Node 24 下相关 codemode 9/9 通过（`31`），不把 Node 26 失败抹去或泛化为 Node 24 PASS。
- 浏览器阶段保留配对/等待及隐藏导航选择器的失败过程；先读取当前状态再调整，没有盲目重复提交分类。最终接收数和账本可交叉核对。
- `39-review-red.log` 复现独立账号未保护及有价回执覆盖缺口（3 FAIL）；修正及调整原生输出解析后 `43` 为 4/4 PASS。`review-rounds.md` 保留独立评审全部原始结论摘要，包括工具语法错误导致的 PARTIAL；缺口随后拆成小范围独立核验，没有将中止记录记 PASS。
- 首轮全量 `45-node-full` 为 1739 项、1732 PASS / 1 FAIL / 0 CANCELLED / 6 SKIP，exit 1。既有 MCP TUI 第二次审批仅等持久 `awaiting_approval` 就发键，未等实际菜单渲染，导致 `second TUI response` 超时；失败清理未关闭 Host，最终保存账本并结束本轮 fixture 子进程。`45-mcp-tui-stall-runs.json` 显示第二请求仍待审批，未伪称请求成功。测试补充终端新输出中实际目标与菜单、第二任务停止的等待，并确保失败清理；不修改产品许可、不弱化断言。局部 `49-tui-race-fixed` PASS，完整第二轮另存 `51`。
- `51` 的 6 项 SKIP 分别是生产 SDK scout/writer 入口两项、真实 Pi 输入的 Host SIGKILL 两项、安装态 Host/PTY 一项及 Pi 0.85.1 历史续接一项；它们本轮未运行，不能从全量 exit 0 推导这些额外门禁 PASS。#72 自己的真实 worker 终止、Host 重启和 CLI/TUI/P/B 场景有独立执行回执。
- `47-secret-scan` 命中文档本机用户名路径及 6 个长合成 Bearer 字面量（无真实凭据）。文档使用环境相对表示，测试账号改为短合成值；扫描器不修改，`50` PASS。实际二进制绝对路径和测试输入保留在本机命令 receipt 中。
- `52-p24-final` 为 26 项、25 PASS / 1 FAIL，账号测试在任务名义终态后立即登出，偶发早于 worker 终止确认而收到 `ACCOUNT_BUSY`；同源码单项重现轮 `53` PASS，不能据此抹去 `52`。测试改为在有限等待内通过公开只读 `status` 确认账号可用，再执行登出，保留运行期间三种修改一律拒绝的断言。修正后 `54` 为 1/1 PASS，Node 22 `55` 为 10/10 PASS。与全量 `51` 的 826 个冻结输入比较，仅 `tests/host-classification.test.mjs` 改动，未改产品释放逻辑。

## 收尾

必需 C/P/B、Standards/Spec 及回归已经完成。`preservation-final.json` 复核初始 302 个文件：297 个字节不变，5 个重叠文件在隔离副本中仅反向应用本票提交差异后逐字还原。仅本票内容提交，未 push。GitHub #72 的 7 条 AC 已勾选，[完成评论](https://github.com/Ricardo121380/only-my-pi/issues/72#issuecomment-6106938447)已逐字回读；2026-10-11 08:02:52Z 关闭并回读 `CLOSED / COMPLETED`，正文、评论、关闭状态分别保存在 `issue-72-*-readback.json`。总看板与工单映射同步到 #72 完成、下一批 #73/#74；#19 保持 OPEN，#73/#74 本批不开始。
