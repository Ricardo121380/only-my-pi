# U0 设计与技术验证进展

日期：2026-09-26；09-29更新。**U0技术Task全部验收：6/6；总计14/44。** 按用户确认的顺序完成[PDF预算收口](2026-09-29-webui-u0-pdf-budget-acceptance.md)，完整发行材料/Full由U2入口G2-00继续阻断。下一项U1-01，未进入Electron或晋升日常安装；只增加设计、隔离探针、合同与验收文档，生产行为和用户改动保留。下方旧5/6/FAIL/PARTIAL均为历史快照，不覆盖。

证据目录：仓库外`../artifacts/webui-optimization/U0/run-5pTdZL/`与本次`../artifacts/webui-optimization/U0/continue-s5QW06/`（相对仓库根）；模型/Host实验仅用合成内容，新增Office实验用固定提交公开语料，不读用户私人文档。收费Provider调用0。

## 当前看板

| Task | 状态 | 证据/剩余 |
| --- | --- | --- |
| U0-01 | 已验收 | baseline.json：S0 PASS，1232原有源码文件与H一致；未实现入口清单见下 |
| U0-02 | 已验收（设计） | 设计合同＋8状态交互样稿，Ego 390/761/1440px、焦点及简化动效通过；不是产品功能验收 |
| U0-03 | 已验收（可行性） | pi-probe-6.json：真实Pi0.85.1子进程＋本地模型，6组检查；接口/恢复合同及ADR已写；U1生产链未实现 |
| U0-04 | 已验收（技术可行性） | 同摘要源码双Node各152项文档/预算＋4公开Office；单流/单页/多页200MiB及+1、合法Filter数组/缓存/恢复/串行复位通过。图片37项旧证据未变复用。完整发行/Full由G2-00阻断，旧失败/来源保留 |
| U0-05 | 已验收（合同/SDK可行性） | resources-4.json：6组通过，精确保守集合、覆盖/实际加载、AGENTS保留、下次生效与CLI不变；生产API/UI另验 |
| U0-06 | 已验收（固定配方可行性） | Ego25浏览器证据＋faults-2异常矩阵＋driver-2退出码；详见09-29收口，生产预览待U5 |

## 基线与证据复用

- 主仓HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`、分支`codex/webui-phase1`；大量脏文件是已有S0与计划改动，保留不提交。用户Glacier交互审计文档的+8行未动。
- S0最终H源码 `cb27c6a9ede6cdb8bbedd155bf74e29e1198210a`；stackId `sha256:6050719e122e0619c4a03e4a301dfaa526ea4cb62998b53b9038ec69dc65c17b`；Node24.19.0、Pi0.85.1。对1232个原有非文档源码逐文件摘要比较，无变化；新U0实验文件另列，不假装属于H。
- 日常active仍为`7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。开始时磁盘约6.6GiB可用，采取小型隔离依赖实验，未重新打Full包、未删除旧产物。
- S0 Node22/24与安装/页面门禁继续引用[S0记录](2026-09-26-webui-s0-remediation.md)，不重复不受影响的1352项矩阵；U0新增探针独立执行。

当前未实现入口：插件管理、分区创建、会话操作、输入附件、项目设置和测试/构建；历史需显式续接，右侧大屏默认打开。来源`webui/src/App.tsx`、`webui/src/Composer.tsx`、`webui/src/Inspector.tsx`；实际加载的是`prototype.css`＋`host-ui.css`，不以未加载样式推断页面。

## 设计证据

[设计合同](../design/glacier/2026-09-26-u0-design-contract.md)、[可交互HTML](../design/glacier/u0-workbench.html)。采用用户指定三项前端skills；OpenDesign/K3入口未发现，按既有可选辅助约定由当前Codex完成，未换用其他外部模型。

Ego专用空间11；`design-browser.json`记录三种宽度无横向溢出、右侧默认关闭、八种场景渲染、补充/排队区分、权限/用量独立面板、焦点返回和循环、reduced-motion下transition为0。已实际查看`design-1440.png`、`design-761.png`、`design-390.png`、`design-390-dark-running.png`。首次焦点循环检查失败，已补显式Tab/Shift+Tab循环并复验；不是静默忽略失败。样稿无模型/Host/真实终端连接。

## Pi真实进程证据

以H内Node和Pi运行`webui-u0-pi.mjs`，最终第6次报告包含10次仅本机合成Provider请求、全部子进程退出（此前调试轮的请求另保留在各报告，不将其抹去）。六组结果：

