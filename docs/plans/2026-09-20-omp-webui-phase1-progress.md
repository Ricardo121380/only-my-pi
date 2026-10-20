# 第一阶段实施记录

执行依据：[详细计划](2026-09-20-omp-webui-phase1-plan.md)及[P1 决策](2026-09-20-omp-webui-phase1-discussion.md)。本记录区分实施进度与阶段验收，不改变已确认范围。

**最终状态（2026-09-20）：M1-T PASS，M1-I PASS。** 日常安装停留在已验证的 Pi 0.85.1 / Node 24.19.0 候选；下文保留各批次历史、失败尝试和最终证据，不将早期结果冒充最终结果。

## 1A 基线收口

- 原分支 `codex/preview-two-bilingual-readmes`，原 HEAD `573ea9e1b844c27e19bbb4561ca902523a54bd23`；原暂存区为空。
- 在原目录建立 `codex/webui-phase1`，保留既有 28 个 tracked 文件修改与全部未跟踪规划、合同和测试。
- 两个 Terra 单轮子代理分别只读核验安全执行链与状态合同；主代理复核并完成修复和测试。
- 新修复：补齐 `DirectWriterState.patch`；运行时与 Schema 拒绝无补丁身份/引用的已应用或应用结果未知状态；补充合同测试及有效的原子发布测试 fixture。
- 新回归在修复前 2 项失败，修复后通过；Schema/运行时一致性增加 1 项测试。
- 源码清单与 SHA-256 保存于仓库外 `artifacts/webui-phase1/baseline-precommit.json`（相对项目工作目录，不进入发行包）。这是合同修复后的提交前快照；修改前摘要另保留于本次执行工具记录。

### 已执行检查

| 检查 | 结果 | 限制 |
| --- | --- | --- |
| direct-agent / 授权 / writer / gates / composer / run-management 定向测试 | Node 26.8.2：111 项 PASS | 不作为指定运行时最终证据 |
| 同组测试＋Schema 一致性＋文档链接 | Node 24.19.0：114 项 PASS | 模拟模型，不是 GUI 或真实模型验收 |
| 类型检查（含 safety） | PASS | 前端尚未引入 |
| lint、schema:check、pack:check、agents:check | PASS | 新增 JS 另经 node --check |
| secret:scan、git diff --check | PASS | 不读取用户凭据 |

### 安装基线

只读复核：OMP `0.3.0-preview.1`、Pi `0.84.3`、Node `24.19.0`。current 为 `0e928b0cbf7d1afebc8af8e1e90fc2be1047247a44b4e67d72be8e9e2d5f3ba1`，LKG 为 `25a6d923d374e8862b0bcd0edadd1d9e47c173cef3e2388dd4b6b61a93c166b3`。事务元数据为 5 COMMITTED、29 ROLLED_BACK，无非终态。

在 1A 时点尚未切换日常安装、读取认证内容或发起真实模型任务；完整安装字节验真已在后续 1F 切换前执行。

## 后续状态

1A 本地基线提交为 `fa8e5d1`，无远端推送。

### 1B 已实施的第一批

- 开发依赖与 lock 固定 Pi `0.85.1`，通过 `npm install --ignore-scripts --no-audit --no-fund` 安装；日常 Full 栈未切换。
- `PI_RUNTIME_CONTRACTS` 同时保留旧 `0.84.3` 与候选 `0.85.1` 的精确 SRI，历史默认不变；Schema 同步拒绝交叉版本完整性。
- staging / payload assembly 显式传递候选身份；构建计划绑定版本，审查后换版本会被拒绝。入口支持 `--pi-version 0.85.1`，省略仍构建旧默认。
- `installPi` 从精确 tarball 构造新树，校验实际 package manifest，拒绝用旧包冒充候选；依赖脚本禁用。
- 候选位于仓库外 `artifacts/webui-phase1/pi-candidate-szHUkw/resolved/pi`。下载 tarball 为 6,986,356 bytes，SHA-256 `1f498729649bdce647d1160993b4d92bf3c614cc819213bee2f91dd34f2a7af4`，SRI `sha512-FGRN+OHbWaefBPGaTggAdLjrIHW+s2PzLyglz/5dfLzb9of7uuXMXYC0fJIeZTw+shS32o2cuQ9jF7YSDuL/oQ==`。
- 在空环境、隔离 HOME 和 Node `24.19.0` 下运行候选 `dist/bundle/cli.js --version`，输出 `0.85.1`。
- 开发 SDK 的 `ModelRuntime`、`createAgentSessionServices`、`runRpcMode` 均能导入为函数；这不是实际账号隔离或 RPC 行为验收。
- 升级后安全与构建相关定向回归 130 项通过；随后加入 staging 防伪回归，分发/版本合同组 31 项通过；产品/CI/文档合同 21 项通过。各组存在重叠，不相加当作独立测试总数。
- 类型、Schema 检查通过；无需启动浏览器或模型。

