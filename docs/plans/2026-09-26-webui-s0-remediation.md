# S0 安全与可靠性修复记录

状态：S0-01–08 全部已验收，当前 8/8。最终 H 候选的自动化、安装态和获授权的 Ego 页面补验均 PASS；专用 Host/PTY 与浏览器空间已收尾。不进入 U0、不切日常 active、不调用收费模型。

## 基线与隔离

- 基线源码 `4ba9ee4`，分支 `codex/webui-phase1`；既有规划文档和用户 Glacier 审计追加保留。源码基线已 APFS 克隆保留，未回滚工作树。
- macOS arm64，支持 Node 22.19.0 / 24.19.0；默认 Node 26.8.2 不替代支持矩阵。日常 Pi 0.85.1、Node 24.19.0；日常栈保持不变。
- 本机证据目录：工作区 `artifacts/webui-optimization/S0/run-iQNCkO/`（下称证据根；仓库外，不作为可移植 Markdown 链接）。子进程空 HOME、环境白名单，不转交真实供应商凭据。验证使用离线 npm；Full 构建和缓存准备下载固定锁定的公开依赖，不能称为全程断网构建。私有配对数据只在任务专用 0600 文件中使用，不纳入公开回执。
- 第一轮 OS sandbox 阻止 `/bin/ps`，导致身份检查失败；停止该测试进程并保留失败证据，没有放宽产品身份检查。
- 第二轮基线：1340 tests / 1317 pass / 20 fail / 3 skip。12 个 TUI 失败来自临时目录位于用户目录内，触发 SDK 祖先技能目录信任；3 个模拟 release gate 失败来自隔离 npm cache 不满足安全路径合同。运行器改用系统临时目录与隔离 HOME/.npm，不修改产品信任或环境防护。
- 其余基线失败：ready 空 JSON 及其子进程夹具 2 项、包内容 allowlist 2 项、文档链接 1 项；属于 S0 范围。首个新增路径负例已先失败，保留 `path-negative-before.log`。

## 冻结检查清单

1. 支持 Node 22/24 的完整 `node --test`；失败与 skip 逐项说明。
2. 既有 typecheck、lint、schema/agents/分发检查，以及 release gates 中适用的离线确定性门禁；不执行 protected/live 或远端发布。
3. WebUI `test:web`、`build:web`，真实 npm pack allowlist 与 Markdown 引用检查。
4. 路径、危险 Git、生产联网请求、PTY 原子发布、认证失效/撤销/回收新增负例与受影响 Host/CLI/TUI 回归。
5. 同一候选真实 Pi + 本地模型、Ego 关键旧功能旅程、隔离 Full 安装→回滚→再应用；不修改日常 active。

## Task 看板

| Task | 当前状态 | 证据/剩余工作 |
| --- | --- | --- |
| S0-01 基线 | 已验收 | 环境失败与真实缺陷分列；Node 22/24、旧发布门禁、候选身份及隔离边界已冻结 |
| S0-02 路径 | 已验收 | 策略与真实 Pi write/edit 对齐；`path-negative-before.log` 与新增回归；安装态路径逃逸被拒 |
| S0-03 Bash | 已验收 | 包装/全局参数/嵌套 shell/环境注入负例；真实 Pi 审批、撤权与正常 writer 通过 |
| S0-04 网络 | 已验收 | 三条已安装生产适配链的固定 DNS/重定向负例；`h-network-installed.log`，本地连接 6 次、8 类场景 |
| S0-05 PTY | 已验收 | 原子且不覆盖已有回执；真实 PTY、刷新重连、结束释放通过 |
| S0-06 认证 | 已验收 | 24h/撤销/容量回收；慢请求体撤权负例；Ego 过期 401、保留历史、重新配对通过 |
| S0-07 打包/CI | 已验收 | H 的 minimal/daily tarball、精确 allowlist/CI、Full 安装及源码一致性均通过；G 缺口已闭合 |
| S0-08 总验收 | 已验收 | H 的完整自动化/安装态及 Ego 空间10旧功能旅程通过；`h-browser-observations.json`、`h-closeout-status.json` |

## 修复实现与风险边界

### S0-02：路径解释一致

