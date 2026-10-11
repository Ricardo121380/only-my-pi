# PI110-N09 / #70：真实 codemode 工具组合验收

规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)，US-099、100、104–108、GP110-06；任务：[#70](https://github.com/Ricardo121380/only-my-pi/issues/70)。前置 #66 已 CLOSED。本票先完成 C/P/B 和双轴评审，再关闭回读，随后实施 #71；分类与生图保持禁用，留给 #72/#73。

## 基线与身份

批次基点 `cf30fca4424799dfb05be41e106216bcb4ac0dba`，分支 `codex/webui-phase1`，开始索引为空，302 个既有修改/未跟踪文件已保存 hash。只重叠 TaskControl.tsx，提交只含本票增量，原有改动继续留在工作树。其余原有文件逐一核对。

最新全量通过记录是 `pi110-http-oauth-1010-221428/batch-final-full-node24`：Node 24.19.0，1678 项、1672 PASS、0 FAIL、0 CANCELLED、6 SKIPPED。对应 Web 12 文件 96/96、四组类型检查以及 Node 22 MCP 35/35；该记录的非文档源码身份已经与批次开始源码核对。旧全量通过只建立起点，不能替代本票回归。本批唯一一次全量在 #71 完成后运行，本票关闭时全量回归为 PENDING。

绝对证据位置是本机材料，不冒充公开下载包：

```text
LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-codemode-discovery-1011
```

源码候选实际加载仓库 Pi SDK / pi-codemode / pi-mcp **1.1.0**、quickjs-wasi **3.6.2**，分别运行 Node 24.19.0 与 22.19.0。受控 fixture 复制真实依赖后加载 Pi 公开 createCodemodeExtension 和真实 QuickJS-NG，没有模拟执行器。Node 24 所在的日常 stack 的 Pi 仍为 **0.85.1**，本批不切换它；Node 路径不代表 Pi 版本。P/B 的合成账号只连接回环模型协议服务；MCP 是受控的真实 stdio 进程，独立记录实际接收。使用实际安装 permission-modes 扩展的受控副本验证策略衔接，不改变用户安装或配置。

## C：授权、执行和恢复合同

- 父脚本不授予子调用权限。普通子工具与 MCP 子工具分别走实际 Pi tool_call 策略；安装版 permission-modes 只把 OMP 已接管的 ask 分支委派给 OMP，显式 deny 仍生效。审批保留子工具、参数、canonical 目标及父子 ID。目标 inode/版本变化后旧许可失效。MCP 沿用现有工具、凭据、配置 epoch、Coding、项目 owner 与物理服务准入。
- 注册、active 和 direct/deferred/codemode/hidden 分开处理。deferred/codemode 可按已准入策略在脚本内调用，模型直接声明只含 direct；hidden 和 inactive 不被发现，手写名称也不能执行。模型分类和生成 namespace 完全不注入。
- 主脚本每次最多 60 秒、每任务最多 16 脚本 / 32 子调用、同时最多 4 子调用。源代码 32 KiB、子参数 16 KiB、子结果和返回输出各 64 KiB。脚本选项只能收紧，不能提高边界。真实 QuickJS 的 VM 上限 256 MiB、store 上限 1 MiB，当前分支 codemode-store 条目 payload 累计上限 8 MiB。
- 原生输出具有 16,777,216 字符 / 100,000 项的内部上限。每次脚本使用私有临时目录，payload 上限依原生字符上限折合 64 MiB；原生截断文件不返回给模型，超限判失败，退出清理目录。这是 VM / payload 边界，不声称 OS RSS 或文件系统块配额。MCP 回执目录固定在运行时根，避免随脚本临时目录清理。
- 异常、嵌套失败、超大输出、内存超限、store 超限、死等待、未等待 Promise、取消和撤权均保留已发生调用的实际结果。脚本结束后拒绝再发起子调用；不自动撤销或重放已发生的副作用。MCP UNKNOWN 仍投影 UNKNOWN，不以外层结束推断应用结果。
- 原生 store/load 与真实会话记录、所选历史叶节点对应。只在完整成功且输出符合边界时提交新的 store entry；失败/取消不提交。公开 Host resume 与原生 SessionAdmissions.create(sourceFile, leafId) 的实际 at-entry 分支均实测；来源会话字节不改。权限与任务预算始终只存在于当前运行内，恢复和新任务重新审批。
- 产品保留实际父子关联、状态、耗时、部分结果和错误。外层捕获 MCP 拒绝并成功时，子调用仍显示失败；取消在策略审批期间实际返回拒绝的子调用按事件显示失败，父脚本显示取消，不合成成功或统一覆盖状态。

## P：公开 Host / CLI 与真实原生链路

`70-final-native-node24` **31 项，29 PASS、0 FAIL、0 CANCELLED、2 SKIPPED**。13 项本票原生验收全部通过；其余是 CLI launcher 与公开 Host SDK 兼容回归，两项既有可选 scout/writer 安装用例条件跳过。`70-final-native-node22` **13/13 PASS**，包括实际 CLI TUI、真实 60 秒 deadline、32/33 子调用边界、16/17 脚本边界、store/history/branch 和嵌套写入。

真实服务接收账本核对：批准后 1 次 MCP 接收；拒绝、hidden、未等待调用和取消路径 0 次。实际普通 write 与 descriptor MCP write 依次请求独立许可，文件字节、FD 3、服务接收/效果、单写者冲突和物理启动拒绝均核对。未等待 Promise 的返回和撤权不产生后续新接收；晚到审批返回冲突，重启不恢复许可。

四组类型检查 `70-final-ui-check` PASS；Web `70-final-web` **13 文件 97/97 PASS**；`70-final-ui-build`、`70-final-lint`、`70-final-pack` PASS，打包清单 1598 文件。打包包含新增 codemode 模块；这不是完整候选安装验收。

失败收据全部保留。早期失败涉及原生被冻结的输出 globals、hidden 配置字段、deferred 模型声明、临时目录误删 MCP 回执、CLI allowlist、SDK symlink 规范化和审批菜单未就绪。实际错误经公开用例修复后复验。`70-host-mcp-regression` 整条为 96 PASS / 6 CANCELLED / 2 SKIPPED，不能写成全绿；六项 SDK 兼容用例在 canonical 入口修复后分别通过，最终也纳入上述 31 项组合。Node 22 首轮的冷启动等待和菜单时序失败仍保留；最终没有放宽业务接收、权限或结果断言。

## B：Ego Lite

全批使用同一 TaskSpace **45** / p1。`70-browser-verified-*` 绑定最新源码、实际 Web 构建和 Node 24 / Pi 1.1.0。普通 read 与 MCP read 在页面分别批准，父工具与两个子工具展开后显示稳定 ID、耗时和实际读取结果。拒绝 MCP 后保留普通读取和部分输出，子调用显示 MCP_CALL_DENIED；取消待审批链后父脚本取消，没有 MCP 新接收。

`70-browser-verified-runtime.json` 保存三个实际任务、MCP durable runs、独立接收和源码 hash，接收次数 **1 / 0 / 0**。Host 真正重启后重新配对，原任务及父子状态保留，待审批数为 0。390 CSS 像素下核对 ID 换行及根页面宽度 390，结果 pre 保留横向滚动。`70-browser-verified-nested.png`、`70-browser-verified-mobile.png` 已实际查看。第一次 B 记录也完整保留，不能覆盖其输入或运行身份。

浏览器控制脚本的选择器拼写、API 参数以及过早截屏错误保留在运行日志中。恢复使用同一 TaskSpace，只按当前 DOM 接续未完成动作；实际接收账本证明没有重复业务调用。

## 独立评审与关闭

首轮固定范围 `cf30fca...4e3e8a1`：Standards PASS（撤权 ACK 等待重复的非阻断 P3）；Spec FAIL（完整多字节 store 的 P2）。独立报告 `70-standards-first.md` / `70-spec-first.md` 保留。真实公开 Host 复现两项 RED：跨脚本累计超限和原生历史超限恢复，见 `70-red-complete-store`。修复在恢复入口和提交 set/delete 后检查完整有效状态的 UTF-8 字节，保留原生状态所有权；替换/删除按原生语义计算。Node 24 `70-green-complete-store` 的两项边界及原有真实 resume/branch 用例 **3/3 PASS**，四组类型检查 `70-store-typecheck` PASS。Node 22 复验及 B 差量独立留证。

修复后 Node 22 `70-store-final-node22` **3/3 PASS**。同一 Ego Lite TaskSpace 的 `70-browser-storage-state.png` 展示两个真实脚本：首个 completed，累计超限的第二个 failed / CODEMODE_STORAGE_LIMIT；MCP 接收 0 次。截图已查看，实际任务和新源码 hash 保存于 `70-browser-storage-runtime.json`，与原先 1/0/0 B 的输入身份分别保留。

最终固定范围 `cf30fca...3d2102f`（21 个提交路径）已由两位新的独立只读探子复评：**Standards PASS / Spec PASS**。硬规则违规与阻断发现为 0，Spec 确认首轮 P2 实质消除。Standards 保留上述非阻断 P3，不引入范围外重构。报告 `70-standards-final.md` / `70-spec-final.md`，提交版本和原有工作树差量分别核对。实现提交 `4e3e8a1`，存储修复 `3d2102f`；原始失败记录保留。GitHub 评论与关闭回读另留证据，本地提交没有推送。

必需 C / P / B：PASS，限定上述实际 macOS 受控协议链路。批次全量：PENDING。I 完整候选安装、L 外部真实 Provider、远程 CI、发行、部署、日常安装切换：NOT_RUN。总规格 #19 与分类/生图后续票继续开放。
