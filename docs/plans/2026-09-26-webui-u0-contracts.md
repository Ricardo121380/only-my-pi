# U0 接口、状态与资源合同

日期：2026-09-26；09-30实现状态更新。**设计合同；U1-01私有存储及U1-02 Host输入协议/控制器/真实Pi本地投递已按限定范围实施。** [存储验收](2026-09-29-webui-u1-01-storage-acceptance.md)与[投递验收](2026-09-30-webui-u1-02-delivery-acceptance.md)分别记录实现边界；网页输入入口仍待U1-03/04，U1整批门禁待U1-06。Pi相关取舍见[ADR-0018](../decisions/ADR-0018-host-input-ledger-and-pi-correlation.md)。U0-05资源/用量来源与真实SDK加载可行性已通过；不表示U5配置API/UI已实现。09-29预览固定配方PoC通过，精确边界见[收口记录](2026-09-29-webui-u0-preview-fault-acceptance.md)，不是生产实现验收。

## 1. 责任与模块边界

| 责任 | 实施位置（U2以后新增名称仍为规划） | 权威数据 |
| --- | --- | --- |
| 草稿/队列/投递状态、原子版本更新 | `packages/host/input-store.mjs`、`input-contracts.mjs`及`input-controller.mjs` | Host私有文件；不是Pi历史或执行授权 |
| 命令schema、能力协商、错误码 | `input-protocol.mjs`、`contracts.d.ts`、`server.mjs`的Host2＋输入1协议 | Host协议；客户端不能定义授权事实 |
| Pi补充/消费关联/精确分支 | `pi-input-bridge.mjs`、`rpc-worker.mjs`、`account-rpc-entry.mjs`及`catalog.mjs`；对话分支产品功能仍待U3 | 当前分支Pi JSONL持久历史及绑定元数据，不以SDK事件本身作持久证明 |
| 材料与快照 | U2新增`material-store.mjs`、独立解析worker | 内容摘要＋版本＋来源，不依赖原路径当前内容 |
| 对话/输入视图 | 渐进拆分App、Composer、TaskControl状态 | Host状态；面板开闭是本机视图状态 |

沿用私有根`only-my-pi/host/`，不改CLI/TUI配置、不将草稿/附件写到项目或认证文件。草稿、每会话队列分别分片，带schemaVersion与revision；复用现有原子文件工具。未知schema拒写并保留，不重置为空。索引可重建但不能替代消息/材料权威存储。

## 2. 输入记录 v1

```ts
type InputRecordV1 = {
  schemaVersion: 1;
  inputId: string;                 // 全局稳定随机ID
  revision: number;                // 编辑/删除CAS；不复用RPC递增序号
  projectId: string;
  sessionId: string | null;        // null仅明确新建草稿
  taskId: string | null;
  delivery: 'prompt' | 'steer' | 'queue';
  text: string;
  materialSnapshotIds: string[];
  contentDigest: string;           // Host对规范化实际发送内容计算
  binding: {
    accountId: string; modelId: string; thinking: string;
    mode: 'readonly' | 'controlled'; resourceRevision: number;
  };
  state: 'draft' | 'queued' | 'dispatching' | 'accepted' |
         'consumed' | 'paused' | 'unknown' | 'removed';
  consumedEntryId: string | null;
  pauseReason: string | null;
  createdAt: string; updatedAt: string;
};
```

绑定不含凭据或可复用的coding grant。材料摘要、账号/模型/强度/资源版本、会话归属参与准入；同ID同有效内容返回已有状态，同ID异内容报冲突。时间不是幂等键。编辑只允许未投递项且expectedRevision匹配；投递与编辑必须在同一Host串行准入区比较状态。状态与内容更改同次原子保存；收到保存成功前不展示可靠入队。

U1-01实际分片v1：draft含`scope/revision/draft`，queue含`scope/revision/items`；都有`schemaVersion/kind`。保存草稿/入队比较分片版本，编辑和状态转换同时比较记录`expectedInputRevision`，完整schema与不变式由新增实现检查。满额记录/文件/已知ID拒绝新增而不删历史，发布后持久性未知阻断准入；细节与实际上限见[U1-01验收](2026-09-29-webui-u1-01-storage-acceptance.md)。U1-02新会话先取得真实会话身份，再于首次Pi prompt前把完整草稿存为带源ID关系的新会话输入记录；重复requestId不重启任务。草稿清除与新会话记录属于不同分片，**不承诺跨分片原子事务**；失败保留可核对的草稿或完整新记录。当前`materialSnapshotIds`只约束引用ID，新增输入命令显式拒绝非空材料列表，实际材料字节及模型能力待U2。

## 3. 投递与恢复

