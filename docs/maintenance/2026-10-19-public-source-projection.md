# 2026-10-19 公开源码同步候选

本记录说明积压源码的公开副本如何生成。它不是产品发行、安装晋升、真实 Provider 或 Full 验收记录。

## 历史范围

- 以已公开的 `main` 提交 `e6e3c6aa5a3dcffcc8aef6a87f160416ac96ef50` 为祖先，接续 127 个此前仅本地存在的开发提交。
- 已公开祖先的对象、标签和公开基线证据不改写。此次待同步分支的作者、提交者、时间、提交消息及文件权限均保留。
- 原始历史、未提交文件恢复快照、旧新提交映射和逐文件转换记录保存在私有恢复材料中。它们不作为公开分支或附件上传。
- 本次候选不吸收开工时的 158 项未提交工作。那些工作按实现、测试、依赖和物料边界另行交付。

## 公开副本中的路径

历史文件中的 `LOCAL_WORKSPACE`、`LOCAL_HOME`、`LOCAL_TMP` 是被移除的本机位置标记；`PRIVATE_DESIGN_CONVERSATION` 标记私有设计对话出处。这些标记不是可执行的环境变量或可直接访问的下载地址。原始目录结构的相对后缀保留，用于区分历史候选和证据批次。

受影响内容包括按日期保存的开发记录、私有候选验收报告、来源清单和三份 native 材料合同。原始输入摘要、原始 source/tree/lock 身份、失败记录以及 `PARTIAL`、`BLOCKED`、`UNKNOWN`、`NOT_RUN` 等结论保持原有含义。上游版权与许可证文本保留。经核对属于本机受控服务的测试凭据字面值也保留。

## 验收记录的适用范围

遵循 [ADR-0012 的历史与公开验收边界](../decisions/ADR-0012-public-preview-distribution-and-history-privacy.md)：

1. 公开基线 `public-baseline-v1` 及 legacy registry 引用的历史文件保持原始字节和提交关系。
2. 本次脱敏的历史报告是原私有记录的公开副本；其中的 PASS 只描述原始候选。报告中原 source、tree、lock、receipt digest 不改成新提交身份。原文件摘要不等于公开副本摘要。
3. 历史记录中的本地提交 ID 仍用于私有追溯，可能不在公开分支的可达历史中。不得据此推定当前源码验收通过，也不得将它们自动改写为新验收。
4. 当前公开候选需要独立、源码绑定的检查。远程 CI、安装、真实 Provider、浏览器、Full 和发行分别记录；未执行的项目不得由历史 PASS 补齐。

## 私有材料回放

`native-generated-inputs.json`、`native-generated-candidate.json` 和 `native-gir-candidate.json` 的公开字节已经脱敏。固定 recipe 校验同步绑定公开副本的新摘要；原材料摘要与原验收身份不变。

GIR 和 generated candidate 回放要求保护根为已绑定、规范化的绝对路径。包含 `LOCAL_WORKSPACE` 标记的公开合同在生成输出前拒绝执行，分别返回 `GIR_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED` 或 `GENERATED_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED`。这不会自动创建私有目录映射，也不授予新的材料准入或分发许可。重新执行需单独准备并验证当地绑定与同一候选的输入身份。

## 同步与后续开发

本候选使用 `codex/public-sync-2026-10-19` 分支。公开推送前复核该分支全部新增可达历史，推送后独立核对远端 SHA；PR CI 通过及合入是后续步骤。之后以公开主线继续开发，每个完成批次记录提交、验证和远程同步状态。操作约定见[仓库维护指南](README.md)。

当前仓库采用 MIT 许可证。第三方材料和安装包的许可、来源及完整清单仍以具体版本和实际分发树核对；源码同步不代表历史私有物料已经获准公开分发。
