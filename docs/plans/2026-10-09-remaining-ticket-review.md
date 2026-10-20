# 全部剩余任务的已发布工单与映射

日期：2026-10-09。状态：**PUBLISHED_VERIFIED**。用户回复“确认”后，已将获批的 38 张工单发布为 [#24](https://github.com/Ricardo121380/only-my-pi/issues/24)–[#61](https://github.com/Ricardo121380/only-my-pi/issues/61)，并回读正文、标题、ready-for-agent 标签和全部原生 blocked-by。to-spec 已完成，[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)在本次工单发布期间保持不变。

冻结规格正文 SHA-256：e87eb4718089ef7f8142fdfc5610b672d2ccc3b57c8e31bddec10274bc05905c。本轮先完成规格发布，再准备工单；to-tickets 阶段保持父规格不变。

保留既有 #20–#23，新增 38 张（G2 5、U2 10、U3 6、U4 5、U5 7、U6 5），合计 42 张剩余实施工单。覆盖 G2-00-02–06 五个内部步骤与 U2–U6 二十四个产品 Task；产品状态仍为 20/44。工单数量与产品 Task 分母不同。

10 月 7 日的五张 G2 稿保留原件；本轮沿用 G2-N01–N05 身份与依赖，现已实际发布为 #24–#28。新增工单全部 OPEN、ready-for-agent、未认领，标签不豁免前置。#20–#22 PARTIAL、#23 BLOCKED；当前可实施入口仍为 #20（#21/#22 可独立推进）。

## 拆分原则与依赖

- 每张从真实输入到可观察结果，包含必需持久化、公开入口、页面或真实产物与验证；不按数据库/API/UI/测试横向拆层。
- 四种文档分别形成端到端切片；PDF 首片同时承载共享有界文档入口，其他三格式因此直接依赖该片，不要求 Office 格式彼此串行。
- 文本首片即提供发送冻结与回执一致性；批量、快照管理再扩展相应完整用户动作，不延后安全及数据一致性底线。
- 历史组织拆项目分区与会话元数据；全文搜索先提供正确查询/定位及陈旧失效，再补增量、重建与恢复。
- 用量先形成可读回的请求事实与任务/会话汇总，再覆盖主子 Agent/分支归属；未知/零值/价格/缓存要求从首片保持。
- 资源先查看实际来源，再完成下一 worker 的启停/覆盖与 Schema 配置；预览首片即具备凭据隔离、停止和未知残留阻断，恢复片补完整故障处置。
- 保留已确认 U2 → U3 → U4 → U5 → U6 的阶段门禁。阶段边属于已确认产品验收顺序；同阶段仅列直接前置，传递依赖不重复铺设。
- 每个原 Task 只有全部映射子项满足后才关闭；拆分不使未完成 Gate 获得 PASS。工单完成前复核最新源码、输入和实际操作条件。

## 新工单完整列表

1. **[G2-N01 / #24](https://github.com/Ricardo121380/only-my-pi/issues/24)：闭合 PDF 资源的来源与构建材料**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/01-g2-n01.md)）  
   **Blocked by：[#23](https://github.com/Ricardo121380/only-my-pi/issues/23)。** 原 Task：G2-00-03；Gate：F02；证据：C。  
   **交付：** 维护者能从一组身份明确、实际取得的来源和构建输入，核对当前 PDF 字体、CMap、worker、WASM、辅助模块与 QuickJS 资源的生成来路、完整材料和适用条件，形成可交给新资源构建的独立 PDF 材料候选。保留已有字节对应、历史未知和失败；需要新生成时以新身份接受验收。

2. **[G2-N02 / #25](https://github.com/Ricardo121380/only-my-pi/issues/25)：从固定材料生成可运行的 native 构建候选**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/02-g2-n02.md)）  
   **Blocked by：[G2-N01 / #24](https://github.com/Ricardo121380/only-my-pi/issues/24)。** 原 Task：G2-00-04；Gate：F02；证据：C。  
   **交付：** 维护者能以已核验的新 native kit 和固定构建环境，执行实际配置、编译及链接，得到具有独立身份且可实际加载使用的 macOS arm64 native 产物。构建输入、最终锁、补丁和生成结果可以互相核对，不依赖旧 dylib、开发机隐含依赖或未绑定的工具。

3. **[G2-N03 / #26](https://github.com/Ricardo121380/only-my-pi/issues/26)：形成新图片与文档资源候选并通过运行矩阵**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/03-g2-n03.md)）  
   **Blocked by：[G2-N02 / #25](https://github.com/Ricardo121380/only-my-pi/issues/25)。** 原 Task：G2-00-04；Gate：F01、F02；证据：C/P。  
   **交付：** 维护者能把已实际构建的新 native 产物、已闭合的 PDF 构建材料、当前有界解析 worker 和辅助模块组成完整图片/文档资源候选，在隔离副本中真实加载并核对功能、预算和 Pi 互操作，获得可交给默认发行链的资源身份。

4. **[G2-N04 / #27](https://github.com/Ricardo121380/only-my-pi/issues/27)：让默认发行包完整携带 parser 资源与元数据**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/04-g2-n04.md)）  
   **Blocked by：[G2-N03 / #26](https://github.com/Ricardo121380/only-my-pi/issues/26)。** 原 Task：G2-00-05；Gate：F03、F04；证据：C。  
   **交付：** 维护者使用正常的受控发行准备与组装入口，就能从已验收的 parser 候选得到完整 app 包及对应获取台账、两种 SBOM 和 notices。无需手工注入、复制开发目录或依赖演练用途；丢失资源、声明或身份不一致时，正常流程明确失败。

5. **[G2-N05 / #28](https://github.com/Ricardo121380/only-my-pi/issues/28)：验证隔离 Full 并完成 G2-00 入口验收**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/05-g2-n05.md)）  
   **Blocked by：[G2-N04 / #27](https://github.com/Ricardo121380/only-my-pi/issues/27)。** 原 Task：G2-00-06；Gate：F05、F06、G2-00；证据：C/P/I。  
   **交付：** 维护者能从已核验的默认发行产物建立身份一致的隔离 Full，在真实禁网、无开发依赖回退的环境中安装并运行完整图片/文档能力，核对安装、回滚、重新应用和全部发行前置，明确是否可以开始 U2 产品集成。

6. **[U2-N01 / #29](https://github.com/Ricardo121380/only-my-pi/issues/29)：上传文本材料并冻结后发送给真实 Pi**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/06-u2-n01.md)）  
   **Blocked by：[G2-N05 / #28](https://github.com/Ricardo121380/only-my-pi/issues/28)。** 原 Task：U2-01；Gate：G2-01、G2-04；证据：C/P/B。  
   **交付：** 用户从页面显式上传一个文本文件，看到准备结果和来源，随正文发送后能在真实 Pi 请求与历史中核对同一份冻结内容；页面刷新仍保留未发送材料。

7. **[U2-N02 / #30](https://github.com/Ricardo121380/only-my-pi/issues/30)：完成批量材料准备、配额与中断恢复**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/07-u2-n02.md)）  
   **Blocked by：[U2-N01 / #29](https://github.com/Ricardo121380/only-my-pi/issues/29)。** 原 Task：U2-01；Gate：G2-01、G2-04；证据：C/P/B。  
   **交付：** 用户一次准备多个文本材料，看到每项和整组状态；只有符合配额且准备完整的集合可以提交，中断后能明确恢复或移除。

8. **[U2-N03 / #31](https://github.com/Ricardo121380/only-my-pi/issues/31)：引用项目文件和代码选区并核对发送范围**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/08-u2-n03.md)）  
   **Blocked by：[U2-N02 / #30](https://github.com/Ricardo121380/only-my-pi/issues/30)。** 原 Task：U2-02；Gate：G2-01、G2-04；证据：C/P/B。  
   **交付：** 用户用 @文件或编辑器代码选区生成材料卡片，检查来源和范围后发送；文件变化时由用户确认新版本或使用已冻结版本。

9. **[U2-N04 / #32](https://github.com/Ricardo121380/only-my-pi/issues/32)：粘贴或拖入图片并通过真实 Pi 发送**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/09-u2-n04.md)）  
   **Blocked by：[U2-N02 / #30](https://github.com/Ricardo121380/only-my-pi/issues/30)。** 原 Task：U2-03；Gate：G2-02、G2-04；证据：C/P/B。  
   **交付：** 用户粘贴或拖入 PNG、JPEG、WebP，看到图片、必要转换与限制说明，发送后模型实际收到与卡片一致的图片内容。

10. **[U2-N05 / #33](https://github.com/Ricardo121380/only-my-pi/issues/33)：选择 PDF 页并经有界解析发送**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/10-u2-n05.md)）  
   **Blocked by：[U2-N02 / #30](https://github.com/Ricardo121380/only-my-pi/issues/30)。** 原 Task：U2-04；Gate：G2-03、G2-04；证据：C/P/B。  
   **交付：** 用户上传文字 PDF，查看实际页位置和解析状态，选择页范围后把确切内容发送到 Pi；此首个文档切片同时建立共享的有界解析与材料发布接口。

11. **[U2-N06 / #34](https://github.com/Ricardo121380/only-my-pi/issues/34)：按段落和表格选择 DOCX 内容并发送**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/11-u2-n06.md)）  
   **Blocked by：[U2-N05 / #33](https://github.com/Ricardo121380/only-my-pi/issues/33)。** 原 Task：U2-04；Gate：G2-03、G2-04；证据：C/P/B。  
   **交付：** 用户上传 DOCX，按标题、段落或表格查看和选择内容，模型收到与页面范围对应的冻结文本。

12. **[U2-N07 / #35](https://github.com/Ricardo121380/only-my-pi/issues/35)：按工作表和单元格选择 XLSX 内容并发送**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/12-u2-n07.md)）  
   **Blocked by：[U2-N05 / #33](https://github.com/Ricardo121380/only-my-pi/issues/33)。** 原 Task：U2-04；Gate：G2-03、G2-04；证据：C/P/B。  
   **交付：** 用户上传 XLSX，选择工作表或单元格范围，区分公式文本和已有缓存值，并核对实际发送的表格内容。

13. **[U2-N08 / #36](https://github.com/Ricardo121380/only-my-pi/issues/36)：选择 PPTX 幻灯片内容并发送**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/13-u2-n08.md)）  
   **Blocked by：[U2-N05 / #33](https://github.com/Ricardo121380/only-my-pi/issues/33)。** 原 Task：U2-04；Gate：G2-03、G2-04；证据：C/P/B。  
   **交付：** 用户上传 PPTX，按真实幻灯片位置查看和选择可提取内容，发送后能从历史核对相同范围。

14. **[U2-N09 / #37](https://github.com/Ricardo121380/only-my-pi/issues/37)：查看发送快照并安全清理材料存储**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/14-u2-n09.md)）  
   **Blocked by：[U2-N03 / #31](https://github.com/Ricardo121380/only-my-pi/issues/31)、[U2-N04 / #32](https://github.com/Ricardo121380/only-my-pi/issues/32)、[U2-N06 / #34](https://github.com/Ricardo121380/only-my-pi/issues/34)、[U2-N07 / #35](https://github.com/Ricardo121380/only-my-pi/issues/35)、[U2-N08 / #36](https://github.com/Ricardo121380/only-my-pi/issues/36)。** 原 Task：U2-05；Gate：G2-05；证据：C/B。  
   **交付：** 用户能区分原上传、解析结果和已发送内容，查看各自空间与引用，明确确认影响后清理可删除材料，同时保留共享历史。

15. **[U2-N10 / #38](https://github.com/Ricardo121380/only-my-pi/issues/38)：验收混合材料的发送、排队与安装态旅程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/15-u2-n10.md)）  
   **Blocked by：[U2-N09 / #37](https://github.com/Ricardo121380/only-my-pi/issues/37)。** 原 Task：U2-06；Gate：G2-01、G2-02、G2-03、G2-04、G2-05、G2-06；证据：C/P/B/I。  
   **交付：** 用户在同一会话混合文本、引用、图片和四种文档，完成发送、补充、排队、刷新、重连及历史核对，安装态也能使用相同资源。

16. **[U3-N01 / #39](https://github.com/Ricardo121380/only-my-pi/issues/39)：创建项目分区并持久化项目归类**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/16-u3-n01.md)）  
   **Blocked by：[U2-N10 / #38](https://github.com/Ricardo121380/only-my-pi/issues/38)。** 原 Task：U3-01；Gate：G3-01；证据：C/B。  
   **交付：** 用户创建、重命名和排序项目分区，调整已登记项目归属，刷新或重启后仍能按相同组织方式找到项目。

17. **[U3-N02 / #40](https://github.com/Ricardo121380/only-my-pi/issues/40)：重命名、置顶、归档和恢复会话**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/17-u3-n02.md)）  
   **Blocked by：[U2-N10 / #38](https://github.com/Ricardo121380/only-my-pi/issues/38)。** 原 Task：U3-01；Gate：G3-01；证据：C/B。  
   **交付：** 用户整理会话列表，归档后仍可显式找到并恢复原会话，已有任务和执行历史保持原身份。

18. **[U3-N03 / #41](https://github.com/Ricardo121380/only-my-pi/issues/41)：全文搜索已登记历史并定位到消息**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/18-u3-n03.md)）  
   **Blocked by：[U3-N01 / #39](https://github.com/Ricardo121380/only-my-pi/issues/39)、[U3-N02 / #40](https://github.com/Ricardo121380/only-my-pi/issues/40)。** 原 Task：U3-02；Gate：G3-02；证据：C/B。  
   **交付：** 用户跨已登记项目搜索名称和用户/助手消息，查看匹配片段与来源，点击后打开准确会话和消息位置。

19. **[U3-N04 / #42](https://github.com/Ricardo121380/only-my-pi/issues/42)：增量更新、取消和重建全文索引**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/19-u3-n04.md)）  
   **Blocked by：[U3-N03 / #41](https://github.com/Ricardo121380/only-my-pi/issues/41)。** 原 Task：U3-02；Gate：G3-02；证据：C/B。  
   **交付：** 用户在持续新增历史时获得可解释的最新搜索结果，可查看进度、取消或重建索引，并识别陈旧和损坏部分。

20. **[U3-N05 / #43](https://github.com/Ricardo121380/only-my-pi/issues/43)：从停止会话的指定消息创建分支**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/20-u3-n05.md)）  
   **Blocked by：[U3-N01 / #39](https://github.com/Ricardo121380/only-my-pi/issues/39)、[U3-N02 / #40](https://github.com/Ricardo121380/only-my-pi/issues/40)。** 原 Task：U3-03；Gate：G3-03；证据：C/P/B。  
   **交付：** 用户从停止会话的有效消息创建新的编程会话，保留所选消息及之前上下文和附件来源，使用当前项目文件继续工作。

21. **[U3-N06 / #44](https://github.com/Ricardo121380/only-my-pi/issues/44)：验收搜索、续接、分支与归档完整旅程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/21-u3-n06.md)）  
   **Blocked by：[U3-N04 / #42](https://github.com/Ricardo121380/only-my-pi/issues/42)、[U3-N05 / #43](https://github.com/Ricardo121380/only-my-pi/issues/43)。** 原 Task：U3-04；Gate：G3-01、G3-02、G3-03、G3-04；证据：C/P/B。  
   **交付：** 用户从组织后的项目和历史中搜索、打开、续接、分支、归档并恢复，旧历史和缺失材料的状态都能解释。

22. **[U4-N01 / #45](https://github.com/Ricardo121380/only-my-pi/issues/45)：贯通结果摘要、统一差异与真实验证回执**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/22-u4-n01.md)）  
   **Blocked by：[U3-N06 / #44](https://github.com/Ricardo121380/only-my-pi/issues/44)。** 原 Task：U4-01；Gate：G4-01；证据：C/B。  
   **交付：** 用户能从结果摘要进入对应差异、命令和回执，分别判断执行是否结束、改动是否应用及目标工作区是否验证通过。

23. **[U4-N02 / #46](https://github.com/Ricardo121380/only-my-pi/issues/46)：按请求身份记录用量并聚合任务与会话**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/23-u4-n02.md)）  
   **Blocked by：[U3-N06 / #44](https://github.com/Ricardo121380/only-my-pi/issues/44)。** 原 Task：U4-02；Gate：G4-02、G4-03；证据：C/P/B。  
   **交付：** 用户看到有来源、可追溯的请求/工具用量及任务、会话汇总，重连或重启不会重复计数，历史估算使用请求当时的价格。

24. **[U4-N03 / #47](https://github.com/Ricardo121380/only-my-pi/issues/47)：核对主子 Agent 与分支继承的用量归属**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/24-u4-n03.md)）  
   **Blocked by：[U4-N02 / #46](https://github.com/Ricardo121380/only-my-pi/issues/46)。** 原 Task：U4-02；Gate：G4-02、G4-03；证据：C/P/B。  
   **交付：** 用户能分别查看主 Agent、子 Agent、分支继承和新消费，汇总既不漏掉受支持来源，也不重复计入历史。

25. **[U4-N04 / #48](https://github.com/Ricardo121380/only-my-pi/issues/48)：展示有来源的上下文、生成速度和费用详情**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/25-u4-n04.md)）  
   **Blocked by：[U4-N03 / #47](https://github.com/Ricardo121380/only-my-pi/issues/47)。** 原 Task：U4-03；Gate：G4-03、G4-04；证据：C/P/B。  
   **交付：** 用户在输入区看到简洁统计，展开后可解释上下文、有效生成速度、缓存、费用及覆盖范围。

26. **[U4-N05 / #49](https://github.com/Ricardo121380/only-my-pi/issues/49)：验收结果与用量的故障和分支旅程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/26-u4-n05.md)）  
   **Blocked by：[U4-N01 / #45](https://github.com/Ricardo121380/only-my-pi/issues/45)、[U4-N04 / #48](https://github.com/Ricardo121380/only-my-pi/issues/48)。** 原 Task：U4-04；Gate：G4-01、G4-02、G4-03、G4-04；证据：C/P/B。  
   **交付：** 用户在成功、失败、取消、长输出和分支会话中，仍能把结果、真实改动、验证状态和用量来源核对起来。

27. **[U5-N01 / #50](https://github.com/Ricardo121380/only-my-pi/issues/50)：查看已有资源的来源、兼容性和配置归属**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/27-u5-n01.md)）  
   **Blocked by：[U4-N05 / #49](https://github.com/Ricardo121380/only-my-pi/issues/49)。** 原 Task：U5-01；Gate：G5-01；证据：C/P/B。  
   **交付：** 用户在项目能力页查看已有技能和扩展的真实来源、必需集合、兼容性以及 GUI 默认/项目覆盖的配置归属。

28. **[U5-N02 / #51](https://github.com/Ricardo121380/only-my-pi/issues/51)：配置可选资源并在下一次执行生效**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/28-u5-n02.md)）  
   **Blocked by：[U5-N01 / #50](https://github.com/Ricardo121380/only-my-pi/issues/50)。** 原 Task：U5-01、U5-02；Gate：G5-01、G5-02；证据：C/P/B。  
   **交付：** 用户调整 GUI 默认或项目覆盖中的可选资源启停，看到待生效状态，新任务实际加载该快照，正在运行的任务保持原配置。

29. **[U5-N03 / #52](https://github.com/Ricardo121380/only-my-pi/issues/52)：编辑声明配置并处理加载失败与恢复**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/29-u5-n03.md)）  
   **Blocked by：[U5-N02 / #51](https://github.com/Ricardo121380/only-my-pi/issues/51)。** 原 Task：U5-02；Gate：G5-02；证据：C/P/B。  
   **交付：** 用户为声明配置 Schema 的已有资源编辑参数，明确看到校验、待生效、实际加载或失败，并能恢复最后有效配置。

30. **[U5-N04 / #53](https://github.com/Ricardo121380/only-my-pi/issues/53)：配置并运行具名测试和构建命令**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/30-u5-n04.md)）  
   **Blocked by：[U4-N05 / #49](https://github.com/Ricardo121380/only-my-pi/issues/49)。** 原 Task：U5-03；Gate：G5-03；证据：C/P/B。  
   **交付：** 用户保存具名项目命令并显式启动，查看真实工作目录、输出、退出码和结果；占用、取消及残留进程都有明确处理。

31. **[U5-N05 / #54](https://github.com/Ricardo121380/only-my-pi/issues/54)：让受管预览与 Agent 并行更新**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/31-u5-n05.md)）  
   **Blocked by：[U5-N04 / #53](https://github.com/Ricardo121380/only-my-pi/issues/53)。** 原 Task：U5-04；Gate：G5-04；证据：C/P/B。  
   **交付：** 用户显式启动受支持配方的受管预览，Agent 修改项目时页面持续更新，且预览不能写回源项目或取得 Host 凭据。

32. **[U5-N06 / #55](https://github.com/Ricardo121380/only-my-pi/issues/55)：恢复预览故障并核对残留进程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/32-u5-n06.md)）  
   **Blocked by：[U5-N05 / #54](https://github.com/Ricardo121380/only-my-pi/issues/54)。** 原 Task：U5-04；Gate：G5-04；证据：C/P/B。  
   **交付：** 预览崩溃、端口冲突或 Host 重启后，用户能看到真实状态并通过受控入口恢复；未知残留不会被错误接管或清理。

33. **[U5-N07 / #56](https://github.com/Ricardo121380/only-my-pi/issues/56)：验收资源配置、命令与并行预览整条旅程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/33-u5-n07.md)）  
   **Blocked by：[U5-N03 / #52](https://github.com/Ricardo121380/only-my-pi/issues/52)、[U5-N06 / #55](https://github.com/Ricardo121380/only-my-pi/issues/55)。** 原 Task：U5-05；Gate：G5-01、G5-02、G5-03、G5-04、G5-05；证据：C/P/B。  
   **交付：** 用户配置项目资源，启动实际任务、构建并查看持续预览，最后停止服务，同时保留既有终端和人工编辑能力。

34. **[U6-N01 / #57](https://github.com/Ricardo121380/only-my-pi/issues/57)：验收全部 WebUI 入口、状态和操作旅程**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/34-u6-n01.md)）  
   **Blocked by：[U5-N07 / #56](https://github.com/Ricardo121380/only-my-pi/issues/56)。** 原 Task：U6-01；Gate：G6-01；证据：B。  
   **交付：** 用户能在日常使用的窗口、主题和输入方式下完成全部已选 WebUI 功能，任何可见操作都有真实结果或明确可解释的禁用条件。

35. **[U6-N02 / #58](https://github.com/Ricardo121380/only-my-pi/issues/58)：验证固定性能样本与进程资源占用**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/35-u6-n02.md)）  
   **Blocked by：[U6-N01 / #57](https://github.com/Ricardo121380/only-my-pi/issues/57)。** 原 Task：U6-02；Gate：G6-02；证据：C/B/I。  
   **交付：** 用户在长历史、大输出、检索、解析和连续预览中仍可及时输入与取消；维护者能用固定样本复验响应与资源表现。

36. **[U6-N03 / #59](https://github.com/Ricardo121380/only-my-pi/issues/59)：验证同一 Full 候选的纯安装与数据兼容**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/36-u6-n03.md)）  
   **Blocked by：[U6-N02 / #58](https://github.com/Ricardo121380/only-my-pi/issues/58)。** 原 Task：U6-03；Gate：G6-03；证据：I/B。  
   **交付：** 用户能在不依赖开发目录的完整安装中使用已交付功能，隔离升级、回滚和重新应用后保留凭据与新历史。

37. **[U6-N04 / #60](https://github.com/Ricardo121380/only-my-pi/issues/60)：执行获准的真实 Provider 小型验收包**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/37-u6-n04.md)）  
   **Blocked by：[U6-N03 / #59](https://github.com/Ricardo121380/only-my-pi/issues/59)。** 原 Task：U6-04；Gate：G6-04；证据：L/I/B。  
   **交付：** 用户在明确批准的实际路由和预算内，验证材料续接、输入控制及修改/用量/并行预览，知道真实服务支持的范围。

38. **[U6-N05 / #61](https://github.com/Ricardo121380/only-my-pi/issues/61)：晋升日常栈并完成回滚、重应用和体验收口**（[已发布正文副本](2026-10-09-remaining-ticket-drafts/38-u6-n05.md)）  
   **Blocked by：[U6-N04 / #60](https://github.com/Ricardo121380/only-my-pi/issues/60)。** 原 Task：U6-05；Gate：G6-05；证据：I/B。  
   **交付：** 用户通过日常真实入口使用同一已验收候选，能够回滚到切换前的有效栈并重新应用，全部选定 WebUI 能力和遗留项有最终结论。

## 原 Task 到工单的映射

| 原 Task | 工单 |
| --- | --- |
| G2-00-02 | [#20](https://github.com/Ricardo121380/only-my-pi/issues/20)、[#21](https://github.com/Ricardo121380/only-my-pi/issues/21)、[#22](https://github.com/Ricardo121380/only-my-pi/issues/22)、[#23](https://github.com/Ricardo121380/only-my-pi/issues/23) |
| G2-00-03 | [G2-N01 / #24](https://github.com/Ricardo121380/only-my-pi/issues/24) |
| G2-00-04 | [G2-N02 / #25](https://github.com/Ricardo121380/only-my-pi/issues/25)、[G2-N03 / #26](https://github.com/Ricardo121380/only-my-pi/issues/26) |
| G2-00-05 | [G2-N04 / #27](https://github.com/Ricardo121380/only-my-pi/issues/27) |
| G2-00-06 | [G2-N05 / #28](https://github.com/Ricardo121380/only-my-pi/issues/28) |
| U2-01 | [U2-N01 / #29](https://github.com/Ricardo121380/only-my-pi/issues/29)、[U2-N02 / #30](https://github.com/Ricardo121380/only-my-pi/issues/30) |
| U2-02 | [U2-N03 / #31](https://github.com/Ricardo121380/only-my-pi/issues/31) |
| U2-03 | [U2-N04 / #32](https://github.com/Ricardo121380/only-my-pi/issues/32) |
| U2-04 | [U2-N05 / #33](https://github.com/Ricardo121380/only-my-pi/issues/33)、[U2-N06 / #34](https://github.com/Ricardo121380/only-my-pi/issues/34)、[U2-N07 / #35](https://github.com/Ricardo121380/only-my-pi/issues/35)、[U2-N08 / #36](https://github.com/Ricardo121380/only-my-pi/issues/36) |
| U2-05 | [U2-N09 / #37](https://github.com/Ricardo121380/only-my-pi/issues/37) |
| U2-06 | [U2-N10 / #38](https://github.com/Ricardo121380/only-my-pi/issues/38) |
| U3-01 | [U3-N01 / #39](https://github.com/Ricardo121380/only-my-pi/issues/39)、[U3-N02 / #40](https://github.com/Ricardo121380/only-my-pi/issues/40) |
| U3-02 | [U3-N03 / #41](https://github.com/Ricardo121380/only-my-pi/issues/41)、[U3-N04 / #42](https://github.com/Ricardo121380/only-my-pi/issues/42) |
| U3-03 | [U3-N05 / #43](https://github.com/Ricardo121380/only-my-pi/issues/43) |
| U3-04 | [U3-N06 / #44](https://github.com/Ricardo121380/only-my-pi/issues/44) |
| U4-01 | [U4-N01 / #45](https://github.com/Ricardo121380/only-my-pi/issues/45) |
| U4-02 | [U4-N02 / #46](https://github.com/Ricardo121380/only-my-pi/issues/46)、[U4-N03 / #47](https://github.com/Ricardo121380/only-my-pi/issues/47) |
| U4-03 | [U4-N04 / #48](https://github.com/Ricardo121380/only-my-pi/issues/48) |
| U4-04 | [U4-N05 / #49](https://github.com/Ricardo121380/only-my-pi/issues/49) |
| U5-01 | [U5-N01 / #50](https://github.com/Ricardo121380/only-my-pi/issues/50)、[U5-N02 / #51](https://github.com/Ricardo121380/only-my-pi/issues/51) |
| U5-02 | [U5-N02 / #51](https://github.com/Ricardo121380/only-my-pi/issues/51)、[U5-N03 / #52](https://github.com/Ricardo121380/only-my-pi/issues/52) |
| U5-03 | [U5-N04 / #53](https://github.com/Ricardo121380/only-my-pi/issues/53) |
| U5-04 | [U5-N05 / #54](https://github.com/Ricardo121380/only-my-pi/issues/54)、[U5-N06 / #55](https://github.com/Ricardo121380/only-my-pi/issues/55) |
| U5-05 | [U5-N07 / #56](https://github.com/Ricardo121380/only-my-pi/issues/56) |
| U6-01 | [U6-N01 / #57](https://github.com/Ricardo121380/only-my-pi/issues/57) |
| U6-02 | [U6-N02 / #58](https://github.com/Ricardo121380/only-my-pi/issues/58) |
| U6-03 | [U6-N03 / #59](https://github.com/Ricardo121380/only-my-pi/issues/59) |
| U6-04 | [U6-N04 / #60](https://github.com/Ricardo121380/only-my-pi/issues/60) |
| U6-05 | [U6-N05 / #61](https://github.com/Ricardo121380/only-my-pi/issues/61) |

## 当前代码接点与 prefactor 核验

三项单轮只读探索及主代理出处抽核覆盖材料、历史/用量、资源/预览/安装。材料探索为限定范围 PARTIAL；其余也不代表全仓穷尽或运行 PASS。

当前输入准入和 Pi 桥仍明确拒绝材料，草稿恢复按纯文本；材料 ID 类型和禁用按钮不是已接入。历史展示会截断长消息，索引不能直接沿用截断投影。用量在 message_end 累加尚未按请求去重。资源 revision 固定为零且未贯穿下一 worker。预览源码镜像与凭据 broker 主要在固定配方探针中；现存 packaged Host/PTY 检查不等于新 U6 全旅程。

没有独立广域机械 prefactor 的已证实前置。局部职责整理随实际切片先完成并保留行为回归；新增材料、配置和分支协议属于行为改动，不能伪装成机械重构。G2-N03 沿旧稿先清除验收脚本对历史绝对语料位置的隐含依赖。

## 证据与授权边界

C/P/B/I/L 沿总规格分列；页面用 Ego Lite，业务用公开 Host 与真实 Pi，材料/发行用公开 CLI、默认链及精确候选隔离 Full。P 是本地受控模型，不能替代 L。U6-N02 的隔离性能候选为取得 I 层的验证准备，不先行宣布 U6-N03 完整安装门禁通过。

G2-N01 10 月 7 日仅完成前置核验，仍 BLOCKED / 新候选 NOT_CREATED。最近全量 Node 的一项失败来自三条既有文档链接；本轮不执行产品测试或消除该运行失败，静态草稿通过也不使它变为 PASS。

真实 Provider 包、日常栈切换及具体构建/安装条件保持原边界。工单发布本身只建立工程追踪，不发收费请求、不切换 active、不公开发行软件，也不开始产品实现。

## 发布与核验记录

用户已对这 38 张具体拆分与依赖回复“确认”。按依赖顺序逐张创建后，用实际 Issue 编号补齐所有正文跨工单引用，并逐项回读远程正文、标题、OPEN 状态、ready-for-agent 标签和原生 blocked-by；38/38 一致。新增 47 条直接阻断边，保留 #23 对 #20/#21/#22 的 3 条既有边。

父规格 #19 及既有 #20–#23 的正文、标题、状态、标签与负责人保持；新增工单均未认领。批准的验收条目共 268 项，原 Task、用户故事、Gate、证据层和操作条件没有因编号回填而缩减。原获批稿与发布回执在仓库外按本次记录保留。

下一实施入口仍是 [#20](https://github.com/Ricardo121380/only-my-pi/issues/20)，#21/#22 可在独立材料范围内并行推进；全部材料收口后才验收 #23，再依次进入 #24–#28 的 G2 后续。产品仍 20/44，新增产品验收为 0。本次没有产生构建、Full、真实 Provider 或日常安装证据。

[机器可读方案与实际编号](2026-10-09-remaining-ticket-proposal.json)保存全部正文摘要、原 Task/需求/Gate 对应和原生依赖回读状态。该目录下的 38 份正文现为远程已发布副本；10 月 7 日五张草稿保持为历史来源，不作为另一组在途工单。
