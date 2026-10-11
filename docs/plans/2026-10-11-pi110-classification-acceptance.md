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

保存只改变后续任务；每次任务开始固定账号、模型定义摘要、预算、项目版本及撤权版本。聊天账号/模型与分类绑定分离。停用即时阻断新分类请求；修改项目选择不会把正在运行任务切到新账号。脚本无法改变绑定或扩额。

`packages/model-calls/` 收拢目录/账号解析、持久账本和原生请求适配。控制点是 Pi codemode 实际使用的 ModelRegistry，覆盖普通 `tool_call` 之外的 `models.classify`；生命周期使用公开 `agent_start`，包括 WebUI 保存草稿后 `sendCustomMessage(triggerTurn)` 的真实路径。image namespace 保持禁用，交给 #73。

当前开放三个单次 HTTP 分类协议：`typesafe-system-one`、`openai-decisions`、`cloudflare-workers-ai-system-one`，均核对原生 adapter 的真实请求/回执。其他分类协议显示不支持；例如需要多次模型 HTTP 调用的协议尚不能可靠对应一个请求预占，不能静默开放。账号配置中的分类定义保存为专用 `classifiers.json`，经 Pi 公开注册接口加载；不把 Pi 只创建 chat 模型的 `models.json` 当成分类目录。

发出前检查当前账号凭据、任务许可、固定模型摘要、协议目标与输入预算。传入原生 SDK 的环境为空且 API key 来自明确账号；无账号/环境兜底。请求重试数固定为 0，拒绝重定向和不匹配目标；发送时再次核对凭据/绑定，并在线性化的账本写入后发出。

## 预占、用量与恢复

- 每个实际请求具有稳定 UUID、父 codemode toolCallId、任务/会话/项目、账号/模型、输入摘要、价格快照与来源。实际 HTTP 请求携带同一 `x-omp-model-request-id`，可与服务接收记录一一核对。
- 发出前原子预占次数、并发及完整的单次输入/输出字节额度；同一任务所有父脚本共享。次数和字节预占保守保留，不按响应大小退款。成功或明确失败释放并发；未知结果保留并发、次数及字节，并阻断该任务继续派发，即使剩余并发大于零。
- 这些原生协议无法承诺可靠的单次货币硬上限，因此配置/许可/结果均明示费用上限未知。每个任务首次调用前须选择“本任务，按其他额度运行”，默认拒绝；headless CLI 无交互许可时不发请求。保存项目配置不是任务授权。
- Provider 报告 token、价格快照、SDK 估算和未知覆盖分别记录。缺少用量时为 `unknown` / `null`，不能记成零；估算不是账单或货币硬上限。分类用量仅记请求账本，父脚本不再重复累计。
- Pi 原生解析器要求模型具备 cost 结构；未知价格仅在内部解析时使用零占位，公开账本/页面保持价格和费用未知，原生返回的零估算不作为真实价格或用量公开。
- 断连、超时、取消、超限截断、worker 被杀及 Host 重启保留稳定请求和原占额；不自动重试、返还或恢复授权。账本核对按钮/CLI status 只读。未知结果使 Host 任务失败并触发现有队列暂停；提示用户按请求编号核对 Provider 结果。
- 损坏账本、非法额度、重复 ID、模型摘要不匹配等拒绝读取/执行，不清空或重建额度。孤儿 owner 的已发出请求按 unknown 呈现，持久发出标记继续保留。此批没有自动对账释放额度或供应商账单导入功能。

## C / P / B 证据

| 层次 | 当前结果 | 证据与范围 |
|---|---|---|
| C | PASS | 公共配置 CAS、固定选择、共享预占、零接收拒绝、损坏 fail-closed、稳定 ID、未知阻断及 UI 合同；与真实 Pi 集成测试一起执行，未以 helper-only 代替产品行为 |
| P / Node 24.19.0 | PASS，23/23 | `36-final-p24.log`，`final-p24/*.json`；真实 CLI/TUI/Host + 三个原生分类协议 + 已安装扩展副本；exit 0 |
| P / Node 22.19.0 | PASS，7/7 | `37-final-p22.log`，`final-p22/*.json`；合法调用、CLI/TUI、并发/丢回执/真实 WebUI 投递及未知继续阻断的兼容切片；exit 0 |
| B / Ego Lite | PASS | 单一 TaskSpace 46 / p1；`final-b/` 页面快照、PNG、实际接收数组及重启/最终 receipt；下表列出各旅程 |
| 类型检查 | PASS | `38-final-typecheck.log`，exit 0 |
| 最终全量回归、工程检查 | PENDING | 独立评审后在支持的 Node 24 上执行；不复用上一批 1707 PASS |
| Standards | PENDING | 固定起点独立评审；和 Spec 分列 |
| Spec | PENDING | #72 全部 AC 与 #19 分类切片独立核对 |

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

截图通过图像查看核对。浏览器中的动作均从实际页面完成；测试脚本只切换本机协议服务返回和重启隔离 Host。没有把 API 调用当作页面点击证据。

## 命令、输入身份与失败保留

最终 P 命令以对应 Node 的绝对路径执行（`N24` / `N22` 指下面二进制）；环境变量仅选择本机受控夹具，不含生产凭据：

```sh
OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1 OMP_CLASSIFIER_EVIDENCE_DIR="$E/final-p24" "$N24" --test --test-concurrency=1 tests/host-classification.test.mjs tests/classification-cli-tui.test.mjs
OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1 OMP_CLASSIFIER_EVIDENCE_DIR="$E/final-p22" "$N22" --test --test-concurrency=1 --test-name-pattern='public configuration|public CLI|real Pi TUI|concurrent classifier|lost response|WebUI saved|unknown result' tests/host-classification.test.mjs tests/classification-cli-tui.test.mjs
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

## 收尾

待最终独立评审、回归、仅本票提交以及 GitHub 回填回读。#19 保持 OPEN，#73/#74 本批不开始。