1. 原生steer/follow-up在工具等待时ACK，工具不被打断；释放后均被消费，但原RPC ID不进入消费事件。
2. SDK custom carrier可区分相同文本不同ID、重复同ID不再投递、异内容冲突；标识不进入模型文本；settled后补充拒绝。
3. SDK fork position=at保留指定assistant消息，源JSONL字节不变，新会话ID不同。
4. 停止后resume同身份，在启动完成后的1000ms观察窗口未自动请求；PNG实际到达模型；Provider输入100含缓存30被Pi归一化为input70/cache30/output20/total120。不将有限窗口推断为任何未来时刻的证明。
5. 丢弃IPC ACK后按get_messages找到唯一已消费ID，不重投。此项是Pi边界故障注入，不是生产浏览器断连验收。
6. ACK后、工具释放前强制退出worker并核实SIGKILL终态；恢复历史没有未消费输入，1000ms窗口内没有自动请求。证明需要Host持久意图与unknown暂停，不能承诺单靠Pi exactly-once。

只读探子核验后，主代理补上TERM→KILL→最终超时的有界清理、SIGKILL退出断言和明确观察窗口，再次运行得到pi-probe-6 PASS；解析补严格负例和spawn失败清理后得到documents-2 PASS。探子没有修改文件，全部单轮结束。

失败留存：首次child语法/退出清理问题、第二次fixture将content数组当字符串导致超时；`pi-probe-2.json`、`pi-probe-3.json`保留，分别修正后4/5通过。前几次未形成报告的错误保留在本轮工具记录，不以最终成功抹掉调试过程。

## 预览认证负例与下一步

`webui-u0-preview-auth.mjs`启动私有空白的真实生产Host实现，不加载账号或用户项目。Ego实际携带此夹具临时cookie：

| 条件 | 观察 |
| --- | --- |
| 127.0.0.1 → localhost预览 | 夹具Host cookie未发送 |
| 127.0.0.1 → 同IP另一端口预览 | 夹具Host cookie被发送 |
| 服务端拿夹具cookie，伪造合法Origin读取/api/state | HTTP200；不带cookie为401 |
| 同样伪造Origin并带协议号连接/events | 收到真实Host snapshot |

报告状态REPRODUCED；这是**隔离负例失败G0-05=FAIL**，不是成功通过隔离验收。未输出cookie、pair token或control token；仅匹配/重放本实验Host凭据。Host和两个HTTP夹具均已关闭。此结论说明未来不可信预览不能直接与cookie Host共用hostname；不表示当前未实现预览已对外暴露，也不撤销S0不同范围的认证生命周期验收。

下一轮先验证候选：受管预览副本＋可信入口（剥离Host凭据、子服务不直接暴露浏览器端口），对比origin绑定的GUI授权方案；必须覆盖直接端口/重定向/WS转发、cookie/API/WS重放和服务端环境泄漏。仅改localhost名称、仅做浏览器CORS、仅换端口均不足。原Host控制token不得下发到预览子进程。

同时完成真实源单写、受管副本更新/热更新、误写源拒绝、端口冲突和Host退出清理；若只能运行受支持预览配方，明确列出，不用静态预览或普通PTY代替“Agent同时编辑”。本机协作边界不是恶意同UID代码的OS沙箱；任何改变该边界的方案需重新讨论，不自动安装容器或修改系统权限。

## 复现命令

以下`STACK`与`RUN`为本次身份路径示意，执行前验证仍存在；报告文件采用wx，不覆盖旧证据。

```sh
# 使用候选 Node；STACK为H栈目录，RUN为本次仓库外证据目录。
"$STACK/node/bin/node" scripts/probes/webui-u0-pi.mjs "$STACK" "$RUN/pi-probe-next.json"
"$STACK/node/bin/node" scripts/probes/webui-u0-documents.mjs "$RUN/parsers" "$RUN/documents-next.json"
"$STACK/node/bin/node" scripts/probes/webui-u0-preview-auth.mjs "$RUN/preview-auth-next.json"
```

最后一项需在同一Ego空间按输出的issuer → localhostPreview → issuer → preview访问，再访问preview的/done；5分钟上限自动回收。它是复现失败的诊断，不要用于用户日常Host。

## 上轮收尾检查（run-5pTdZL，不冒充本次结果）

