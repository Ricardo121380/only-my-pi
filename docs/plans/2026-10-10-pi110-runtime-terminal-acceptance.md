# Pi 1.1.0 运行与终端基线：#62 / #64

本记录只验收 [#62 / PI110-N01](https://github.com/Ricardo121380/only-my-pi/issues/62) 的 GP110-01 和 [#64 / PI110-N03](https://github.com/Ricardo121380/only-my-pi/issues/64) 的 GP110-03。按 #62 → #64 推进。[父规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19) 及[原工单映射](2026-10-10-pi-1.1.0-ticket-review.md) 保持不变；MCP/codemode、输入/历史、依赖材料、Full、日常安装和发行均不在本批关闭范围。

## 输入与归属

- 起始 HEAD：`8240603576088a688f2fc0bbd8c38950bd4245bc`；分支：`codex/webui-phase1`。
- 实际 SDK/worker：`@earendil-works/pi-coding-agent@1.1.0`。升级 package/lock 与大量 Host/WebUI/材料改动已经存在于起始工作树，未作为本批提交。
- 起始快照：1,605 个源文件/材料身份、232 条工作树改动；`baseline.json`、原 index/worktree patch 和所有原 dirty 文件副本均保留。
- 证据根目录：`LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-runtime-terminal-1010-051133`。
- 每个 `*.json` 命令收据包含命令、确切 Node、起止时间、退出码、源码 HEAD、日志及其 SHA-256。最终本批 diff、文件摘要、工作树保留核验与双轴 review 同目录保存。
- C/P/B 针对当前源码工作树。测试用 `sha256:aaaa…` 是临时 source stack 的合同夹具标记，**不是**发行候选的内容摘要；I/L 为 NOT_RUN。临时 CLI 栈复制实际 Pi、Node、OMP 源码。普通自动测试夹具化外部包边界；`OMP_PI110_INSTALLED_EXTENSIONS=1` 的单独验收复制已核验用户包并仅在临时副本应用已有 permission shell adapter。未复制用户凭据、切换安装或修改真实包。

## #62：GP110-01

| 条件 | 实际证据 | 技术结论 |
| --- | --- | --- |
| 固定 Pi、账号、模型与工具 | 公开 Host → 真实 RpcWorker/SDK → loopback Provider；同 Provider 的 A/B 账号及 CLI 默认身份分别读取真实临时文件。Provider 验证确切 key/model；只读请求仅有 read/grep/find/ls | PASS C/P |
| 所有生产会话关闭保温 | account RPC、account child、direct TUI/RPC、持久 print/main、native ephemeral main 均安装同一 public `cache_warming_decision` stop 策略；SDK 工厂最后安装。原 Pi settings 未被改写 | PASS C/P |
| 保温触发有效 | 固定 TTL=11 秒，外部测试扩展明确请求 warm；初始红例 Provider 实收 2 次，修复后仅 1 次。覆盖持续 streaming 与保持进程存活后的 idle 条件 | PASS P |
| 拒绝身份回退 | 缺失/撤销 GUI 凭据、错误 Provider/model、撤销 CLI 凭据及未配对请求均无额外 Provider 接收。CLI 短期 catalog cache 可先返回 ACK；worker 实际复核凭据后失败 | PASS C/P |
| 成功、失败、取消与授权拒绝 | HTTP 读取成功；Provider 401 → `MODEL_REQUEST_FAILED`；coding approve 写入、deny/revoke 不写入、晚审批 `APPROVAL_EXPIRED`。取消 ACK=`cancelling`，后续 task=`cancelled` 与 Provider 连接关闭独立断言 | PASS C/P |
| 权限、单写及强制扩展 | 两种真实 PTY 模式均从 Inspect 开始；显式审批后才能写；`/new` 撤销授权，Escape 不会批准。真实外部扩展验收保留 permission Build 与审计扩展集。人工终端占用阻止 Host controlled task，释放后才成功 | PASS C/P/B |
| 支持 Node | 22.19.0 / 24.19.0 的运行回归及 types 全部通过；26.8.2 仅为单独有限开发证据 | PASS C/P（有限范围） |

源码：[保温策略](../../packages/direct-agent/cache-warming-policy.mjs)、[Host HTTP 验收](../../tests/host-pi110-runtime.test.mjs)、[公开 CLI 验收](../../tests/direct-pi110-cli.test.mjs)。旧账号与 SDK probe 改用 pi-ai 的公开 package export，去除不再存在的嵌套 node_modules 路径；原批准/拒绝/撤销断言保留。

## #64：GP110-03

| 条件 | 实际证据 | 技术结论 |
| --- | --- | --- |
| fullscreen 默认 / regular 显式选项 | 原始 Pi settings 保存 regular，公开 OMP 默认仍产生 alternate-screen enter/leave；显式 regular 使用 main screen，原设置不改写 | PASS C/P |
| 非法选项拒绝 | 非法值、缺值、inline assignment 与重复/矛盾 `--tui-mode` 明确拒绝；无 renderer、无模型请求 | PASS C/P |
| PTY 输入、输出、resize 与键盘 | 从真实 bin/omp.mjs 经 execve 到 Pi；输入 prompt 到达 Provider；resize 后 renderer 随 132×42 更新；Enter 审批、Escape 拒绝和取消均真实操作 | PASS P |
| 正常与异常恢复 | Ctrl+D 返回同一个 shell；renderer 启动后注入 `run()` rejection，OMP 停止 renderer 并执行受控 runtime teardown，exit=1。两类退出均对比同一 PTY 的前后 stty；检查 alternate-screen leave 与 bracketed-paste disable | PASS P |
| 审批绑定项目/生命周期 | 两种模式都必须先审批；`/new` 后 write 不可用，原文件不变；晚 HTTP 回答拒绝，无 UI/headless 原拒绝回归保留 | PASS C/P |
| Ego Lite / Glacier / 重连 | TaskSpace 40，真实页面启动终端并运行 Pi 1.1.0；fullscreen/regular 各一个键盘 prompt。刷新后原 terminalId 不变，inputSeq 从 37 延续到 58；Glacier 页面保留。终端正常确认清理后 closed/error=null，Host controlled task 再次成功 | PASS B/P |
| 单写接收计数 | 终端占用时 task ACK=202/starting，实际 failed=`OWNERSHIP_HELD`、responses=0；最终 Provider 合计 3 次：fullscreen、regular、终端释放后的 Host 各一次，占用期间任务为 0 次 | PASS C/P/B |
| 平台与 CLI 范围 | macOS arm64，Node 22/24；既有 launcher、terminal HTTP、真实 shell/supervisor、所有权和受控 task 回归通过。Linux CLI 保留未验，未声明 Linux Pi 1.1.0 PTY/GUI 已通过 | macOS PASS；Linux NOT_RUN |

源码：[终端模式与启动](../../packages/direct-agent/tui-runtime.mjs)、[失败退出处理](../../packages/direct-agent/tui-entry.mjs)、[PTY 验收](../../tests/direct-pi110-terminal.test.mjs)、[Ego source fixture](../../tests/fixtures/pi110-browser.mjs)。异常负例仅改临时 SDK 副本以注入 rejection，renderer、OMP/admission/teardown 保持真实；正常模式验收未改 SDK。

## 命令与结果

以下文件位于证据根目录；以 JSON 收据的完整命令和日志为准。

| 检查 | Node | 结果与收据 |
| --- | --- | --- |
| 受影响运行 8 文件 | 22.19.0 / 24.19.0 | 59 PASS，2 skip（完整候选 writer/scout 专用）；`runtime-node22/24.json` |
| 终端/所有权/launcher 9 文件 | 22.19.0 / 24.19.0 | 77 PASS，0 skip；`terminal-node22/24.json` |
| 旧 SDK/account probe + 新 CLI/PTY | 22.19.0 / 24.19.0 | 18 PASS；`legacy-runtime-node22/24.json` |
| 真实外部包 CLI | 24.19.0 | 5 PASS；`cli-pi110-installed-node24-bounded.json` |
| 真实外部包 PTY | 24.19.0 | 7 PASS；`terminal-installed-node24.json` |
| 全部四套 tsc | 22.19.0 / 24.19.0 | exit=0；`typecheck-node22/24-final.json` |
| 新 HTTP/CLI/PTY 开发验证 | 26.8.2 | 18 PASS；`runtime-node26-relocated.json`；不替代双 Node |
| 仓库 lint / 本批语法与 diff | 24.19.0 | exit=0；`lint-node24-final.json`、`static-final.json` |
| 剩余基线失败独立复现 | 24.19.0 | 1 PASS / 5 FAIL，exit=1；`remaining-baseline-node24.json` |
| WebUI tests / build | 24.19.0 | 92 PASS / exit=0；`test-web-node24.json`、`build-web-node24.json` |
| 批次全套 `npm test` | 24.19.0 | 1,563 PASS / 11 FAIL / 5 skip，exit=1；`full-suite-node24.json`。其中 6 个旧 SDK 路径失败已修复并在双 Node 定向复核 |

全套结果不记 PASS。其余 5 个失败由未变更的既有内容产生：`tests/host-input-rpc.test.mjs` 是起始时已存在的 untracked 输入批次工作，4 个用例仍断言 Pi `0.85.1`；docs-links 检查拒绝三个既有计划中的四条仓库外 artifacts 链接（包括本次要求读取的原工单映射）。这些文件逐字保留，不并入本批提交，不以本批证据关闭 GP110-02 或更改材料/规格记录。

失败日志同时保留：有效保温红例、默认模式红例、renderer rejection 红例、矛盾模式红例；早期夹具缺 scripts、stdin 未 EOF、Node 26 relocation 缺 libnode dylib 与浏览器脚本等待/断言错误不作为产品行为红例。最后的浏览器实际状态、3 次 Provider 接收与停止结果见 `browser-fixture-node24.json` 和对应 log。source fixture 中缺 offline fd / 未安装 OMP live generation 的警告保留；不代表完整发行或 G6 性能验收。

## Review 与交付

- Standards：**PASS**。硬性违规 0；两个非阻断 Duplicated Code 建议分别涉及测试轮询形状和重复的 PTY 前后 stty 断言。根代理复核出处，保留各夹具的不同超时/诊断及逐场景恢复断言，不为启发式建议扩展本批重构。
- Spec：**#62 / GP110-01 PASS C/P；#64 / GP110-03 PASS C/P/B**，限当前 macOS arm64 源码工作树。无缺失、扩围或偏离需求的阻断项。
- 双轴独立探子按 `8240603576088a688f2fc0bbd8c38950bd4245bc...23d911c7e0090d7f1848434b2d8c607a44897b50` 的固定本批 tree 评审；该临时 commit object 不改变当前分支。报告见 `review-standards.txt`、`review-spec.txt`、`review-verdicts.json`。最终仅更新本验收文案，代码与测试摘要未变，根代理执行最终静态/归属核验。
- 根代理确认两票各自必需条件已满足。仅提交本批 diff 到当前分支，不 push；提交后先回填/关闭 #62，再核对原生前置并回填/关闭 #64。实际提交号及远程回读收据另存证据目录。#19 正文、评论及原映射不改动。
- 当前阶段结论限于 GP110-01/03 的 C/P/B。I、L、Linux、新增能力整合、日常晋升与 release 均未由本批证明。
