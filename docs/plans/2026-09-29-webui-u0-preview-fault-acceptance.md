# U0-06 异常生命周期与可行性收口

日期：2026-09-29。**U0-06 / G0-05：PASS，限固定配方的技术可行性门禁。** 合并本轮故障证据与[实际浏览器复验](2026-09-29-webui-u0-preview-browser-acceptance.md)，U0现为5/6、总计13/44。U0-04未完成，U0总门禁仍不通过；不进入U1或Electron。

## 改动与结果

- `scripts/probes/webui-u0-preview-managed.mjs`：提取共用重启入口，先核对旧进程组消失，再检查私有路径确为socket后删除崩溃残留socket并重建；未知组不删除路径、不启动替代进程。新增显式 `--fault-matrix` 本地测试模式。
- `scripts/probes/webui-u0-preview-orphan.mjs`：只供本探针使用的合成残留夹具。leader退出、同组leaf保持本机HTTP端口；无项目路径或凭据，30秒上限自行退出。
- 未改生产Host、Vite worker、Pi worker、HTTP/WS转发规则、用户配置或日常安装。lean-coding用于把修改约束在该实验边界，没有引入依赖或全仓重构。

| 场景 | 实际断言 |
| --- | --- |
| Vite夹具组SIGKILL | 核实刚创建的PID身份，终止该组并确认消失；入口503；移除已确认安全的陈旧socket后重建，实际Pi修改为revision 2并可读取 |
| leader退出、同组leaf仍在 | leader身份为空、进程组仍活；重启抛`ORPHAN_GROUP_REQUIRES_RECONCILIATION`，没有新建替代进程；leaf身份不变且HTTP仍可访问，证明未盲杀 |
| 跨故障保锁 | 在创建故障leader前已持有生产project ownership；leader退出后与重启被拒后两次争用均返回`OWNERSHIP_HELD`，直到显式核对后才释放 |
| 显式核对后恢复 | 测试驱动以预先记录的leaf身份核对，仅向该PID发送TERM；整个组消失后释放测试guard，再重启并读取revision 2 |
| 恢复后认证边界 | 预览服务端重放Host API为401、WS为403；未收到Cookie/Authorization |
| 最终退出 | 全部child及其组退出、服务关闭、项目锁重新取得/释放；外层驱动记录主进程退出码0、无signal，耗时2272ms |

## 证据与复核

仓库外目录：`../artifacts/webui-optimization/U0/faults-0929-rFWaKo/`。

- `faults-1.json`：首轮11条局部检查；锁在leader退出后才建立，只能证明拒绝重启期间保锁，不作为跨故障连续性的最终依据。
- `faults-2.json`：修正后11条检查全部通过，`leaseHeldAcrossLeaderExit=true`；4次仅本机合成Provider请求。两轮合计8次本机请求，外部调用0。
- `driver-2.json`：顶层进程退出码、耗时、stdout/stderr，补齐仅凭内部报告不能证明主进程退出的缺口。
- 只读探子独立核验首轮后指出上述两项证据精度问题；主代理修改并复跑第二轮，未追派或复用子代理。

固定环境：macOS arm64，H候选Node24.19.0/Pi0.85.1，Vite8.3.0；HEAD仍为`4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`加现有工作树改动。本轮只跑受影响探针与静态检查，不重跑无改动的产品全量测试。

复现：使用H的`node/bin/node`运行`webui-u0-preview-managed.mjs <绝对stack路径> <新的绝对报告路径> --fault-matrix`。报告采用wx，不覆盖旧证据。

## PASS的精确边界

受支持方案为**可信本机入口剥离凭据＋私有Unix socket的固定Vite配方＋只向镜像同步的受控源文件集合**。本轮PoC只有3个合成源文件，不载入项目配置/env、插件、任意命令或用户依赖。源写入只在真实ownership下由Pi夹具工具触发；不是Git分支工作目录，也不是轮流预览或静态页面。

上轮浏览器凭据剥离、20次HMR、自动恢复证据继续有效：worker和转发代码未改变，重启新增分支只处理已确认组消失后的陈旧socket；本轮不是新浏览器测试，也未新建空间。原始局部报告保持PARTIAL，由本文件逐项汇总C/P/B后给出PoC门禁PASS，历史泄漏失败证据永久保留。

不把上述结果扩大为产品交付：这是协作式本机边界，不是恶意同UID代码沙箱；ownership竞争仍是同进程二次取得，不是第二个独立Agent生命周期；测试guard由驱动持有，不是已实现的生产预览占用账本。未知残留须人工/显式核对，未承诺自动识别全部孤儿后代。U5必须实现并再验真实supervisor、资源记录/恢复、项目适配及UI，U6另做安装态与用户旅程。只有原先确定的U0可行性门禁在此关闭。

下一步：U0-04剩余解析容量、断网运行与Full打包闭包；不得借本项PASS跳过解析门禁。