正常：`queued → dispatching → accepted → consumed`。写入dispatching之后才调用子进程；SDK ACK为accepted。`message_end`仅触发候选查找；只有当前Pi分支JSONL中保存的custom_message同时匹配业务ID、scope、task、内容摘要、全文且具有entry ID，才能持久标为consumed。已消费不等于模型已响应，更不等于任务成功。局部去重不构成跨进程绝对exactly-once；结果未知时保持unknown且不自动重投。

| 情况 | 必须行为 |
| --- | --- |
| 工具运行时steer | 当前工具继续；下一可接收位置生效，独立停止不混入此命令 |
| 消费前再次提交相同ID | 不重复投递；内容不同409 `INPUT_ID_CONFLICT` |
| 当前任务恰好结束 | 409 `TASK_NOT_RUNNING`，保留草稿；不能静默转prompt |
| ACK/事件丢失 | 查Host状态与Pi历史，按ID对账；不按文本猜测，不重发探测 |
| worker或Host重启 | queued暂停；dispatching/accepted无法证明结果则unknown，保留待核对 |
| 任务失败/取消/撤权 | 未投递项暂停；已投递项不显示“已撤回”；不恢复授权 |
| 排队推进 | FIFO；前项成功且绑定/材料/资源有效才推进；需要写入仍重新审批 |
| 配置变化、多窗旧revision | 显式冲突/暂停；不会改写已排队快照或暗换账号 |

Pi跟进队列不是持久任务调度器：U1的“排队”留在Host，前一任务成功后再准入；不一次性把所有队列塞入Pi follow-up，避免失败时越过Host暂停规则。公开follow-up仅作为已验证的运行时能力，不等于选定产品调度策略。

U1-02已实现`/api/input-command`：`getInputs`、`saveDraft`、`clearDraft`、`submitPrompt`、`enqueueInput`、`deliverSupplement`、`editQueuedInput`、`removeQueuedInput`、`resumeQueue`、`reconcileInput`。请求仍须Host2认证/Origin/配对，并带输入协议1；响应区分持久投递状态、版本、消费entry ID与准入异常，不仅返回accepted布尔值。内部RPC id与业务inputId分开；旧客户端仍使用原Host序列，不因新增输入脏事件出现缺口。网页客户端只有Host声明`inputs.protocol=1`后才能展示可执行入口，重连时以`getInputs`权威状态核对而非根据脏事件推断消费。

## 4. 分支与材料关联

停止会话才能fork，选择点用Pi稳定entryId而非UI数组下标。SDK `position: at`保留该消息；新会话记录parentSessionId/parentEntryId、继承的材料引用，不复制待投递队列、执行授权或新增消费。原文件不回滚、不创建Git工作目录。分支时需要新的会话准入与账号绑定；原文件字节不应改变。

图片正常prompt已经验证实际image block；图片steer/custom carrier、材料引用恢复和compaction后消息定位仍属于U1/U2集成必测项，不能从文字探针推断全部兼容。

### 4.1 图片原件与实际发送快照（09-29候选合同）

候选准备层仅接收显式上传/项目引用的静态PNG/JPEG/WebP。保留单文件20MiB、原尺寸40MP门禁；不把原图路径交给RPC自行读取。原件按内容摘要保存，不被处理结果覆盖。图片准备成功仍须检查模型图片能力，缺能力时保留材料并提示处理，不能丢图或自动换账号/模型。

候选发送策略`u0-png-srgb-orient-edge2000-v1`：校正EXIF、等比例最长边2000且不放大，输出保留透明度的sRGB/8位PNG，发送版本去除EXIF/ICC；base64严格小于4.5MiB。原件仍保留原始元信息。2000是基于固定Pi公共文件工具互操作验证的工程默认，不代表原40MP内容逐像素送入模型；16位转换、颜色和缩放差异明确说明。APNG/多帧WebP拒绝而不取首帧；派生体积超限明确报错，不循环降质或改JPEG来静默通过。

材料卡片展示原件名称/格式/宽高/字节数，以及**实际发送PNG**的预览、宽高/字节数和处理说明；切换处理方案或范围要生成新的不可变派生版本。细字缩小后无法使用、体积超限等情况保留草稿，提示用户换材料或明确调整范围；本候选不自动新增裁剪器或保证模型OCR。原件/发送预览不可混用标签。

快照至少保存`originalDigest`、`derivedDigest`、原/派生MIME与尺寸/体积、`normalizerVersion`、处理策略、来源与显式范围、`derivedAvailable`。InputRecord的`materialSnapshotIds`与`contentDigest`绑定实际发送派生字节；生产准入再次核对版本、模型能力与预算，通过真正Pi image block提交。扩展或模型入口若改写内容，必须核对最终版本或拒绝，不把旧预览称为实际输入。