- `baseline-final.json`再次核对1232原有源码无变化、日常active未变、用户Glacier文档+8行保留；按OMP路径/进程名筛查未见匹配进程，此检查不宣称枚举了机器所有可能的Agent进程。
- `static-final.json`：8份相关文档的37个本地链接存在，5个探针与样稿脚本语法检查通过，`git diff --check`通过。
- Ego空间11已调用finish关闭；专用样稿HTTP进程88061已正常退出，预览认证夹具报告确认全部服务关闭，Pi/解析worker均已回收。
- 最后磁盘约6.4GiB可用。未删除既有产物、未提交或发布、未改全局配置或根依赖、未调用收费Provider。U0没有收口：保留G0-05失败和U0-04/05未完成，不用文档完备代替功能/安装验收。

## 本次续推：continue-s5QW06

### U0-05通过与限制

[资源探针](../evidence/2026-10-18-local-development-history.md#local-ff53951d7e466900)在H内Node24.19.0/Pi0.85.1运行，以真实distribution manifest与内容摘要解析资源，而非借用用户packageBindings。最终`resources-4.json` 6组通过：

1. GUI默认＋项目覆盖生成实际SDK加载集合，12项audited扩展都在，合成beta技能生效、ambient扩展未执行、项目AGENTS正文保留。
2. 对12项必需身份的禁用请求，本地选择器逐一拒绝；这是resolver合同负例，不是尚不存在的U5 API安全证明。
3. 扩展晚注入late技能时，SDK重新应用过滤，未进入有效技能集。
4. 新loader加载alpha并停用合成可选扩展，旧loader仍保持beta；不热改正在运行的worker。
5. 两份合成CLI/项目settings原始字节未改；CLI的high仍为high，GUI内存设置独立。
6. 现有生产usage聚合对缺失/零回执保留unknown，有效input70/cache30/output20总计120；不重复加缓存。

配置与用量事件来源详见[合同](2026-09-26-webui-u0-contracts.md)。真实模型归一化证据继续引用未改变的pi-probe-6，而非声称资源probe调用过模型。U5仍需生产配置schema/API/UI、实际可选扩展审核、失败回退与有效版本绑定；U4仍需请求去重、会话/子代理账本。

调试保留：第一次仅传stackRoot导致未带distribution元数据，缺packageBindings，尚未生成report；改为packageRoot验证后，resources-2记录extendResources参数缺metadata的失败。依据固定SDK类型修正，resources-3/4通过；4修正证据名称与合法metadata枚举。没有改用户配置来规避错误。

### U0-06替代方案局部证据

代码为[controller](../evidence/2026-10-18-local-development-history.md#local-842786bb53735340)、[Vite worker](../evidence/2026-10-18-local-development-history.md#local-39ca247dd1bf4e82)、[Pi worker](../evidence/2026-10-18-local-development-history.md#local-5e05fe11db1cb09f)。当前选择仅为PoC候选：源文件由真实Pi工具经生产ownership原语写入，可信同步器按白名单更新私有镜像；Vite固定配方监听私有Unix socket，浏览器只能经可信loopback入口。

- 不加载项目Vite/PostCSS配置、`.env`、自定义插件、任意启动脚本或用户依赖；缓存与派生产物在镜像内。受管同步不是任意框架预览交付，也不是恶意同UID进程的OS沙箱。
- broker仅转发明确HTTP/WS头；剥离Cookie/Authorization/响应Set-Cookie，拒绝重定向、敏感路径及不合法WS Origin；Vite WS走相同UDS，无直连TCP回退。
- `preview-managed-3.json`含10项局部检查：配方写入边界、无项目配置/env、HTTP策略、真实101 WS握手且凭据被剥离/坏Origin403、端口冲突、抢锁失败恢复、真实Pi＋Vite同时工作、API401/WS403伪造重放、重启、在途写入时关闭。
- 在途关闭后逐一确认所有child及其进程组退出、所有服务关闭，再重新获取/释放项目锁证明可复用。源锁的竞争者仍是同进程的第二次真实acquire，不冒充第二个独立Agent生命周期实验。单次最终运行为6次仅本机Provider请求；先前两次运行各4次，均保留报告。
- 重放尝试使用非Host的合成cookie，Host真实fixture cookie仅用于入口剥离检查；child确实未收到Host cookie。浏览器配对链尚未复验，不能把服务端请求当作浏览器证明。

独立只读复核发现busy复位、提前退出进程组漏查、停止未等在途操作、检查ID被请求ID覆盖及未实际握手的证据缺口，主代理已修复并重跑。若leader已退出但进程组仍在，不盲杀未知进程，而失败并保留证据；未声明这类故障已自动清理。原测试issuer无需认证转发fixture cookie的端口已移除，后续浏览器须通过私有控制socket获得一次性pair入口，再走原Host `/pair`。

**仍未验收**：Ego实际同IP配对访问、localhost对比、浏览器持续热更新延迟、页面重连和更完整的异常回收矩阵。G0-05保留原FAIL，不能用局部成功覆盖历史负例。

上轮空间11已关闭，本次真实恢复命令返回`task space not found: 11`。按ego-browser Skill“Spaces, rounds, and pages”中的“if it cannot continue, stop and ask the user”，已发卡片询问新建专用空间，尚未收到答复；未擅自创建或改用其他浏览器。此门槛仅影响B层，资源与解析的独立工作仍在推进。

### U0-04及下一步

`documents-3/4/5/6/7.json`逐步补到39项，最后精确错误断言后的Node24结果在`parser-package-3.json`指向的`extracted-documents.json`；Node22最终为`documents-node22-2.json`。图片11项为`images-1.json`/`images-node22-1.json`；公开Office四项为`office-corpus-4.json`/`office-corpus-node22-1.json`。细节与缺口见[解析研究](2026-09-26-webui-u0-parser-study.md)。

已补嵌套表格坐标、工作表名/声明顺序、幻灯片声明顺序、关系越界负例、空/富文本shared strings、真实2MiB文本与20MiB输入负例；3种图片使用已打包Photon真解码。完整公开Office包来自python-docx/ExcelJS/python-pptx，附固定commit、SHA-256、MIT许可与自报生成器，不用私人材料，不安装Office应用。

独立解析资源包35,134,944字节/592文件解包摘要一致，Node24干净目录加载后39项通过；5项依赖许可完整。saxes发布包缺LICENSE的首次失败及补上游notice后通过记录保留。独立复核又发现缓存只核字节数、负例错误匹配过宽及“离线”字段无网络测量，已补固定SHA-256/精确错误并改为`offlineAcceptance: NOT_RUN`；不把干净目录运行当真正断网。Full发行清单/SBOM/其余生产最大预算仍缺，G0-03不标PASS。

下一步：继续补U0-04的完整语料与适配；新Ego空间获答后重启独立预览夹具，补U0-06页面链。没有进入U1，也没有自动修改日常安装、全局配置或收费Provider预算。

### 本次收尾核对

- `baseline-final-2.json`：1232个原有源码仍与H一致，S0八项证据有效；日常active不变，用户Glacier文档+8行保留，按OMP路径/进程名筛查无匹配运行进程。
- `static-final-2.json`：12个U0探针语法、6份文档39个本地链接、`git diff --check`通过。旧失败报告不覆盖，新增报告都用独立文件名。
- 本次预览三轮均停止，最终轮明确所有child进程组退出与项目锁可重新获取；所有解析/图片worker报告退出。没有创建新Ego空间，没有运行收费Provider、提交、发布、删除用户数据、修改根依赖或全局配置。
- U0-04与U0-06仍未验收，后续生产/安装与浏览器门禁不能用上述局部检查代替。
- 最后`df -h`仅约2.5GiB可用，低于本次早期的4.8GiB；未查证全部空间变化的归因，不把它全部归咎于本轮探针。未启动Full构建或擅自清理，下一次发行包工作前须重新核对峰值空间预算。

## 2026-09-29：新空间浏览器复验

用户授权新建后，Ego空间25实际完成配对、两种hostname、20次热更新、自动重连与执行中关闭；浏览器子集PASS，P95为131ms、最大324ms。凭据未到达Vite后端，API401/WS403重放负例通过，全部child/进程组退出、锁可复用。已结束空间25，无待浏览器授权事项。

完整证据、精确范围及剩余故障注入见[本轮验收记录](2026-09-29-webui-u0-preview-browser-acceptance.md)。本轮未修改代码或日常安装，G0-05不从正常关闭推断异常残留也通过，U0仍4/6。当前仓库在`LOCAL_WORKSPACE/repo`，外置卷本轮检查约837GiB可用；旧2.5GiB记录不代表当前构建卷空间。

## 2026-09-29续推：异常矩阵收口

`faults-0929-rFWaKo/faults-2.json`11条局部检查全部通过，新增真实Vite组强制退出→503→恢复、leader退出而同组leaf残留时拒绝重启/不误杀、跨故障保锁、显式核对后恢复。`driver-2.json`记录主进程退出0；全部child/组退出、服务关闭、锁可重新取得。两轮8次本机合成Provider请求，外部0。独立只读复核指出首轮锁时序与驱动退出证据不足，已补并复跑，不覆盖首轮。

合并上轮未改变的浏览器路径证据，G0-05固定配方技术可行性PASS，U0-06已验收，当前5/6、13/44。边界与U5后续责任见[收口记录](2026-09-29-webui-u0-preview-fault-acceptance.md)。下一步仅剩U0-04解析门禁，不提前进入U1。

## 2026-09-29续推：解析容量与断网

新增文档真实容量10项与worker级系统断网，Node22/24通过；保留首次将RSS监控也放进沙箱导致EPERM的失败。图片真实40MP载荷发现PNG两版本、WebP Node22超512MiB；已移除测试阶段全图RGBA导出复制，但失败未全部解决。G0-03由未完整运行更新为FAIL，U0仍5/6。实验修改、完整数据与下一项见[解析验收记录](2026-09-29-webui-u0-parser-capacity-acceptance.md)。未构建不含新依赖的旧Full包来冒充验收，未切日常安装或调整容量目标。

## 09-29图片解码定位与归一化候选

阶段RSS证明Photon在解码完成、不导出原图RGBA时PNG/WebP worker已超512MiB。隔离Sharp 0.35.5候选将同一40MP输入缩放到2048长边，Node22/24各6项PASS，最大430608KiB；全输出摘要及输入前后SHA-256均核对。全尺寸raw/stats失败与透明像素量化期望修正记录保留。Photon原小回归Node24仍11 PASS。

只读复核后补强原件不变证明，未替换生产路径或根依赖。2048为实验值，非静默冻结的产品限制；候选兼容性/质量与原件派生图合同/native许可和Full闭包仍待验收，G0-03保留FAIL、U0仍5/6。详细数据与下一步见[图片内存研究](2026-09-29-webui-u0-image-memory-study.md)。

## 09-29图片兼容性与实际发送PNG

新增候选模块与37项探针，Node22/24各37 PASS（23正常、14预期拒绝）。EXIF2–8独立全像素映射，透明/16位/灰度/渐进/CMYK等编码与真实40MP样例处理通过；所有正常派生PNG经实际Pi公开resize/read入口字节不变、原件摘要不变。最大worker RSS分别415040/421440KiB，门槛仍512MiB。首轮动画相同帧被合并的夹具错误及后续真实两帧验证保留。

资源包129条、19723222字节逐条解压身份一致，两Node断网实际连接EPERM且模块加载成功；只精确允许npm的semver相对链接。许可与Full总状态仍PARTIAL，libvips第三方文本/来源缺口列明。原件/发送预览及历史快照合同已写；没有RPC/收费模型/产品页面或日常安装晋升。独立只读复核后补录包加载参数与身份。详细结果、局限与下一项见[候选验收](2026-09-29-webui-u0-image-compat-acceptance.md)。U0仍5/6、13/44。

## 09-29文档部分解析与Full接入准备

文档初增19项：DOCX已引用外围正文、来源/标题样式原始值、共享预算及外部/越界/缺失关系负例；PPTX表格坐标、合并/备注等提示；XLSX缓存与对象提示；混合空页/表/幻灯片与Strict文字子集。结果加入版本化ready/partial、warnings及coverage；不把“无已检测遗漏”写成“完整文档”。只读复核后另增9项，实际复现6个失败断言并修补连字符/注音/共享公式及预算/PPTX默认属性误报，Strict断言全部预期文字。最终Node22/24各67项回归及10项真实容量PASS，worker/沙箱/后代网络拒绝均实测；公开Office4项无回归，补完整blocks/status/warnings/coverage留证。

原生来源采集13份公开metadata/固定源码文件，7份Git blob核验；28项版本与本地精确匹配，libnsgif vendored许可原文已保存。第一次错误假定notice路径的FAIL保留；根据实际tree修正后报告PARTIAL。复核发现一项仅观察而未断言，已补三类已知浮动输入断言、三个文件要求、固定libvips commit及探针hash，最终native-provenance-3仍PARTIAL。完整第三方许可、最终Rust lock/patch/source对应材料仍缺，不提供法律合规完成结论。

新增[本批验收记录](2026-09-29-webui-u0-document-coverage-acceptance.md)与[Full接入F01–F06清单](2026-09-29-webui-u0-parser-full-integration.md)，明确release-stack、app内部资源树、acquisition/ledger/SBOM/许可/最终内容检查与隔离Full安装连接面。未改发布代码/根依赖/active；U0仍5/6、13/44。下一步按清单继续资源合同/材料和隔离staging准备，另补批次预算、PDF流/加密等门禁，不提前进入U1。

本批`document-coverage-0929-YY1PVt/static-final.json`：三份探针双Node语法、当前源码与最终运行报告摘要、13份native来源/7个Git blob、7份文档66个本地链接、diff空白检查PASS；用户Glacier审计原有+8/-0保留。解析worker无残留，旧FAIL与初轮报告不覆盖；不把PARTIAL来源报告或静态检查升级为Full通过。

## 09-29固定资源合同与隔离app注入

F01合同、精确locks及saxes补充文本已落盘，实际资源包含文档592文件＋38目录、图片128文件＋23目录＋1精确相对链接；共54858166字节，完整树与原资源档案摘要重验。新增release-stack注入helper仅接受U0_REHEARSAL，默认发行链未接线；目标已存在、越界/重定向、未知链接、平台/版本/上限/摘要漂移均拒绝。复制及最终回验失败只清理本次新建目标。

独立复核发现入口预检查发生在写入后、失败路径进程组检查不足及“根依赖未变”表述过宽；已补写入前检查、受管子进程组TERM/KILL/退出核对与故障测试，证据只称根依赖声明/lock未变。最终双Node各32项相关测试PASS。`resource-integration-6jwdkc/integration.json`技术准备9组PASS，从app重打包解压后的依赖运行各68项回归（67＋网络负例）、11项容量（10＋网络负例）和37项图片互操作PASS；各6次记入运行回执的进程组均退出。初轮`resource-integration-PuEOfA`保留、不用它替代补强后的最终结果。

app基底仍为H旧源码cb27c6a9，保留旧身份，不登记当前工作树的新Full或stackId。完整许可/source、acquisition/双SBOM/notices/最终发行内容/Full安装与剩余解析边界仍缺，总报告PARTIAL，U0仍5/6、13/44。下一项F02材料，再F04默认发行接入；详见[本批验收](2026-09-29-webui-u0-resource-integration-acceptance.md)。未改日常指针、用户Glacier+8行、凭据或收费预算。

## 09-29真实npm获取、Saxes来源与PDF资产

F02本批从精确registry URL取得11个实际包，压缩合计17306428字节；完整包文件/目录/可执行标记与F01资源一致（不是全部权限位）。固定Saxes6.0.0 LICENSE commit/blob及3011字节原文一致；保留混合许可资产映射，不给pdfjs所有资产套主包Apache标签。354资产中196已映射/158未解决，两Node实际检查168 CMaps与8 MPL SVG头部通过。native release/run metadata已归档，当前公开artifacts集合0；未下载release workspace，完整29库材料、patch/最终Rust lock和二进制源码对应仍缺。

新增9个定向用例，最终获取9＋既有acquisition5＋资源13＋pack4，两Node显式串行矩阵各31/31通过；实际获取材料只读重验一致、网络请求0。此前一次Node24 owned-group断言失败30/31保留；新组诊断9/9及最终通过尚未解释原失败，状态OPEN，未改旧runner/test或放宽回收断言。头部首轮XML注释续行匹配FAIL也保留，按实际格式修正后通过。

新[验收记录](2026-09-29-webui-u0-acquisition-acceptance.md)包含成功/失败/诊断与最终矩阵链接。复用既有下载/安全解包链；未改根依赖、默认stager/assembler/SBOM、日常指针或用户审计追加，未收费调用或清理旧产物。F02仍PARTIAL，G0-03仍FAIL，U0仍5/6、13/44。下一项先补F02精确native/PDF材料并定位一次进程组失败，再F04–F06；不进入U1或Electron。

## 09-29固定来源材料与进程回收补强

本批给PDF158项待审资产建立固定commit/blob到实际F01字节的对应，全部通过，共80个源路径；QuickJS固定README和复制入口原文保存并断言，不把JS MIT说明升级成WASM或完整构建闭包。native三库5份许可全文＋初始Cargo.lock已保存且Git blob一致，PR383两份固定提交patch只标候选，不冒称恢复该run实际输入。最终探针17 GET/534251字节、5条检查，总PARTIAL；两Node对17份材料/158项实际字节只读复验通过、fetch调用0。

新增墙钟前跳负例在补丁前捕获实际EPERM/组未确认消失，原始失败保留；runner改用单调时间、原窗口内未知复查、有界trace，发信号前未知仍拒绝，持续EPERM仍失败。成功leader探测异常补统一detail及安全清理。新增6项回收回归和8项来源回归，最终每Node45/45；真实无注入新组各9/9确认消失，未捕获自然EPERM。旧30/31回执缺PGID/detail，归因仍OPEN_UNATTRIBUTED，不冒称已经复原原因。

四个探子均默认角色/fork_turns=none、只读单轮、等待终态后由主代理补丁/核验；复核指出的未知组、分组交换、复制入口断言与常量状态声明缺口已补。历史原报告、首轮材料与调用引号错误全部保留。详见[最新验收](2026-09-29-webui-u0-source-and-cleanup-acceptance.md)及[Task看板](2026-09-26-webui-optimization-tasks.md)。许可/完整对应源码/最终Rust lock等仍缺；本批没有前端、Full、日常安装、收费模型或清理晋升，U0仍5/6、13/44，下一项继续F02精确材料。

## 09-29续推：25个native固定源pin与历史可得性

新增有界材料配方/helper/probe及12项回归。主采集25个官方源身份确认、24个git受管组退出，59 GET/616375响应字节；保存47份原文（36许可、2作者、5源文件样本、3选择声明、1链接目标），另四份AOM/WebP材料503留证。只覆盖23个新增库的主要许可文本，不升级为全部29库义务完成。五个探子单轮只读/默认/fork_turns=none，终态后由主代理实施验证；没有追派。

run精确commit/attempt与Darwin job success、当前artifact完整空页、logs匿名403和固定workflow只上传tar.gz/保留1天均取得原文；不把匿名无法下载当全球不存在，不拿初始lock/候选patch冒充历史输入。原Gitiles预查一次200未存原文、最终503，也不算已采集。收口加强UTF-8/高位字节解码拒绝，原采集代码与最终代码分列；真实成功Gitiles解码NOT_RUN，仅合成路径测试。

Node22/24最终各20/20（12新＋8源绑定），三文件语法通过；各重算59响应/47原文/25pin与F01整树，fetch0、24旧git组确认不存在。受监测release文件、根依赖声明/lock、Glacier+8/-0及日常指针未变。没有新库安装/构建/Full/收费/页面或清理。最新[材料验收](2026-09-29-webui-u0-native-materials-acceptance.md)记录精确缺口与三路线成本/前置；继续F02的PDF/版权独立材料及可核验重建前置，不无限复跑日志或静默替换候选。U0仍5/6、13/44，G0-03仍FAIL。

## 09-29续推：PDF全资产字节与构建输入分层

新增196项资产＋10附带许可文本到固定PDF源树的长度/Git blob/F01 SHA-256对应，202个源路径；与未变化前批158绑定/同F01合并，354资产覆盖闭合，不称本批重跑旧158。保存33份原文：9固定PDF说明/生成脚本、9历史QuickJS builder候选、1声明的QuickJS源LICENSE、14其他builder参考blob。QuickJS最近资产更新声明revision已确认，但实际builder/历史镜像/编译器仍UNVERIFIED；qcms参考Docker不复制lock且cargo update，参考仓库lock不当作实际版本。

ICC README给出精确更上游revision，原件8464字节与F01一致，CC0源文本6552字节保存；PDF附带文本多一个尾随LF。大写LICENSE的404留证，固定根定位到小写license后取文，不覆盖旧失败或断言上游无许可。字体README确认Liberation1.07.4/GPLv2加两个例外，不能按现代OFL或嵌入豁免覆盖所有分发；Foxit提取commit与CMap原始生成输入仍缺。

Node22/24各20/20（新PDF12＋旧绑定8）、三文件语法PASS；各重算本轮51留存响应/541782字节、33主原文＋2补充材料及196/10绑定。局部重放33次fetch替身、外部fetch0，不是OS断网Full。10个定向验证受管组及主采集组均退出；原执行/最终代码摘要分开。三个探子只读单轮/默认/fork_turns=none，终态后主代理实施验证。完整记录见[本批验收](2026-09-29-webui-u0-pdf-inputs-acceptance.md)。

资源/受监测release文件、根依赖声明/lock、Glacier+8/-0与日常指针未变；空间835GiB可用。未安装/构建/换资源、前端/页面/Provider/Full、清理或晋升。U0仍5/6、13/44，F02 PARTIAL/G0-03 FAIL；下一项有界补native四份503/逐文件版权与固定重建输入，不重复354字节或25库tag、不无限复跑历史API/猜填builder/lock，再依门禁推进F04–F06。

## 09-29续推：真实PDF边界、批次先验与四份原文补齐

先用真实Standard R2/V1加密PDF复现两项失败：普通密码返回不稳定错误码，空用户密码可直接输出正文。保留红灯报告后，用PDFJS实际加密元数据及PasswordException在取页文本前统一拒绝，不用字符串搜索或权限字段猜测。新增真实zlib Flate流；10个独立文件、有效PDF合计恰好50MiB通过；11项、50MiB加1字节、单项20MiB加1、空批次及旧格式在任何解析器调用前失败且不输出正文。仅为文档PoC，混合材料与生产内容快照仍在U2，不提供产品密码输入接口。

最终Node22/24各96项文档检查（68回归＋11容量＋17边界）通过；另外联网基线与沙箱后代拒绝分别通过。总体最大采样RSS分别412032/407968KiB，低于512MiB；采样不等于内核硬限额，PDF累计解压字节200MiB预算尚未实现。原F01解析器摘要与本批已变代码不同，不能拿旧F01/F03重打包验收冒充当前Full。

四份AOM/WebP文本先经原Gitiles路径再次503留证，再用同一官方仓库固定提交的浅层过滤Git取得；长度、Git blob及SHA-256绑定，共9949字节。14个Git受管组与两个最终解析矩阵组均确认消失。不是对应二进制完整源码或最终lock证明，也不改写旧失败/材料快照。

主代理实施和核验，三个默认角色/fork_turns=none探子只读单轮且终态后收敛，没有追派。记录见[本批验收](2026-09-29-webui-u0-parser-boundaries-acceptance.md)与两份新审阅JSON。未接默认发行链/安装/日常active、未动用户Glacier+8/-0、未收费或清理。U0仍5/6、13/44，F02 PARTIAL、G0-03 FAIL、Full NOT_RUN；下一项是已发卡片的发行门禁路线选择，未经答复不改变阶段出口或提前U1/Electron。

## 09-29用户选择后：PDF累计预算与U0技术收口

用户确认发行材料/Full移至U2前，PDF预算仍在U0补齐。已同步[顺序记录](2026-09-29-webui-parser-gate-adjustment.md)、总计划、Task、验收与F01–F06依赖，新增G2-00强制U2入口，不删除发行工作或改旧报告。

固定PDFJS worker SHA验证后在实验目录生成26锚点预算副本；所有过滤阶段实际输出累加，缓存/容量/拼接不重复计数，native失败后的JS新产出继续收费；独立不可逆latch在metadata/每页/catch/destroy完成后核对。同步及native输出用RAB降低复制峰值；上限仍200MiB/30秒/512MiB采样。首轮单流RSS/Node22 Brotli期望失败和第三轮共享引用夹具误判保留；按实际上游与Node路径修正，非放宽预算。

两个默认/fork_turns=none探子只读单轮核查计数与覆盖，主代理等待终态后补合法Filter数组、单页native200MiB、串行两文档、共享对象重新解码、native负例路径与control销毁后再回执。最终双Node各152项（68回归＋11容量＋17边界＋56预算）系统断网检查PASS，另各4个已缓存公开Office样本PASS、fetch0。最大worker采样RSS为392512/435200KiB，受管组均确认退出；不把此数值当硬内核上限。

`pdf-budget-0929-Etg8Xj/baseline.json`再次核对1232原有源码与S0 H一致，八项旧S0有效，日常active和用户审计+8/-0及摘要保留。原设计/SDK/资源/固定预览PoC复用未变化的范围证据；图片/浏览器本批未重跑，旧预览总PARTIAL不升级成产品通过。完整[收口记录](2026-09-29-webui-u0-pdf-budget-acceptance.md)与[新身份审阅](../evidence/2026-10-18-local-development-history.md#local-4668305eeffd23cf)记录源码/派生worker/报告摘要和局限。

**当前6/6、14/44，G0-03技术PASS；G2-00整体NOT_RUN、F02/F03 PARTIAL、Full NOT_RUN。** 下一批U1-01持久草稿/输入/队列存储及恢复，逐Task验收。没有生产附件/API/RPC、Full、日常晋升、收费模型、全局配置、提交/公开发布、删除或浏览器空间替换；U6全部WebUI日常验收后才Electron。旧回收归因OPEN_UNATTRIBUTED保留。
