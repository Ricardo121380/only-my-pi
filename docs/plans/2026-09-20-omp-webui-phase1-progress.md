# 第一阶段实施记录

执行依据：[详细计划](2026-09-20-omp-webui-phase1-plan.md)及[P1 决策](2026-09-20-omp-webui-phase1-discussion.md)。本记录区分实施进度与阶段验收，不改变已确认范围。

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

没有切换日常安装，没有读取认证内容，没有发起真实模型任务。全部安装字节验真仍在 1F 切换前执行。

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

### 1C–1E 已实施，最终候选集成待验

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

M1-T / M1-I 仍为 NOT_RUN。下一步固定源码重新构建最终 Full，完成候选真实任务和日常晋升。真实模型预算使用 0/3，失败重试 0/1。