历史按会话/消息/分支引用保留实际发送图及来源；原件后续变化不改写历史，归档不删除。分支复用到选择点的材料快照、不复制授权；清理原件和发送图分别显示影响，检查共享引用，清理后保留不可用状态，不能重新从变化的原路径伪造旧图。

本轮选定样例在Node22/24各37项通过、23正常派生PNG经Pi公共resize/read字节不变，见[证据与边界](2026-09-29-webui-u0-image-compat-acceptance.md)。候选、资源包与合同不等于U2上传/API/卡片、RPC/真实Provider或Full已经实现；这些入口仍按原计划逐批验收。

### 4.2 文档文字提取、部分解析与实际快照（09-29实验合同）

候选结果使用`schemaVersion:1`、`status:ready|partial`、`blocks/textBytes/warnings/coverage`。`ready`仅表示受支持文字路径未检测到遗漏，不标为“完整读取文档”；覆盖模式固定`text-only`并显示渲染/OCR/对象/公式计算/版式限制。检测到未提取对象、外围part、缺缓存或无文字页/表/幻灯片时标`partial`；全文件无文字或安全/预算负例返回错误，不发送伪造空正文。

DOCX来源分body/header/footer/footnotes/endnotes，保留part、段落、引用note ID与物理tablePath；主正文引用的外围parts才进入提取结果，孤立parts提示但不注入。raw styleId/outlineLevel不是已解析的样式继承或实际标题级别，Word页码不可捏造。不换行/软连字符保留对应Unicode；PPTX table/row/cell为1起始物理序号，合并表格提示不是视觉网格；显式未合并默认值不误提示。XLSX公式只用文件中的缓存，不补算值；共享公式从属cell保留formulaType/sharedFormulaIndex与空公式文字，仍为cached-not-evaluated，不误标literal；rPh注音不拼进正文。Strict命名空间目前只是经合成样例验证的文字子集。

警告按part/类型合并，保留出现次数和首次位置，UI明确这不是每个遗漏位置的完整枚举。发送前卡片展示实际提取范围/预览、partial原因和剩余能力限制，异常时由用户选择范围或明确接受该文字子集；不得静默截断、忽略警告后显示“全部读取”。主/外围内容共用输出预算，换范围或版本生成新的不可变派生快照。来源顺序不是Word分页阅读顺序。

历史快照保留原件/提取正文各自摘要、提取器/策略版本、实际blocks来源、warnings、coverage及用户选择/接受的范围，InputRecord绑定实际发送内容。产品U2仍须实现API、材料卡片、范围处理与RPC/模型内容核对；[本批实验通过](2026-09-29-webui-u0-document-coverage-acceptance.md)不替代这些功能验收。

### 4.3 解析预算冻结与阶段边界（09-29技术验收）

固定文档候选：PDFJS6.3.289＋yauzl3.4.0＋saxes6.0.0，Node22.19.0/24.19.0；图片Sharp0.35.5候选维持4.1规则。选定样例的单项20MiB、单次原始材料50MiB/10项、PDF200页/PPTX200张/XLSX20万非空单元格、文字2MiB、展开200MiB、ZIP10000条、文档30秒/worker512MiB已验证；512MiB是25ms监测阈值，不是内核硬限额或所有合法输入的成功保证。

PDF策略`u0-pdf-decoded-stage-high-water-v2`：每文档累计实际过滤阶段的高水位；多层、重新构造的stream和failed-native后的JS新产出继续累加，不退款。容量/缓冲复制/流拼接/解密副本及实际缓存复读不当新展开。越界状态不可逆，metadata/每页/异常恢复/destroy后都核对，返回错误而非已有部分正文。worker必须在API首次fake-worker缓存前按固定完整摘要加载；每child单请求，批次串行且destroy后才复位，产品并发不可共用一个全局预算状态。

双Node最终各152项文档/预算＋4公开Office通过；详细[验收与身份](2026-09-29-webui-u0-pdf-budget-acceptance.md)。原资源合同/旧F01探针身份不改写；实验生成worker不在日常安装中。完整发行义务与Full按已确认决定转为G2-00，U2产品集成前必须闭合，不得以U0 PoC替代。渲染/OCR/内部WASM硬内存、全部字体/CMap/producer与真实上传/RPC/API并非本轮保证。

## 5. 资源发现与配置合同（U0-05可行性通过）

**2026-10-17 后继范围：** 以下保留原 GUI 配置隔离合同及固定实验结果。[ADR-0021](../decisions/ADR-0021-shared-product-configuration.md)已将 Only my pi 管理的配置改为 CLI/图形端共用默认值加项目覆盖，原 Pi/用户外部配置归属仍保留。后续 U5 与共享配置切片按新范围验收；下文“两份 CLI 设置字节不变”等结果只证明当时原文件保护，不证明双端共享或 CLI 独立设置已实现。

