# [G2-00-02] 汇总并核验新的完整 native 材料 kit

## Parent

规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)。需求：US-005、US-010、US-011，并遵守 US-001–US-004 的共同约束。出口：G2-00 下 F02 的 native 材料子集；本工单通过不等于整体 F02/G2-00、Full 或 U2 通过。

## What to build

把已验收材料及前三张工单结果纳入全新的 native 材料 kit，完成固定 source/patch/tool/lock/vendor、生成输入及分发材料的总对账。维护者能用明确的新 kit 身份复验完整输入，判断 G2-00-02 的材料出口是否满足，然后进入原定 PDF 闭包步骤。

## Acceptance criteria

- [ ] [#20](https://github.com/Ricardo121380/only-my-pi/issues/20)、[#21](https://github.com/Ricardo121380/only-my-pi/issues/21)、[#22](https://github.com/Ricardo121380/only-my-pi/issues/22) 各自满足本次修订后的材料切片关闭条件。当前必需材料/操作条件的缺口仍阻断；后续构建/分发/Full 义务逐项携带到对应 Gate，不要求先取得后续阶段运行结果。
- [ ] 保留原 locale kit、原 353 vendor kit 及各批 supplement；新集合使用独立输出、新清单和新 kit 身份，不覆写旧证据或将 supplementId 当 kitId/stackId。
- [ ] 新 kit 纳入与当前候选对应的完整源树/子模块、补丁、固定工具输入、lock、347 完整 vendor 包、locale path override 及已审阅兼容 overlay，并纳入新候选实际采用的完整生成输入、输出和必要文本；新旧材料对应与替换记录齐全，旧生成物及历史报告独立保留；overlay 身份与输入 kit 一并绑定；不截断 vendor/源树或默认为未入目标图的分发材料免责。
- [ ] 对新 kit 完整文件集合实际复核字节、摘要、执行位和清单闭包；只核选中 28/437 文件或旧 inventory 摘要不能记为 whole-kit rehash。
- [ ] 生成输入、来源与条件账本逐项链接正确原文/候选身份；核验所有当前材料与 kit 汇总条件，并完整交接 G2-00-04/05/06 的后续义务。保留不同许可证/例外的范围，当前必需条件缺失不能靠 SPDX 字符串或日后补证放行；完整许可状态单列。
- [ ] 新 kit 的实际有界离线验证与缺材料/漂移/错误用途/输入输出别名负例通过；记录环境、代码及输入身份，保留所有失败和前批保护结果。
- [ ] 出口报告明确 native 材料范围的通过项及限制。只有 G2-00-02 所需材料全部闭合才记本内部项完成；F02 总体还需 G2-00-03 等后续工作，不预写整体 G2-00 PASS。
- [ ] 下一项明确为 G2-00-03；不继承旧 dylib 的图片/实际 Pi/RSS 验收，也不启动 U2、Full、日常晋升或真实 Provider。

## 阶段关闭边界

本工单汇总前三项已验收的新材料候选，完整复核当前源树与实际采用的生成输入/输出。每项当前条件和后续义务都绑定对象、原文、拟用途、证据状态及负责 Gate；当前必需条件未满足仍阻断。应用构建及其条件证据由 G2-00-04，最终包/默认发行及分发履行由 G2-00-05，Full/发行核对由 G2-00-06 完成；这些待验项不会被材料出口的 PASS 覆盖。

## Blocked by

- [#20：闭合 libexif 文档生成链的剩余材料](https://github.com/Ricardo121380/only-my-pi/issues/20)
- [#21：闭合 GIR 供应与加工链及手册引文](https://github.com/Ricardo121380/only-my-pi/issues/21)
- [#22：闭合其余生成输入及工具分发条件](https://github.com/Ricardo121380/only-my-pi/issues/22)

以上三项全部满足关闭条件后，本工单才进入可执行前沿。

## 验证与范围

相关 C/静态合同检查、完整集合核验及实际本地材料探针。本工单核验 native 材料 kit；实际 native 应用编译和新 binary/资源合同身份由 G2-00-04 负责，默认发行/Full 由 G2-00-05/06 负责。

2026-10-02 修订只更新已确认路线和验收设计，未新增生成或运行证据。本工单当前仍为 BLOCKED，新 kit NOT_CREATED，保持 OPEN；整体 G2-00/Full/U2 未放行。

## 计划、ADR 与证据

原编号 G2-00-02；依据 2026-09-30 native 源码进展/G2 内部顺序、2026-10-01 各材料 supplement、前三张新证据及 ADR-0017。公开需求与验收来源为[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)；原报告和材料的本地对应链接见本批任务映射。近期源码/证据未上传，发布时不制造远程文件链接。
