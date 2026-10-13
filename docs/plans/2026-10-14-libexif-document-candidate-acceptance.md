# G2-00-02 / #20 libexif 新可复现文档材料候选

本轮依据[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)和[#20 的九条 AC](https://github.com/Ricardo121380/only-my-pi/issues/20)，只闭合独立的新 libexif 文档材料候选。固定输入、真实工具执行、双 Node 独立生成、完整输出比对、新旧逐项差异、材料兼容与实际禁网负例已通过。Standards / Spec、最终工程回归与 GitHub 关闭回读在文末分别记录，未完成时不称为工单完成。

## 入口与归属

- 原入口 HEAD `c8bb79873ce4bf4e58bbf0cc15cf6e249b67ed4d`，分支 `codex/webui-phase1`。#75 最终验收和入口归属清单已核对；按其原入口基线重建提交，只收入口之后的增量。
- #75 本地主仓收尾为 `d0f8989834d044c23b4fb8bec02a35885fb74270`，15 个文件；随后 `26ca9aeecc0dc09363ed5547056e5e4dc5cf39c9` 只修正报告中两处仓外 Markdown 链接，保留完整审查引用。该文案问题由 #20 阶段全量实测暴露，FAIL 原件保留，文档链接回归 2/2 PASS。共改 `package.json` 中原有依赖等内容留在工作区；原 301 条工作保留。三份流程入口同步，但发布历史、原失败和历史 JSON 原字节保持。
- #20 实现入口为 `d0f8989`，固定审查及提交基线为完成 #75 文案修正后的 `26ca9ae`；归属为新增候选合同、现有材料 CLI 的 `--candidate` 分支、新生成模块、公开 CLI 回归、本报告和三份当前流程入口。不将其他工作纳入提交。
- #75 的既有 C/P/B 及两轴 PASS 按原候选身份保留。本轮材料结果没有新增实际应用构建、浏览器、Full 安装或收费服务证明。

证据根：本轮目录（`../../../artifacts/issue75-closeout-issue20-20261013T144339Z/issue20/`）。#75 精确暂存与工作保留回执为上一级 `issue75-main-closeout.json`；入口副本、摘要和 patch 也完整保留。

## 固定输入、工具、配置与环境

最终输入为 `fixed-inputs-v3`，`manifest.json` 身份 **`sha256:c4a4e0e10fa003d12383b031f2c30eddc7020d851f03d9df40fab9a07a23febd`**，5,683 个文件/链接条目，另有 manifest 自身；原完整源树、vendor、归档、工具、旧补充材料、声明和来源回执均进入清单。每项绑定摘要、字节数、执行位或原相对链接文本。限定源树中的相对悬空 `graphviz.spec` 也保留，不用裁剪来避开它。

| 对象 | 固定身份与实际证据 |
| --- | --- |
| libexif | 0.6.26；既有 locale kit `sha256:4a3e418e0601374b5e072f13981fc8b9472e2aa7659846d6ccae7a6fd58c6622` 下完整 exif 268 文件，与冻结 source inventory 逐项摘要/执行位及集合一致；source inventory `sha256:893ed818deef7d1c289febe11bf3aa908ba4acfd784c0711dd8daa721963f053` |
| Doxygen | 1.16.1，commit `669aeeefca743c148e2d935b3d3c69535c7491e6`；官方 GitHub codeload 完整归档 `sha256:dbe42a65a1cd2518569645c05dc1514ad6f5f7a27845c9d9e7c045f5f3128b02`；1,227 个源码对象全部匹配；实际二进制 `sha256:6289d6c79355b49f0583aaadbf24a44afda8af8abb9e04e893fd8420dd730b37` |
| Graphviz | 14.1.2，commit `397dc2a41288a28663c87b6e03438758b2f6d029`；官方 GitLab 完整归档 `sha256:6e490f1b4c04b285af668ab300c925b380e51c2ff9584cd3bce66e6ef29eed59`；3,236 个源码对象全部匹配；实际静态 builtin `dot` 为 `sha256:6a5d4662e07c3543b286c11c3a8539695d59a2a238716c5966be9d2abe4826a8` |
| 构建依赖 | 私有目录 GNU Bison 3.8.2 完整官方归档 `sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2`；实际 Bison、CMake 4.4.2、Apple Clang 21.0.0、系统 flex 2.6.4 的版本、摘要及链接库见 `actual-tool-identities.json`。配置、编译和私有安装命令/日志逐项保留；没有全局安装 |
| 环境 | Darwin 27.0.0 / macOS 27.0 build 26A428 / arm64；固定 PATH、LC_ALL/LANG=C、TZ=UTC、SOURCE_DATE_EPOCH=1764547200；绑定 Helvetica 字体及 sandbox-exec 文件摘要，实际工具的系统链接库保留在回执中 |
| 配置 | 完整原 `doc/Doxyfile.in`、替换过程、升级回执及原配置备份保留；实际完整配置为 `materials/config/Doxyfile`，实际工具默认差异回执为 `configuration/effective-config-diff.txt`；不将旧候选历史配置标为已核 |

配置固定为 EXIF library (libexif) API / 0.6.26，INPUT 为完整根源树的 `libexif`，原递归/输入模式/提取及 treeview 条件保持。设置 HTML、SVG、单线程、无时间戳，`DOT_CLEANUP=NO` 以保留五个实际 dot 输入；maintainer footer 关闭，采用实际默认 Doxygen SVG footer。原不适用的 LATEX `a4wide` 枚举明确解析为 `a4`，LATEX 输出仍关闭。原版权、GPL 模板条件及日期修改声明保留。有效配置、完整生成命令、原 stdout/stderr 和真实退出码在每次回执中，不只按文件标记判断工具版本。

获取、提取与构建证据为 `tool-inputs/*acquisition*.json`、`acquisition-receipts.json`、HTTP headers、`tool-source-bindings.json`、`frozen-exif-readback.json`、`tool-builds/commands.json`、完整构建日志及 `actual-tool-identities.json`。完整的上游源码归档与提取树均保留。

## 实际双目录生成与完整输出

最高可行入口为既有 `scripts/probes/webui-g2-libexif-generation.mjs --candidate <absolute-inputs> <new-absolute-output>`。CLI 在写输出和执行工具前校验批准 manifest、完整文件集合、内容、执行位、目的和环境；复制到独立目录后再次验证实际被读取的内容，再执行固定 Doxygen 与 dot。结束后复核原输入和实际材料副本；拒绝覆盖已有输出或失败回执。

最终实测目录为 `generated-node22-4` 与 `generated-node24-4`。Node 22.19.0 / 24.19.0 逐字身份、源模块身份、完整命令与各自退出码见 `node22-generation-run-4.json` / `node24-generation-run-4.json`。两个目录各自执行 Doxygen，并对五个实际生成 dot 输入独立执行 Graphviz，生成原始 SVG；没有用旧结果替代生成。

最终检查：document-verification-4.json（`../../../artifacts/issue75-closeout-issue20-20261013T144339Z/issue20/document-verification-4.json`）。**5,803 个完整材料输出对象的集合、字节、执行位和链接文本一致**；覆盖完整输入副本、111 个文档/索引/资产/dot 输出、实际配置差异、五份原始 dot 重渲染、完整原 crawler helper 和生成绑定。没有删未知字段后比较。原进程 stdout/stderr、Node/cwd/实际调用身份保存在树外的两份完整 probe 回执中，不把这些不同进程的证据元数据声称为相同字节。

## 原 106 文件范围的新旧对应与兼容

原 106 文件全部仍有对应：90 项全字节一致，16 项变化；没有删除原文件。五项新增为实际 `.dot` 输入。`document-verification-4.json` 对原 106 项、新增五项分别保存旧/新摘要、字节、执行位和解释，完整输出清单也一并保留。

| 范围 | 结果和变化解释 |
| --- | --- |
| 原 CSS | 实际 Doxygen 全字节生成与旧候选一致，55,162 字节，`sha256:a12445890a4ce321a21a549b820061428edd0f0c57e9edf2028660efdde4c0c0`；旧精确对应和旧配置 UNVERIFIED 分别保留 |
| 原九资产 / 六组件 | 九资产新生成字节与旧字节完全一致；原组件分块、版权、完整 permission 材料、例外和原失败报告均保留。当前候选的 MIT 选择另列，旧 Touch Punch UNDECIDED 不改写 |
| 原 19 源码页 | 新生成全部全字节对应原页；这是 111 输出整体实际生成中的子证明，不将其代称为整份归档重建 |
| 五 SVG | 几何尺寸/位置改变；所有 XML 元素、非几何属性、ID、节点/边、标签、链接、填充/线样式和字体属性保持。原实际完整 bytes 仍参与双目录比对；几何排除只用于有明确语义范围的新旧兼容检查 |
| 四 map | 仅坐标改变；完整 ID、形状、title、链接和其余字节一致 |
| 五嵌图 HTML | 仅 iframe 尺寸跟随 SVG 改变；其余完整页面字节一致 |
| `files.html` | 唯一改变是为已有 `exif_8h.html` 增加一个链接，显示文字和其余完整字节不变 |
| `doxygen_crawl.html` | 148 个旧的缺失枚举值 detail 锚点改为相应真实枚举声明；固定 before/after 摘要和逐项替换清单进入批准 manifest。完整 raw helper 保留，修正版有日期修改声明；未知变化或未审核 overlay 仍拒绝 |
| 其余文档/JS/索引/footer | 逐项实际生成；60 完整 HTML 页的原锚点与资源接口保留，footer 完整字节保持。3111 本地链接/资源和 2019 锚点引用全部有效，原索引 JS 等的全字节对应保留 |

五图职责未缩减：legend 为 9 节点 / 8 边；ExifContent、ExifData、ExifEntry 的 collaboration diagram 各 11 节点 / 19 边；ExifMnoteData 为 5 节点 / 6 边。每个 dot、SVG、raw SVG、工具和命令独立绑定。raw Graphviz 与 Doxygen SVG 的唯一处理差异为明确的 `$` href 去除和 `_top` target；逐字核验该确切变换，没有删除 SVG 未知属性。

## 当前复制/生成条件与后续事件

当前新候选逐项台账为 `materials/current-notices/obligations.json`：111 个文档对象的身份、适用规则、原文文件/行/摘要、拟用途、适用前提、当前履行和具体后续 Gate 绑定；7 类复制/生成规则及六组件各自条件分别记录。完整原许可/版权、vendor、原第三方 permission 和原报告均保留。Bison 全归档许可、实际生成 skeleton 例外原文及其后续分发前提另见 `bison-build-condition.json`。

当前动作是私有固定输入复制、私有工具构建和本地文档生成。当前源树、模板、工具来源及必需声明都有实际材料和回执，配置/输出修正有完整原件及修改声明。Doxygen 输出声明与输入/嵌入资产的条件分列；Graphviz 工具的 EPL 不用于推定 SVG 的许可。六组件的当前 MIT 选择有固定 bundled 声明及完整对应 permission 依据；Touch Punch 的标准 MIT 补充明确标为当前组合声明，不制造新的上游授权。原组件 chunk 的对应和旧 UNDECIDED 历史保留。

| 后续 Gate | 必须验证的事件及本轮状态 |
| --- | --- |
| #23 | 新 kit 的全输入/工具/补充材料/对象台账聚合核验；本轮文档候选仅为其子集，#21/#22 尚未闭合，#23 继续 BLOCKED |
| G2-00-04 / #25 | 实际 native 应用构建、链接/修改/源码条件以及文档资源在真实应用中的行为；NOT_RUN |
| G2-00-05 / #27 | 按实际最终包判定是否分发工具或生成对象；对应源码、selected terms、recipients、ledger、双 SBOM/notices 及分发履行；NOT_RUN |
| G2-00-06 / #28 | 当前精确候选的隔离 Full、默认发行与安装/回滚/再应用核对；NOT_RUN |

整体 kit 许可仍 **INCOMPLETE**，native 应用构建、真实资源运行、最终包分发、Full、U2 和日常晋升未升级。当前动作的条件没有以“未来 Gate”代替；待验后续事件也没有因本地生成通过而记为 PASS。

## 实际禁网、公开 CLI 负例和原失败

工具构建、两次最终 CLI 及每个实际工具调用使用同一 `(version 1)(allow default)(deny network*)` 真实 sandbox-exec 策略。`network-policy-runs.json` 记录两个 Node 各自未禁网正例与同策略负例：正例实际独立服务器各接收 1 次，负例 `EPERM` / exit 77 且各接收 0 次。禁网结论来自该真实策略及实际网络尝试，不依据断网配置标签。

双 Node 每个 13 项、合计 **26 项**受影响材料负例全部拒绝，原 stdout/stderr、退出码和目标检查保留：缺 manifest、缺工具、缺模板、同长度内容漂移、全部及部分执行位漂移、额外未审核 overlay、已审核 overlay 被编辑、错误用途、输入 alias、输出父目录 alias、重叠根、已有输出。输入错误均在创建新输出/回执前拒绝；已有输出的原失败证据字节保持。详见 `negative-runs-final.json`。

所有失败和中间候选保留：旧的 PARTIAL 材料报告、239/347 文件 supplement 和完整 106 文件原件；本轮 Python 3.9 解包参数不支持、Graphviz PkgConfig 配置失败、共享 dot 无 SVG 格式、两个输入冻结失败、TDD 红测、首个独立 verifier 的 bytes/str 错误、148 个继承缺失锚点的严格检查 FAIL。修改了 verifier 类型错误，随后真实修正生成对象；没有降低链接断言。原未修正生成目录、fixed-inputs 初版/v2、失败冻结目录和各版日志/回执均保留，原 FAIL/PARTIAL/UNVERIFIED/UNBOUND 不升级。

## 工程检查与两轴审查

| 检查 | 当前结果 |
| --- | --- |
| 双 Node 受影响公开 CLI / libexif 绑定回归 | 各 18 PASS，0 FAIL，exit 0；最终模块改动后复核记录见 `focused-final-*.log` |
| 类型检查 | 根、safety、host、WebUI 四组 tsc，全部 exit 0 |
| lint / secret scan | 最终全部 exit 0；`engineering-checks-final.json` 绑定最终源模块摘要，文档收尾再静态核对 |
| Node 24 全量 | 首轮 FAIL：1788 PASS / 1 FAIL / 0 CANCELLED / 8 SKIP，exit 1，原因仅为 #75 报告两处仓外链接。最小文案修正后文档回归 PASS；最终全量复验 **1789 PASS / 0 FAIL / 0 CANCELLED / 8 SKIP**，共 1797 项，exit 0，原断言和超时不变，原失败保留；见 `full-node24-final.log` / `engineering-checks-final.json` |
| Standards | **PASS**；独立固定 diff 审查，无阻断项，1 项本地 manifest 读取大小的非阻塞建议；见 `standards-review-final.md` |
| Spec | **PASS**；独立固定 diff 及九条 AC 材料证据审查，无实现/材料阻断项；见 `spec-review-final.md` |
| #20 GitHub 状态 | **CLOSED / completed**；9/9 AC，原正文/历史评论保留，追加完成评论及关闭后独立回读一致；见 `issue-20-close-verification.json` |

最终远端回读已确认 #20 的九条 AC、原历史评论、[新完成评论](https://github.com/Ricardo121380/only-my-pi/issues/20#issuecomment-6150146305)与 CLOSED / completed。`issue-20-close-verification.json` 的回读时间为 2026-10-13T16:24:12.417471+00:00（北京时间 2026-10-14 00:24）。`gate-preservation-final.json` 独立回读 #19/#21/#22/#23 仍 OPEN，正文、评论、标题、标签和负责人不变；#75 仍 CLOSED / completed。#23 的 #20/#21/#22 三条依赖边及 ID 保留，其中 #20 closed、#21/#22 open，blocked_by=2、total_blocked_by=3，#23 继续 BLOCKED。整个本轮止于 #20。

两轴固定点为隔离审查仓库的 `a442477ed7a4100fe98d45c812539aafcc91b0bf...7969c71c057841c8f1e0a5d684b91f9ac5397271`，diff 身份 `sha256:504ff222c40b5554191f94d648e38e286704a094c20b3107eb80468d3a718ad8`；8 个归属文件当时摘要均匹配。最终全量检查的四个实现摘要与最终双目录生成及审查一致。审查后只回填工程/审查/远端结果和三份流程入口的当前状态，主代理静态核验这些交付元数据。Standards 的建议针对未批准超大 manifest 在摘要核验前的本地内存占用，当前固定输入候选未受影响；作为非阻塞建议保留，不扩大本轮材料实现范围。

关闭前工作区回读为 `pre-close-workspace-verification.json`：1,715 个非本轮归属入口文件的字节/模式全匹配，8 个本轮文件与冻结审查包匹配，暂存区为空；309 条工作等于保留的 301 条既有工作加本轮 8 条。

提交前已再次核对 #75 六个运行时文件与 N2 验收字节身份一致，见 `issue75-runtime-identity-final.json`。两条 #75 提交及本轮 #20 提交均只进入本地分支；未 push、部署、切换日常安装或调用真实收费 Provider。