### 1B Full 候选与隔离事务

- 本地提交 `7c12cd9`、`ae1cf46`、`ebfa64e`、`0248a58` 完成合同、私有扩展、许可证与 Full 布局。
- 基础 Full 位于仓库外 `artifacts/webui-phase1/full-0248a58/payloads/full`，stackId `sha256:a80d4879ca889152a969c990ce1a30090cbdfbc748705f366fad1f085553cbb8`。
- 内嵌 Node 24.19.0 / Pi 0.85.1；12 个受控扩展实际加载无错误；两项源码绑定补丁、vendor 工具、ledger、许可证和完整运行时 SBOM 均通过。
- `isolated-install-Uzicex/rehearsal.json`：真实隔离安装 → 回滚 → 同候选重新应用 PASS；实际 RPC get_state / abort PASS，零模型调用。
- 私有栈不切换用户外部 npm 包或覆写设置；单元事务验证回滚保留安装后合法配置变化。
- 此基础候选尚不含后续 Host/UI，不能用它替代最终 M1 候选。

### 1C–1E 实施与开发态验证

- Host：loopback 动态端口、一次性配对、严格 Origin/Host、认证 WebSocket、类型化命令、幂等任务、恢复中断状态、进程回收、只读目录/文件/diff/回执。
- Pi 实际 JSONL worker 加载受控扩展；普通 RPC 不开放审批。文件和 Git 过滤器安全测试通过。
- 1D：真实 Pi RPC + 确定性模型 + 真实 write 工具验证批准、撤权、迟到批准、取消及普通 RPC 拒写。没有生产 HTTP 测试开关。
- 账号探针使用公开 ModelRuntime：同 Provider 独立文件存储与实际模拟请求、并发 OAuth 刷新、凭据已存但同步失败；账号切换前旧进程退出。仅模拟凭据，不证明所有真实 Provider 的互操作性。
- 项目规范路径/别名竞争、会话锁、崩溃和 PID 身份不明拒绝抢占通过；全入口 writer 所有权集成仍是 M2。
- React/TypeScript/Vite 中文三栏工作台已实现；7 项组件/事件测试通过；主 Host 测试 19 项（含真实 SDK 探针）。新增文件纳入打包和类型/语法检查。
- `ui-ux-pro-max` 两次布局查询不匹配，未照搬；设计与状态合同见[设计文档](2026-09-20-omp-webui-design.md)。采用 frontend-design、frontend-ui-craft 和 React 性能规则。K3 无可用路由，按既定备用方案由当前 Codex 完成。
- egolite 验证 10,000 条历史按 50 条分页、5MiB 工具结果按 64KiB 读取、文件/diff/缺失回执、刷新重连与取消；1440px / 390px 截图、窄屏无横向溢出、reduced-motion。
- 实测输入事件到下一帧 P95 29ms（30 个键盘输入）；20 次模拟 worker 的取消 HTTP 确认 P95 15.2ms。真实模型耗时和进程退出单独记录，不能用这些数字代替。
- 前端实际 bundle 的依赖清单、许可证正文纳入发行物和 SBOM；stager 在打包前显式重建 Web，避免忽略目录里的旧资产被当新源码产物。
- npm audit 报告既有 fast-uri 的 URL 规范化高危公告。Host 网络地址校验使用 Node URL，不用该库执行网络请求；AJV 用于本地 Schema。未自动升级既有发布锁定依赖，此限制随交付记录。

## 最终候选与验收检查点

- 运行源码提交：`ac5761e0e32620921431d7dd417b45dd62627c78`（此前功能提交 `57a21f5`）。后续仅验收文档提交不改变候选来源。
- 最终 Full：项目工作目录外层的 `artifacts/webui-phase1/full-final-v1/payloads/full`。
- stackId：`sha256:b17ce477747f87d908c03228e80d45dd0cc49f58910dfd726e5137153c354539`。
- 归档 `omp-phase1-ac5761e-full.tar.gz`：115,465,257 bytes，SHA-256 `598e6d573aff9ee624090d035c640b3dd5bf26f321e4f6985cf51800db6d7925`。
- 最终 Node 24.19.0 聚合门禁 `final-gates/deterministic.json`：清洁源码、194 项相关 Node 回归、7 项前端测试、类型、构建、lint、Schema、打包、agents、秘密扫描与 diff 全部 PASS。
- Node 22.19.0 同组门禁在功能提交前通过；最后两项修正是子进程 Node 参数隔离、SBOM 保留已有校验字段，最终候选再经实际集成验证。
- `isolated-install-KjjWXm/rehearsal.json`：最终候选实际安装、真实 get_state/abort、回滚、同候选重新应用 PASS。
- 最终安装包包含 54 个实际前端依赖的许可证；与后端重叠依赖保留原始完整性校验，不覆盖 ledger 证据。
- 两项旧测试在并发回归下暴露 `setImmediate` 时序假设，改成等待实际 writer/reviewer 派发事件；原预算和权限断言不变。

