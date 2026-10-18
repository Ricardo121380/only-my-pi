# U1-01 私有输入存储验收

日期：2026-09-29启动，09-30收口（Asia/Shanghai）。结论：**PASS_U1_01_STORAGE_C_ONLY**。U1-01完成，U1为1/6，本轮15/44；不是U1整批或网页功能已完成。依据：[Task看板](2026-09-26-webui-optimization-tasks.md)、[输入合同](2026-09-26-webui-u0-contracts.md)、[ADR-0018](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。

## 1. 源码与证据身份

仓库分支`codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`。工作树含既有S0/U0未提交内容，不能仅以HEAD或整份Git diff归因本Task。以下三个最终报告绑定同一份1288个非文档文件的SHA256/权限快照，其`JSON.stringify(source)`摘要为`ccd966ec59b495468db8ecdf64d858ed9a61317d176c1ae3edc5e8a6a095e9fa`；逐文件身份见报告，不是已发布版本。

证据根（仓库外）：`../../../artifacts/webui-optimization/U1-01-0929-VO1NiZ/`。文件与摘要：

| 报告 | SHA256 | 结果 |
| --- | --- | --- |
| `storage-1790697484791.json` | `e5cbd81ec8ad00d8827922a9b21f0023a7df79526ee15f194de0c76f22979a35` | 两个Node各21项通过，零跳过 |
| `types-1790697480300.json` | `ca092e6d8a5b6943c9c8d6b5c9093e38428a8327a68d52a1cc912d2f06122e2f` | 两个Node各4组类型检查通过 |
| `regression-1790697563495.json` | `c3af398ffc494a40a2627174e770bd9510f2a820efe780bf6a54632403f8f9a3` | 两个Node各130项：127通过、0失败、3跳过 |

运行器：[webui-u1-storage.mjs](../evidence/2026-10-18-local-development-history.md#local-0a68cbaea5200199)。报告记录实际Node路径、版本、argv、退出码、日志、进程组退出检查；stdout达到上限则拒绝验收。成功分支的共用运行器不返回stderr全文，报告明确`RUNNER_RETURNS_STDERR_ON_FAILURE_ONLY`，不将缺失日志冒称为空。

## 2. 实际改动

| 文件 | 本Task职责 |
| --- | --- |
| [input-contracts.mjs](../../packages/host/input-contracts.mjs) | 严格v1 schema、内容摘要、归属/状态约束及容量限制 |
| [input-store.mjs](../../packages/host/input-store.mjs) | 草稿/队列分片、原子版本更新、独占存储租约、串行CAS与恢复 |
| [contracts.d.ts](../../packages/host/contracts.d.ts) | 追加私有存储类型，不增加浏览器命令 |
| [server.mjs](../../packages/host/server.mjs) | Host启动/失败/关闭管理输入存储，内部返回`inputs`；不启动新worker |
| [tsconfig.host.json](../../tsconfig.host.json)、[类型负例](../../tests/types/host-input-store.mts) | 两个新增实现启用`@ts-check`，直接导入实现检查调用；不声称旧Host全部已类型化 |
| [package.json](../../package.json)、[package-lock.json](../../package-lock.json) | 固定开发依赖`@types/node@22.19.0`及其`undici-types@6.21.0`；不升级既有依赖或新增运行时库 |
| [包内容合同](../../verification/manifests/pack-content-v1.json) | 必需列表加入两个实际运行模块；不放宽其他包边界 |
| [host-input-store.test.mjs](../../tests/host-input-store.test.mjs) | 21项确定性边界/故障/Host生命周期验证 |

私有路径为`only-my-pi/host/inputs/{drafts,queues}/<scope-sha256>.json`，scope是项目/会话身份，不是客户端可传入的磁盘路径。目录700、文件600；不安全权限、符号链接、错位身份或未知schema拒绝，原数据保留，不覆盖为空。新建草稿允许`sessionId:null`且必须`prompt`；提交入队必须绑定实际会话。新会话创建与草稿转提交由U1-02/U1-03明确实现，不假称已有。

保存全文及账号/模型/思考强度/模式/资源版本、材料快照ID，不借task中裁剪的512字符摘要。摘要包含完整文字（含空白）、投递类型、scope、配置与材料ID顺序；不含时间、执行状态或RPC序号。拒绝额外凭据/grant字段；账号是否可用、模型能力及执行授权仍由后续controller准入核对，本项结构校验不等于授权。

## 3. 已验证的存储行为

- 两窗口请求模拟同revision竞态，只有一方能保存；编辑同时检查分片`expectedRevision`和记录`expectedInputRevision`。入队前复制调用方对象，异步等待期间的外部变更不污染快照。
- 同scope、同ID、同有效内容返回原状态，不重复写入；异内容或跨scope复用ID拒绝。已提交ID不再从草稿入口改写。仅queued/paused可编辑或标removed；删除为墓碑，不自动清历史或重放。
- state不等于任务结果。正常持久状态包括queued/dispatching/accepted/consumed；accepted不能冒称消费，consumed必须有entry ID和任务身份。本项只接受可信controller提供的证明字段，尚未接真实Pi消费对账。
- 启动先逐分片验证所有权威文件，再逐队列恢复，正文不全部驻留内存。queued变paused，dispatching/accepted变unknown，原因HOST_RESTARTED；原草稿与配置不变，第二次恢复不重复改写。异常后不恢复grant、不调用模型、不自动推进队列。
- 复用原子写入的文件fsync/rename/目录fsync。发布前失败保留旧版本，允许显式重试；rename后持久性未知返回503并停止准入，关闭/重开后暂停或待核对，不能假报保存成功。
- 实际子进程分别在rename前/后SIGKILL：旧草稿或完整新队列可核对，未发布临时文件保留但不当权威数据。初始化过程中close等待恢复发布与租约释放，其他owner不能抢写。
- Host启停/重启夹具证明恢复后worker启动次数为0，public snapshot没有新增inputs能力。HOST_PROTOCOL仍为2；HTTP、WebSocket及Pi投递命令本Task未扩展。

工程上限：文字32,768字符、材料ID最多10、每队列记录最多1000（含墓碑）、每分片16MiB、权威分片最多10,000、当前Host已知输入ID最多100,000。10,000分片/100,000 ID边界均实际构造：满额已有内容可读，分片满额仍可编辑，超额在写入前拒绝，不截断或删除旧数据。已替换草稿的ID在本进程索引中保留至重开；本轮未实现历史配额清理UI。

这里的材料ID仍是不可变引用占位，不证明材料字节、上传或模型可读；这些在U2实现。原子性是单分片，不是草稿与队列的跨文件事务；恢复期间I/O失败可能已有部分队列暂停，Host不进入执行状态，后续恢复保持保守。SIGKILL及注入fsync失败不等于实际断电测试；容量用例不构成OS硬内存、延迟SLA或恶意本机进程隔离保证。

## 4. 验证范围与失败账本

Node固定22.19.0/24.19.0。每个环境依次运行：新增存储21项；根/safety/host/webui四个tsconfig；全部`tests/host-*.test.mjs`及config-runtime、pack-content、docs-links共130项。包检查覆盖实际npm pack清单及隔离目录的静态doctor，**不是Full安装**。

3个跳过项为生产SDK scout、writer和installed Host真实PTY；缺对应环境变量/安装夹具，保留SKIP，不计PASS。不重用旧真实Pi或旧安装证据补本次P/I。浏览器、真实Provider、Full、日常晋升均NOT_RUN，收费调用0。

失败证据未删：

| 原报告 | 失败原因与修复 |
| --- | --- |
| `types-1790696314596.json` | Node内置类型缺失、Ajv NodeNext默认导入类型不匹配；补固定开发类型、改库实际具名导入后通过 |
| `storage-1790696329008.json` | 首次进程死亡夹具仅悬挂Promise，进程提前退出；加入实际存活句柄，owner拒绝与SIGKILL恢复均重新验证 |
| `regression-1790696553198.json` | 旧U0六份记录的36个Markdown链接越出仓库；只改仓库外证据的引用格式，保留路径、正文结论、FAIL/PARTIAL与原件备份 |

六份历史记录的原文备份与36个目标见`doc-link-format-before.json`及`*.before.md`；每个证据目标存在，修复不是删文档检查或改历史门禁。最终非文档源码增删、保护文件、旧记录等价转换及本轮进程组复核见同目录`static-final.json`；文档收口检查见`closeout-checks.json`。

## 5. 门禁与下一项

G1-02/04/05的**存储C子集PASS**；完整门禁仍NOT_RUN，未覆盖浏览器刷新、真实Pi补充/消费、调度、授权撤销及重连全链路。G1-01/03/06也未实现验收。本Task完成不能提前把整批U1或新控件标为可用。

下一项U1-02：固定公开协议/能力协商，接入controller与Pi业务inputId关联；先持久dispatching再调用worker，ACK与消费分开，结束竞态不偷偷转新任务，FIFO在失败/取消/绑定漂移后暂停。U1-03再接默认续聊、明确新建及网页草稿；U1-06进行整批Ego验收。G2-00仍强制阻断U2产品集成；Electron仍待U6。