- [workspace.mjs](../../packages/direct-agent/workspace.mjs) 先按 Pi 0.85.1 的执行语义处理 Unicode 空格、一个前导 `@`、home 和 file URL，再检查规范化后的项目范围、父目录、链接、子模块及大小写不敏感的 `.git` 段。
- [direct-path-normalization.test.mjs](../evidence/2026-10-18-local-development-history.md#local-d56c06df314acfbf) 使用实际 Pi 写/编辑工具的可控写入适配，而非仅断言策略返回值；[host-controlled-rpc.test.mjs](../../tests/host-controlled-rpc.test.mjs) 对安装态实际 Pi 发出路径越界请求并证明未写入。
- 仍是当前项目、当前授权作用域下的工具边界，不宣称本机文件系统被 OS 沙箱隔离；未来 Pi 路径规则变化需重验。

### S0-03：已知危险 Git 写法

- 新增 [shell-policy.mjs](../evidence/2026-10-18-local-development-history.md#local-2c04d1cf7ff3d45f)，共享入口保留在 workspace；识别命令包装、Git 全局参数、环境变量、`env -S`、有限层数的 `sh -c`/`eval`，覆盖 reset/clean/checkout/restore/revert、未经授权 commit 和强推，以及 Git 配置/别名注入。
- 保留现有 coding grant、权限扩展和执行清理链。真实本地模型夹具的合法 writer、审批拒绝/撤销及 Git 包装负例在安装态分别验收。
- 此解析器不是完整 shell 解释器或任意命令隔离；人工终端继续遵守本机协作式边界，未全禁 Bash。

### S0-04：生产请求固定 DNS

- [pinned-fetch.mjs](../../packages/web-policy/pinned-fetch.mjs) 校验 DNS 的全部结果，并将结果固定到原生 HTTP/HTTPS 连接的 lookup；保留目标 hostname/SNI，不交给 global fetch 再解析一次。每跳重验，拒绝私网/保留地址，跨源去除敏感头并释放重定向响应体；明确拒绝自定义代理绕过。
- [runtime-patches.mjs](../../packages/distribution/runtime-patches.mjs) 对固定 `pi-web-access@0.25.0` 的 `ssrf-protection.ts`、`utils.ts` 和 `extract.ts` 三处分别做原始 SHA/唯一锚点检查；覆盖普通抓取、共享 API 请求和携带合成浏览器 cookie 的认证抓取。上游字节不匹配时构建失败，不能静默跳过。macOS 候选总计 6 个补丁（3 个已有权限补丁＋3 个网络补丁）。
- [web-runtime-probe.mjs](../evidence/2026-10-18-local-development-history.md#local-678d44f4f6bc811e) 加载实际安装文件，通过 Pi SDK 同位置别名及合成 cookie 适配验证生产函数；仅底层 socket 导向本地 HTTP 服务，真实浏览器 cookie 未读取，外部请求为 0。包括私网字面量/DNS、重绑定、私网重定向、合法公开重定向、body 释放和认证抓取。
- 证据是实际安装适配链与真实 Pi 加载/执行集成的组合，不把纯函数测试冒充外部 Provider 互操作。它不限制任意 Bash 或供应商 SDK 的全部网络；固定第三方 API 与远端抓取服务的内部网络行为不在本地传输保证内。

### S0-05：PTY 就绪发布

- [terminal-supervisor.mjs](../../packages/host/terminal-supervisor.mjs) 的 ready/clean 采用现有原子写工具的 exclusive 模式。[atomic-file.mjs](../../packages/config-runtime/atomic-file.mjs) 同目录临时文件写全、同步后以硬链接原子发布，不覆盖已有目标；其他调用继续原 rename 语义。
- [terminal-ready-publication.test.mjs](../evidence/2026-10-18-local-development-history.md#local-d9b4593ba2c05d2a) 在 AFTER_OPEN/BEFORE_RENAME 观察不到目标，发布后一次读到完整 0600 JSON；已有或竞争回执保留并报 EEXIST，临时物清理。
- 修正真实进程夹具先记录 zsh 身份后 exec 成 sleep 的观测竞态，以及 task-resume 夹具在停止任务前删除根目录的清理顺序；未放宽产品身份/锁检查。异常清理不明仍留锁。

### S0-06：认证与业务会话分离

- [server.mjs](../../packages/host/server.mjs)：认证 session 固定 24 小时，不滑动续期；最多 32 个同时存活会话；配对链接仍 120 秒单次使用。重复配对替换当前浏览器旧 cookie，过期/撤销回收容量。
- 同源、协议校验的 `POST /api/logout` 撤销当前身份，清 cookie；旧 HTTP 请求拒绝，WebSocket 以 4401 关闭，空闲连接每秒检查。接收完请求体后再次校验身份，防止接收慢 body 时被撤销/过期仍执行命令。
- [useHost.ts](../../webui/src/useHost.ts) 明确显示授权失效并停止自动重连，保留已显示历史；重新配对需新页面加载。既有已授权任务不被认证过期误停，账号和对话不被删除；认证恢复不等于恢复编程授权。
- [host-server.test.mjs](../../tests/host-server.test.mjs) 覆盖 40 次轮换、32 并存及回收、旧 HTTP/WS、非法来源、任务/账号保留，以及命令/账号两类接口慢 body 的撤销/轮换/过期矩阵。
- 按前端交互技能补齐失效态与回归，没有在 S0 重设计 Glacier；预览的跨端口凭据隔离仍由 U0/U5 单独验证。

### S0-07：真实包与显式门禁

- [pack-content-v1.json](../../verification/manifests/pack-content-v1.json) 精确纳入已捆绑的 node-pty/node-addon-api；不放开全部 node_modules，禁止项负例保留。
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) 独立执行 `test:web`、`build:web`；外部临时夹具分别注入失败，均退出 1，未加入 continue-on-error。
- 修正 11 处仓库外失效 Markdown 引用为便携文本说明，历史验收事实保留；安全扫描暴露的本机绝对路径改为工作区相对说明，合成凭据断言从已有变量生成，不放宽扫描器。
- 旧 Harness 安装门禁发现 `omp-control/index.ts` 顶层依赖 `project-gates`，但资源仅 eligible daily。[resources.lock.json](../../inventory/resources.lock.json) 将已存在的 project-gates 资源扩至与 omp-control 一致的七个 profile；没有启用额外默认工具或改 staging 算法。`harness-closure-before` 失败、`harness-closure-after` 全组通过，实际 tarball 自检必须复验。
- H 进一步将 daily 所需的 `packages/host/ownership.mjs` 及其 `packages/config-runtime` 闭包登记为 packaged 资源；没有打入整个 Host。静态核验覆盖 22 个相对导入文件，且真实 daily tarball 自检通过。回归在生成目录实际导入 `DirectSessionOwnership`，不再仅加载遗漏该依赖的轻量 runtime 入口。
- [rpc-worker.mjs](../../packages/host/rpc-worker.mjs) 在 spawn 边界复制 `invocation.env`，允许 Node 注入覆盖率变量；构造器仍返回冻结配置。覆盖率下真实 RPC 与 headless 所有权负例均通过。

## 候选、失败与复验台账

- 原工作树 HEAD 未移动。候选由独立本地 clone 冻结，只复制本批及已批准规划，不带入用户 Glacier 审计追加；不推送、不创建公开发布。
- D：源码 `a32f96e904bdce412e32aa586b8978540581d3d5`，stack `sha256:de1a5558796e411de8c4ede72b68652bae4ada22f4e9be1608731e262a348166`。Node 22/24 各 1352 项、1349 PASS、0 FAIL、3 条安装专用 skip；安装专用 16/16 随后实际通过。phase1 十项、隔离 Full 安装→回滚→再应用、Ego 旧旅程通过。D 不是最终交付候选，因为旧 Harness 门禁后来暴露资源闭包缺口。
- E：源码 `929d176e71e41df602e43cc12bcb0b820bc6b52a`，含闭包修复和网络测试加载器适配；最终结果以证据根 `e-*.json`/`e-*.log` 为准。
- 早期候选/并发验收失败均保留：补丁锚点不匹配、测试加载器 Pi/cookie 别名、过高并行负载触发启动/取消时限等。不把重跑隐藏成首次成功，不关闭真实权限检查。
- `d-v1.log` 的 fresh-tarball 自检失败经隔离诊断定位为扩展缺依赖（`e2e-diagnostic-pi.log`）；事务自动回滚。诊断只给空 HOME/合成 fixture 的 CLI 加观测，不进入产品。
- E 复验确认 test-e2e 的 0ms 失败是缓存仍指向另一轮 HOME，不符合既有安全路径合同；最终运行器将公开依赖缓存克隆进本轮 HOME/.npm，没有放宽 gate 的环境检查。
- 取消夹具 1 秒总时限包括真实 fsync 日志准备和收敛，在默认并行下再次超时。仅将夹具整体防挂死时限改为 10 秒，保留原模拟 20ms 取消宽限，并新增断言：stop 恰被调用一次、20ms 时钟确已触发、未证明退出时仍 orphaned、所有内部定时器释放。产品取消时限与性能目标未改。
- `host-controlled-tasks.test.mjs` 的根目录删除 hook 也先于 Host 停止；统一为先 stop 再删除本次临时根，防止异步持久化与删除竞争。定向 25/25 通过（`cleanup-cancel-fixed.*`）。
- F：源码 `e29062ce9f41f4d712a579f0271c98561be673bb`。相对 E 的产品代码与资源清单未再改变，测试夹具和修复记录同步冻结。`f-fresh-minimal.log` 已验证真实 scripts-disabled/offline tarball 安装、首次应用、幂等再次应用、Pi 0.84.1 无模型启动、doctor 和回滚全部 PASS；Full 产品另按 Pi 0.85.1 验证。Node 22/24、phase1 十项、16 项安装集成、生产网络适配和 Ego 旅程通过；旧 v1 默认并发 full-tests 出现账号预留用例失败，未豁免。
- 继续核验 `host-task-binding` 与 `host-task-metrics`：清理先删除根目录，随后 `HostTasks.stop()` 再持久化。外部 `fixture-cleanup-probe.mjs` 对同一组五个夹具实测，修复前四个目录在删除后重建、探针退出 1；合并为停止后删除并释放异常路径的模型/start/stop gate 后，五个均无残留、退出 0。探针证明清理缺陷，不将只有失败名称的 v1 摘要伪称完整错误栈。产品行为、权限断言和超时参数未改；后续候选必须重跑原门禁。

## 最终验收状态

- H：冻结源码 `cb27c6a9ede6cdb8bbedd155bf74e29e1198210a`。定向覆盖率 57 PASS/0 FAIL/2 安装态 skip；原 M8 全量 1349 PASS/0 FAIL/3 安装态 skip，行/分支/函数覆盖率 85.71%/73.17%/85.20%，原阈值不变。`h-fresh-daily.log` 证明真实 tarball daily 首次应用、幂等应用、Pi 0.84.1 无模型启动和回滚 PASS；doctor 如实为 CONTROLLED_STACK_REQUIRED，未冒充 Full 栈就绪。
- H 的 v1、subagents preview、M8、M9、public baseline、M11、M12 七个原 CLI 全部退出 0（`h-deterministic-results.json`）；仅本轮适用确定性项通过，受保护/收费证据保持原 NOT_RUN_BY_POLICY/HOLD/BLOCKED 状态。M11 外部 RC 平台项 Q10 为 NOT_RUN_PLATFORM；本轮隔离 Full 冒烟不冒充该项。未授权发布。

- G：源码 `7a58ecf69e4ca36b85bdf42b28a5d78d27526362`，Full 已安装；M8 原始覆盖率运行失败 16 项，其中 RPC 明确报冻结环境不能加入 `NODE_V8_COVERAGE`。启动边界复制环境对象，保留构造器不可变合同；headless 测试同类调用同步修正。不关闭覆盖率门禁。
- G 的 daily tarball 自检报 `packages/host/ownership.mjs` 缺失；新增 daily 资源及其 `config-runtime` 闭包。回归先在缺模块/冻结环境上失败（`h-regressions-before.log`），再验证补丁。S0-07 原 PASS 据此撤回，不以 minimal 或 Full 的通过代替 daily。
- BatchSwarm 取消夹具的 2 秒总防挂死时间包含覆盖率和 journal fsync，调整为 10 秒；真实执行 deadline 仍 500ms，orphaned、非权威终态和 journal 事件顺序断言不变。

### H 收口证据

| 检查 | 实际结果 | 证据根内文件 |
| --- | --- | --- |
| 冻结源码 / Full 栈 | `cb27c6a9ede6cdb8bbedd155bf74e29e1198210a` / `sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b` | `candidate-source-h.json`、`h-installed-identity.json` |
| Node 22.19.0 / 24.19.0 | 各 1352 项：1349 PASS、0 FAIL、3 安装专用 skip | `h-node22.*`、`h-node24.*` |
| 实际安装 Pi 0.85.1 / Host / PTY 集成 | 16 PASS、0 FAIL、0 skip；仅本地模型服务 | `h-installed-tests.*` |
| 安装生产网络链 | 3 条适配链、8 类场景 PASS；6 次本地连接、0 外部请求 | `h-network-installed.*` |
| Full 安装 / 回滚 / 再应用 | COMMITTED / PASS / COMMITTED；无模型推理请求 | `h-install.*` |
| phase1 十项 | 全 PASS；WebUI 25/25，含构建、类型、lint、Schema、包/Agent/秘密/diff 检查 | `h-phase1.*`、`h-gates/deterministic.json` |
| 主源码 / 安装内容一致性 | 1232 个源码文件、118 个安装运行时文件无差异；F/H 的92个前端资源相同 | `final-source-audit.json` |
| 最终 H 的 Ego 页面 | PASS：空间10完成任务/取消、PTY、编辑/diff、历史和认证恢复；已关闭 | `h-browser-observations.json`、`h-browser/*.png`、`h-browser-host.*` |
| 收尾文档与安全检查 | 文档链接2/2 PASS、秘密扫描0发现、diff检查PASS | `h-closed-doc-links.*`、`h-closed-secret.*` |

F 的 Ego 空间7在当时旅程结束后已关闭；用户明确授权新空间后，使用 Ego 空间10对最终 H 补验，没有替换浏览器。浏览器连接隔离安装 H 的生产 Host/UI/PTY；任务输出使用确定性 FixtureWorker，不将其冒充真实 Pi 或外部 Provider。实际 Pi 的证据独立为上表16项安装集成。源码未变，复用该候选已通过的全量自动化；收尾仅修改状态文档并补文档链接、秘密扫描和 diff 检查。

- 页面完成一个只读任务，并在另一个任务执行中点击取消，分别显示已完成/已取消；未调用真实模型。
- 真实 PTY 执行 `pwd`，刷新重连后输出保留；显式结束并清理后显示占用已释放。专用终端记录为 closed/exit 0，supervisor PID 65807 已退出。
- 手动编辑前显式取项目锁，保存 README 的验收标记并核对磁盘；退出恢复只读。差异区可读取保存标记及长文件第2999行。
- 10,000条历史可从第1页翻到第2页（第50条消息）；远程图片呈现阻止加载提示，无该外域资源请求或注入脚本。
- 仅推进夹具时钟超过24小时，页面显示授权失效，HTTP 401，已显示的历史保留。通过生产本机控制接口签发新配对并重新加载后 HTTP 200、已连接；账号、已完成/取消任务和历史仍可访问，执行模式保持只读。
- 截图已实际打开检查。空间10已 `finish({keep: []})`；本轮 Host PID 64914 正常退出0，endpoint已移除、锁目录为空。日志、截图和夹具保留，没有清理用户数据。定位器两次匹配到多个状态文本导致观察脚本失败，改为唯一定位/状态读取后核实结果；未据此改动产品或重复发送任务。

主工作树 HEAD 保持 `4ba9ee4`，用户 Glacier 审计追加仍为8行；仅隔离 clone 有候选提交。日常 active 仍为 `7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。未推送、发布、修改全局配置或切日常栈；日志/失败证据/候选均保留。

S0 总出口为 PASS，8项Task/8项门禁完成；全优化计划为8/44项Task。S0 验收范围不包含 U0–U6 新功能、收费 Provider、日常 active 晋升及 Electron。下一项 U0-01 尚未开始。
