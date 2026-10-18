# M2 资源与更新体积记录

> 本文保留测量当时的 M2 状态、预算与下一门禁，不代表当前状态；后续已完成项见 [M2 收口记录](2026-09-26-omp-webui-phase2-closeout.md)。下列证据为本机工作区的仓库外附件，通过[本地历史证据索引](../evidence/2026-10-18-local-development-history.md)记录原始路径、摘要和范围；原始附件不随仓交付。

日期：2026-09-26。结论：**当前 Full 候选的资源记录与更新包体积已补齐，状态 MEASURED；Full 字节校验、解包身份与 PTY 清理检查 PASS。M2 仍为 IN_PROGRESS。** 本项没有约定内存硬上限，不将采样成功写成跨设备性能达标；writer 真实 Host/页面成功终态和最终日常安装仍未完成。

## 版本与测量边界

- 产品源码 `9130d0259bb53a82f8af290c994dc31fbdd8e028`；栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`，与此前隔离安装一致。本轮新增验收脚本与文档，不改产品。
- macOS 27.0、arm64、16 GiB RAM；安装 Node 24.19.0 / Pi 0.85.1；Ego Lite 0.5.1.13。使用 `isolated-install-d8iuXc` 的 Host、UI 和 PTY 模块，隔离项目/config；GUI 账号为空，没有读取或复制真实凭据。
- 证据根：`../../../artifacts/webui-phase2/`。本次浏览器空间 4/p1 已结束，Host 76929 已退出，临时配对清单已删除，合成项目和证据保留。真实模型新增请求 **0**；累计额度仍为任务 **3/3**、重试 **5/5**。
- 运行夹具仍为 10,000 条历史、5 MiB 工具输出、3,000 行 diff。实际页面按页展示历史，工具输出首段 65,536 字符、diff 174,318 字符；没有一次渲染全部历史或 5 MiB 文本。

## Full 更新：传输体积与磁盘占用分开

按照 [ADR-0017](../decisions/ADR-0017-versioned-runtime-contracts-and-stack-promotion.md)，本机继续沿用 Full 栈事务切换，不迁移渠道。新增 [measure-stack-transfer.mjs](../../scripts/measure-stack-transfer.mjs) 直接复用 [正式归档函数](../../packages/release-stack/deterministic-archive.mjs)（gzip level 9、固定时间、`only-my-pi` 根目录），对既有候选重新生成压缩包；经 [生产下载校验函数](../../packages/release-stack/downloader.mjs) 读取本地流，再用 [安全解包器](../../packages/release-stack/safe-extract.mjs) 解包、[运行栈身份检查](../../packages/release-stack/release-builder.mjs) 比较组件摘要。

| 项目 | bytes | MiB | 解释 |
| --- | ---: | ---: | --- |
| M2 Full 压缩包 | 151,164,714 | 144.16 | 实际生成的整包字节数；本地流校验实际消费同样多的字节 |
| M1 Full 压缩包 | 115,465,257 | 110.12 | 对 ac5761e 用同一归档函数重打包，SHA 与既存 M1 归档完全一致 |
| M2 相对 M1 增长 | 35,699,457 | 34.05 | **+30.92%**；不是增量更新大小 |
| M2 Thin 压缩包 | 18,530,154 | 17.67 | 仅包体；后续运行时/依赖解析与私有栈重建未验收，不作为当前安装路线 |
| M2 Full 解包文件逻辑长度之和 | 519,799,860 | 495.72 | 安全解包器记录，共 37,548 个目录/文件/链接条目 |
| M2 Full 解包目录磁盘分配占用 | 616,062,976 | 587.52 | `du` 口径，含文件系统分配开销；与压缩包或逻辑长度不同 |

Full SHA-256：`3ca4340d715cda359d0aba6e81cb8a3c1b4b58b43c8dacc94dcd3f7b3b069d7b`。本机 [resources-sep26-transfer/transfer.json](../evidence/2026-10-18-local-development-history.md#local-214960c83968db77) 保存 Full/Thin 摘要、条目数、候选身份和 PASS 回执；[resources-sep26-transfer/baseline.json](../evidence/2026-10-18-local-development-history.md#local-c4a07a3d0d088181) 保存 M1 重打包与历史归档摘要对照。

当前没有差分下载实现：[payload-source.mjs](../../packages/release-stack/payload-source.mjs) 的远端 prepare 每次请求完整资产，本地 prepare 从明确 bundle 读取。**使用已有本地 Full 候选切换时，新增网络下载为 0；若传输此候选整包，文件响应正文为 151,164,714 bytes。** 本轮没有发布 release index、没有伪造受保护验收回执，也没有公网/CDN下载。HTTP/TLS开销、metadata、重试与未来重新构建后的字节变化不包含在该数字中。

Thin 的小包不能代表完整更新流量：[thin-resolver.mjs](../../packages/release-stack/thin-resolver.mjs) 还逐项下载 Node 和 artifact ledger 中的依赖。本轮不调用该网络解析，不用预先 staged 的 `resolved` 目录冒充 Thin 现场重建成功；Full 是已确认的交付边界。

### 增长来源

下表为两次候选的 `du` 分配字节数，**子目录相互包含，不可相加**。本机原始记录：[resources-sep26-transfer/component-allocation.json](../evidence/2026-10-18-local-development-history.md#local-03aa7a97dee5baee)。

| 组件 | M1 bytes | M2 bytes | 判断 |
| --- | ---: | ---: | --- |
| OMP 展开包 | 9,019,392 | 80,261,120 | 增长主要在应用依赖和 WebUI |
| OMP node_modules | 3,805,184 | 69,328,896 | 新增 node-pty 自身 65,003,520 bytes（约62.0MiB）是主要来源 |
| WebUI dist | 446,464 | 5,926,912 | 增加约5.23MiB；包含编辑器、终端等前端资源 |
| OMP packages | 2,666,496 | 2,895,872 | 应用模块增量相对较小 |
| OMP tgz（Full 内同时保留） | 1,376,256 | 18,337,792 | 候选身份/安装所需资产，与展开包一起打入 Full |

Node、Pi、external-npm 的分配占用在两次样本中基本稳定。本表支持“增量集中于新增应用依赖”，不能精确把压缩字节增长逐项归因，也不能单凭短采样证明没有内存泄漏。后续若优化包体，应先审计 node-pty 的可裁剪内容和平台原生依赖；本轮未裁包或改变候选身份，避免尚未验收的节省空间改动。

## 内存：Host 树、共享浏览器、V8 堆分栏

新增 [measure-process-resources.mjs](../../scripts/measure-process-resources.mjs)，通过 `ps pid,ppid,rss,comm` 记录 Host 及所有采样时可见后代；不读取 argv/env。浏览器单列 `/Applications/ego lite.app/` 下全部进程，包括脱离主父进程的 crashpad。各场景 20 次、间隔至少500ms，实际每组约10.2–10.4秒，共 **140 个组合样本**。没有强制 GC；截图在采样完成后截取，原生窗口已核对为本次 OMP 页面。

下表均为各列的**采样峰值 MiB**，各列峰值可能不在同一时刻，不直接相加。

| 场景 | Host 树 RSS | Ego 共享进程组 RSS | 页面目标 V8 used heap | Host 进程数 |
| --- | ---: | ---: | ---: | ---: |
| 空白页对照，Host 已启动 | 39.94 | 888.80 | 4.59 | 1 |
| 项目概览 | 28.69 | 853.45 | 4.44 | 1 |
| 长历史、输出首段、长 diff | 104.72 | 1,024.45 | 5.61 | 1 |
| Monaco 打开3,000行文件 | 26.20 | 910.56 | 16.96 | 1 |
| 真实 PTY 写入后空闲 | 123.14 | 871.33 | 18.62 | 3 |
| PTY 已关闭 | 41.22 | 985.09 | 17.56 | 1 |
| 返回空白页 | 34.88 | 937.86 | 17.96 | 1 |

这些口径的限制必须随数字保留：

- Ego 每组有16个进程，包含用户已有空间和标签页。它是同机共享浏览器的完整进程组观测，**不是 OMP 独占内存**；不能以各场景前后差值证明 OMP 的独占增量。没有关闭用户标签页来制造独占条件。
- RSS求和会重复计算共享页，也不包含全部被压缩/换出的内存，不等于 macOS physical footprint。采样可能漏过短寿命进程和瞬时峰值。Host读取历史后RSS回落，不能仅从该变化断言具体GC/压缩原因。
- CDP Performance 的目标V8堆不包括完整原生内存、GPU或所有worker；同渲染进程还可能保留旧文档。返回空白页仍约18MiB，故不能把该列叫“当前页面净占用”，也不重复加到浏览器RSS中。
- overview和空白对照末尾 `hasFocus=false`，其余业务状态末尾为true；这些是资源状态样本，不重新用于输入延迟/FPS判定。普通前台输入门禁沿用[独立输入验收](2026-09-26-omp-input-performance-acceptance.md)。
- 本轮确定性worker没有真实模型子进程。真实模型运行记录另用既有证据，不能拼接成同一时刻的“完整应用峰值”。

详细过程树、每个样本的时间和字节数见本机 [resources-sep26/summary.json](../evidence/2026-10-18-local-development-history.md#local-5bedcf6f7c15885c) 及同目录 `blank/overview/history-diff/monaco/pty/pty-closed/blank-after.json`。逐样本还记录了 Host+共享浏览器在同次采样中的RSS合计，仅用于检查统计完整性，不代表 OMP 独占量。

### 真实模型进程树与启动历史证据

重新读取既有 `9130d02` 回执，本轮不追加模型调用：

| 已执行场景 | Host + worker 树采样峰值 | 边界 |
| --- | ---: | --- |
| CPAR 小型修改成功 | 519,372,800 bytes（495.31MiB） | Host + RPC worker；不含浏览器 |
| CPAR writer | 549,830,656 bytes（524.36MiB） | 峰值样本包含Host、RPC及子任务；原验收脚本终态崩溃，非完整成功验收 |
| CPAR 模型续接撤权/取消 | 508,870,656 bytes（485.30MiB） | Host + RPC worker；未运行bash |

本机来源分别为 [live-cpar-summary-sep25/report.json](../evidence/2026-10-18-local-development-history.md#local-481796b71db4724e)、[live-cpar-writer-sep25/report.json](../evidence/2026-10-18-local-development-history.md#local-89b6cd05f7955d19)、[live-cpar-cancel-sep26/report.json](../evidence/2026-10-18-local-development-history.md#local-158f40906969dd9c)；两秒采样，不能称精确系统峰值。

启动仍以本机 [cold-start-36FBe0/metrics.json](../evidence/2026-10-18-local-development-history.md#local-e2577f044ec5fd9d) 的 **4,075.7ms** 为已执行证据：新Node进程经安装入口至Host就绪及配对，抑制默认浏览器打开；不是清空OS缓存的冷启动，也不包含首屏。本轮夹具Host初始化+初次索引54.5ms只是进程内子步骤，不能替换完整入口指标。

## 实际验证、清理与复测

- Full候选组件摘要在压缩前、下载函数本地流回放后、安全解包后保持一致。M1同函数重打包与既存115,465,257字节归档SHA完全一致。临时回放/解包目录清除，保留压缩包和JSON。
- 进程采样辅助函数实机检查PASS：真实sleep子进程被包含、RSS之和一致、浏览器路径边界成立、无argv/env字段、Host不存在时拒绝测量。证据 `resources-sep26/process-helper-check.mjs` 与 `.log`。
- Ego实际打开历史、工具输出、diff、Monaco和xterm；终端输入 `printf RESOURCE_PTY_OK > resource-proof.txt`，落盘字节精确匹配。关闭→观察页面已结束约1,510.3ms，**仅一次且包含自动化等待**；不是取消本地确认P95或纯进程退出时延。
- 关闭后supervisor 77522、shell 77525 均不存在，后续20个样本Host树均回到1个进程，安装ownership模块重新取得并释放项目锁。见本机 [resources-sep26/pty-cleanup.json](../evidence/2026-10-18-local-development-history.md#local-d9a965ed348eb0d8)；页面截图 [resources-sep26/pty.png](../evidence/2026-10-18-local-development-history.md#local-184e527dd4218a2f) 已查看。
- 自动化中一次宽泛项目按钮定位歧义、一次CDP采样后旧ref失效、两个错误/不可见选择器等待超时，均重新读取当前页面后纠正；没有重复发起终端、没有把这些自动化错误记成产品缺陷或隐藏成零失败。
- Host正常退出、Ego空间正常finish、配对清单删除，见本机 [resources-sep26/cleanup.json](../evidence/2026-10-18-local-development-history.md#local-a746e227e7e3e308)。未晋升日常安装、未发布、未升级Pi；既有Glacier审计文档改动保留。

离线包体复测命令（输出目录必须尚不存在）：

```sh
node scripts/measure-stack-transfer.mjs /absolute/staged-candidate /absolute/fresh-evidence
```

浏览器夹具仍使用 `scripts/phase1-web-fixture.mjs`，设置 `OMP_TEST_STACK_PACKAGE` 指向安装包并以安装Node启动；在Ego同一个TaskSpace中按上述七个状态采样。`resources-sep26/sample-browser.mjs` 保存了本次绑定PID的执行脚本，新一轮应绑定新HostPID、空间与全新输出目录，不重用旧PID或覆盖原证据。

## 下一门禁

资源和当前Full包体信息项关闭。下一优先为**受管writer真实Host/页面成功终态**：使用已离线修复的有界验收脚本、同CPAR Grok4.5/low、独立合成项目，要求审批→writer→reviewer→应用→双gate→Host succeeded→页面成功→进程退出和双锁释放；失败即停，不自动重试或换路由。现有任务3/3、重试5/5已耗尽，执行前须明确追加一次writer复测额度。

运行中shell取消与模型续接取消仍是不同场景，不能用本轮空闲PTY关闭补齐前者。全部必要门禁通过后才核对活动会话并做日常更新、回滚、再应用和M2总验收。