现状：[launcher](../../packages/direct-agent/launcher.mjs)的`resolveDirectExtensionSet`核验包归属、manifest和resourceFilter，普通direct集含12项；native分发headless分支可为11项，不能硬编码“全部环境12项”。[account-rpc-entry](../../packages/host/account-rpc-entry.mjs)显式传扩展但尚未关闭skills/context自动发现，不能宣称GUI技能已隔离。

- resourceId使用包绑定＋入口＋版本/摘要；显示来源、权限类别、requested/effective状态、诊断及schema版本。发现不等于执行。
- GUI默认与项目覆盖分别存储；项目不存在覆盖时继承，显式reset删除覆盖。下一worker启动取不可变resourceRevision；当前worker不热切，排队旧revision暂停核对。
- 不可关闭的最小保护闭包包括permission-modes、OMP的session-ledger/context-doctor/omp-control/omp-direct，以及受管委派所需桥与进程归属链；最终精确集合必须经过加载/移除负例验证。
- 当前整套audited集合先原样保留，**这不是最终技能启停功能交付**。lsp、usage、notify等能否单独关闭，要在不削弱审计清单的前提下形成新的GUI资源合同与测试；不能直接给旧resolver减参数绕过漂移检查。
- 可选skills使用固定Pi支持的`noSkills`、`additionalSkillPaths`/override注入；保留用户选定的必要上下文来源，不能为了GUI隔离顺带删项目AGENTS规则。CLI路径与原文件不改。
- 只有声明配置schema且审查过的资源才能渲染配置表单；缺schema显示只读和原因，不执行配置里的任意代码。

### 本次固定配置与验证边界

`webui-u0-resources.mjs`使用H候选实际Node/Pi，并通过`packageRoot`载入带摘要验证的distribution绑定，不借用用户settings中的packageBindings。`continue-s5QW06/resources-4.json`六组检查通过：默认/项目覆盖、12项保护集合的本地resolver拒绝合同、扩展动态注入技能再次过滤、下一loader生效且旧loader不变、两份CLI设置字节不变、生产usage聚合对缺失/零值保持unknown。

当前12项audited资源全部保留为不可变基线；这是精确的保守集合，不宣称每项都属于最小安全闭包，也不承诺任意现有扩展已经可关闭。可选扩展是合成的`u0-optional`，技能alpha/beta/late也是合成内容。真实SDK实际加载集合与项目AGENTS正文逐项断言；生产U5还须对已审计可选资源及API请求补负例，不能只测本地`selection()`便声称API安全。

仅`noExtensions/noSkills`不足以隔离设置：Pi reload仍读取SettingsManager并解析package资源。GUI运行时须使用按显式schema生成的`SettingsManager.inMemory`，传审计扩展与技能允许集合，同时保留`noContextFiles:false`加载AGENTS；`skillsOverride`再次过滤扩展晚注入。prompt/theme及SYSTEM来源单独受控，不能依赖自动发现。原CLI/TUI设置不改，未知配置schema拒写，禁止将原配置整包复制进GUI运行时。

## 6. 用量来源与口径（U0-05来源核验通过，U4实施）

| 数据 | 真实来源/现状 | 必须保留的限制 |
| --- | --- | --- |
| 请求token/缓存 | Pi assistant message_end.usage | 本次夹具Provider prompt100含cache30，Pi归一化input70、cacheRead30、output20、total120；不得再加一遍缓存 |
| 请求/工具次数 | tasks的message_end/tool_execution_start | 请求级ID和完成态去重待U4；工具失败不等于没发生调用 |
| 费用 | Pi模型目录价格估算 | 非供应商账单；无价格/全0回执保持unknown；保存当时币种/价格快照 |
| 上下文占用 | 最新请求实际上下文/模型窗口 | 不能以会话累计token估计；缺请求级来源时unknown |
| 速度 | 请求级首token到末token的单调时钟 | 排队/工具等待不算有效生成时长；现有task.startedAt/endedAt不足以计算 |
| 子Agent | direct orchestration的usage，subagent adapter的稀疏回执 | direct可有input/output/cache/cost/turns/toolCalls/durationMs；通用adapter可能只有total/cost；不可拆猜 |

每个用量事件带ledgerId、task/session/run/agent/response身份、sourceKind、availableFields、价格版本与采样边界；会话按真实新消费汇总，fork继承展示但不计为新增。UI显示已覆盖请求数/总请求数，部分数据不显示为完整统计。[现有聚合](../../packages/host/usage.mjs)、[子代理归一化](../../packages/subagents/adapters/pi-subagents-rpc-v1/normalization.mjs)、[受管委派](../../packages/direct-agent/orchestration.mjs)是来源，不等于U4新链路已经接入。