### 真实任务与失败记录（已收敛）

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| L1 初次只读分析 | FAIL：OpenCode Go 路由返回 401 CreditsError / Insufficient balance | 临时项目会话；错误已脱敏 |
| L1 预算内失败重试 | PASS：既有 Kimi For Coding 路由读取代码并准确定位加法实现错误，项目无改动 | `live-L1.json`、`ui-live-L1.png` |
| L2 流式与运行中取消 | 流式已观察到 3 次 partial 更新；取消 **未通过**，观测后额外检查导致任务先完成 | `live-L2-initial.json`，保留真实 succeeded 状态，不伪记 cancelled |
| L2 用户额外授权补测 | PASS：首个 partial 触发页面取消按钮，约 100.3ms 后后端 cancelled，对应 worker 已退出，部分输出保留 | `live-L2-extra.json`、`ui-live-cancel.png` |
| L3 安装态 CLI 修改/检查 | PASS：PATH 中真实 omp TUI，审批 simple / calc.mjs 后仅修改该文件；模型运行测试及嵌入 Node 独立复跑均 1 pass / 0 fail；正常退出 | `live-L3.json`、`live-L3.typescript` |

用户明确回复“允许”后，才执行额外 1 个小型取消任务。最终使用原定 3/3 个真实任务、1/1 次失败重试，以及额外授权的 1/1 个取消补测任务。没有充值、新增服务或继续发起模型任务。真实成功路径为既有 Kimi For Coding；OpenCode Go 的余额问题保留为外部服务限制。

M1-T 为 **PASS**，M1-I 为 **PASS**。权威汇总在仓库外 `artifacts/webui-phase1/M1-T.json` 与 `M1-I.json`。

### 日常晋升结果

- `promotion.json` 最终为 `PASS`，完整记录升级、回滚和重新应用，不以预检代替安装结果。
- 升级前 active 为 `0e928b0c…d5f3ba1`，Pi 0.84.3 / Node 24.19.0；切换前完整 Node/Pi/外部包/OMP 字节验真 PASS，无未完成事务。
- 首次升级事务 `e4216fff-2336-4746-9b35-a651ae092841`：PATH 版本、安装态配对、静态 Web 资产和 PATH `omp web status` PASS。
- 明确回滚到上述升级前 active，恢复真实 Pi 0.84.3 身份；没有误用更早 LKG。
- 同候选重新应用事务 `a6c62663-2303-4b3e-8b45-09b1cd1d1157`：最终 active 为 `b17ce477…c354539`，Pi 0.85.1 / Node 24.19.0，源码 `ac5761e`。
- 最终 CLI 任务之后再次验真安装内容 PASS，无未完成事务。只读 rollback plan 的目标仍是本次升级前 active。
- PATH 中 `omp` 为用户本地 shim，raw `pi` 为独立 Homebrew；已记录后者真实路径与字节摘要。
- 原 Homebrew Pi 字节未改变；原外部包目录 inode 与完整树摘要均保持；整个晋升事务的用户设置摘要保持。正常模型执行产生的新历史不被回滚覆盖。
- 仓库外 `promote-final.mjs` 使用受支持 Full 栈事务，位于回滚删除范围之外；仅在 M1-T PASS 后 apply，没有强停用户 Pi。
- 最终 egolite 从安装态 Host 查看了 L3 历史和实际单行 diff，`installed-web.json` PASS，截图 `ui-installed.png`。浏览器任务空间已正常释放。
- CLI、候选/安装态 Host、模拟验收 Host 均已停止；最终 `omp web status` 为 `HOST_NOT_RUNNING`。用户可自行运行 `omp web` 启动。
- L3 TUI 和其完整子进程树 RSS 快照记录在 `L3-process-memory.json`，为一次快照而非峰值；不将它当作 Chromium 总内存。

### 第二阶段接缝及保留限制

- 普通 WebUI 仍只读；GUI 编程审批、账号管理、文件保存、人工终端和旧会话续接不提前开放。
- 项目 writer 所有权已验证进程协议，CLI/GUI/人工终端所有写入入口的统一接入留给 M2。
- 同 Provider 账号隔离与 OAuth 刷新为模拟凭据探针；真实互操作仅声明已跑过的 Kimi For Coding。
- 前端性能数值来自本机固定样本，不是跨设备 SLA；未宣称屏幕阅读器认证或跨平台桌面验收。
- 既有 fast-uri 公告与 OpenCode Go 额度问题未被隐藏，也未借本任务擅自升级锁定依赖或充值。
- 使用与诊断见[工作台指南](../webui.md)。源码与文档均仅本地提交，没有推送或发布。
