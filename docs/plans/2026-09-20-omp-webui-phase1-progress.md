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

### 1B 剩余，不得跳过

栈内独立扩展副本、按精确运行合同选择和证明补丁全集、vendor 工具、候选许可证/完整 SBOM、Full 栈实际构建与安装/回滚、旧栈真实字节验证。当前实现只打通候选身份和 Pi staging，不能称为 Full 栈升级完成。尚未修改旧 macOS native seed 构建路径或安装事务。

1C–1F、M1-T、M1-I 均为 NOT_RUN。真实模型预算使用 0/3，失败重试 0/1。

前端阶段依次应用 ui-ux-pro-max 的设计检索、frontend-design 的视觉计划与自评、frontend-ui-craft 的完整交互状态；实际 React 实现另遵循性能规则，使用 ego-browser 验证。当前尚未进行前端设计或开发。
