# CLIENT-02A / #80：共享产品设置验收记录

2026-10-22（Asia/Shanghai），本地实施与验收记录。开工 `main = e714c89a68c03e3fa42031aa5c1d0590f5cc60ab`，与 origin/main 相同；暂存区和工作树干净。独立分支 `codex/feat/shared-product-settings`，未合入私有恢复分支。#78、#79 为 CLOSED / completed，#89 已合并，PR 两项必需检查成功；开工 main run 39733201211 仍在运行，不能代本票 CI。

本记录尚在收敛：合同、真实 Pi、PTY、撤权、FIFO 与加载失败均取得通过证据；实际 Ego B、Linux 受影响回归和独立 Standards/Spec 仍待最终回读。未全部通过前不将六条 AC 标为完成。使用入口见 [共享设置指南](../shared-product-settings.md)。

## 运行组合和范围

Node 24.19.0，精确 Pi 1.3.0，manifest/lock 不升级 Pi。2026-10-22 npm latest 为 1.4.0；本轮保留一个 minor 的版本差距，来源为 [npm registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest)。源码、锁文件、真实 Pi SDK、受控服务输入和命令回执保存在本轮私有证据根的 baseline、source manifest、逐段日志及行为 JSON。证据只针对源码组合、本机 macOS arm64、真实 Pi 与 loopback 服务，不声明日常安装、Full、外部真实 Provider、付费调用、公开发行或新增 Linux 全能力。

真实可选资源使用仓库已有 `context-doctor@0.1.0`，扩展和 metrics 入口均绑定字节摘要。本轮声明有界 `label`，由真实 Pi 的 `context_snapshot` 及 TUI 状态实际消费。Markdown 技能使用明确本地来源、兼容声明和摘要副本，Pi 公共加载器与原技能展开路径执行；测试样本明确是受控技能材料。原 Pi/外部文件字节保持；导入、启用、认证和执行许可分别处理。

## 六条 AC

| AC | 本轮实现与证据 | 当前结论 |
| --- | --- | --- |
| 1 最小 CLI/GUI 完整链路 | `omp settings`、产品工具与技能对话框、声明参数、默认/覆盖/重置、实际加载回执；独立 CLI 和 Host→Pi 诊断返回准确标签；实际技能展开进入独立模型接收端 | C/P PASS；B 待收敛 |
| 2 单一权威、来源与显式导入 | OMP 工具/技能存储复用 config-runtime；MCP 与模型保留各自原权威，任务版本组合不复制配置；导入预览来源/前后差异，摘要 CAS、停用副本且原件不变 | C/P PASS；B 待收敛 |
| 3 真进程 CAS、隔离、负例与失败 | 两个实际 CLI 同 revision 写入只有一个成功，另一方明确冲突；A/B 及重置；必需集合、未知资源、无 Schema、非法参数与不兼容拒绝；真实 Pi 语法加载失败、技能摘要变化不发模型请求并保留最后加载回执 | C/P PASS；B 待收敛 |
| 4 活动快照、旧队列与即时阻断 | 真实 Pi 当前任务保持旧标签，旧 FIFO 暂停且接收数不增加；明确编辑绑定后再 resume 才执行；停用再启用不复活旧快照；同一 TUI 下一逻辑任务才加载新值；agent_settled 及崩溃恢复回归 | C/P PASS；B 待收敛 |
| 5 实际两端修改/回读/运行 | 真实 CLI/Pi→公共 Host 与 GUI 对应入口，工具与技能消费有独立接收证据；完整资源目录和全部通用旅程仍属 #50–#52/#56 | P PASS；B 待收敛 |
| 6 C/P/B、精确身份、评审与受影响回归 | 本轮新增六项测试 PASS，82 项早期受影响合同 PASS；分类旧固定 0 草稿假设已修复并定向通过；两项真实 SIGKILL 恢复 PASS；WebUI 40 PASS、类型和构建 PASS。最终同源检查、Linux 和独立双轴评审待收敛 | PARTIAL |

## 保留的 RED 与修复依据

- 正式 `omp settings list` 原先被当成 Agent 输入并报 `OMP_CONTROLLED_STACK_UNAVAILABLE`。先保存该公开入口 RED，再增加独立设置入口。
- 真实 Pi 注册诊断工具后被原权限扩展拒绝为 `tool blocked`。适配只准入 OMP 已选择的无 I/O 诊断工具；上游显式 deny 和工具调用检查继续生效。
- `pi-input-bridge` 将 resourceRevision 写死为 0，导致显式重新绑定后的队列仍拒绝。桥接层现核对任务固定版本；没有删除绑定断言。
- 无 UI 的技能调用需要按原权限模式处理，不能从启用推定授权；实际 PTY 单独证明技能展开。早期 PTY 就绪文字和清理观测错误保留，未提高原产品超时。
- 直接调用 session.reload 导致第三方用量组件持有失效 UI ctx。改为 Pi 公开命令上下文 reload，原 TUI 清理/重绑后同一进程的下一任务返回新参数；原崩溃回执保留。
- 分类草稿旧测试固定 resourceRevision=0，不再代表已配置模型的当前版本。改为从公开设置接口取得版本，保留绑定与消费断言。
- 首轮 Linux 发现通用 SDK bootstrap 夹具不装配 OMP 诊断工具及旧精确工具清单假设。产品设置只作用于已审核 OMP direct 装配；通用 SDK/子运行夹具保持其原语义，正式 CLI 的预期清单增加实际诊断工具。原 Linux FAIL 与完整日志保留，修复后重新验证。

远程推送、PR、合并和工单关闭尚未执行；本次授权为本地代码、文档、验证与提交。若后续进入合并，须刷新并遵守实际保护要求，不以本地结果或开工 main 的 CI 代替候选检查。
