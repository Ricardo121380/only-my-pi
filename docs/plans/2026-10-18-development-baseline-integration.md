# #76 必要开发基线整理

日期：2026-10-18（Asia/Shanghai）。入口提交 `728dbbe3119c2b603af493a7775cc90448ee2013`，tree `8f7b5add345dc2623365554720a9ba62b94e576d`，分支 `codex/webui-phase1`。本轮按用户授权审查并整合必要开发文档和验证基线；原提交用于定位成果，未重置工作树。#76 运行适配的最终验证另见[兼容报告](../compatibility/2026-10-18-pi-1.3.0-runtime-adaptation.md)。

## 文件归属与决定

[逐文件清单](2026-10-18-development-baseline-integration.files.json)记录每个纳入或保留本地的既有路径、来源、当前归属、理由、开工 SHA-256/权限，以及被改写引用的原目标。来源是本轮开工时已有 tracked 修改或 untracked 文件；不从文件位置、时间或历史测试计数推定作者和运行验收归属。

| 范围 | 本轮决定及理由 |
| --- | --- |
| 当前总规格、蓝图、客户端工作组/发布记录、ADR-0018–0021 | 纳入仓库，使 US/GP130、已发布 #76/#77 和产品决定可以随源码追溯。文档的历史 NOT_RUN 不代表今天重新验收；当前进展由兼容报告和蓝图的最新明确记录覆盖 |
| 既有导航、CONTEXT、ADR 后继说明、使用说明等 25 份 tracked 修改 | 按已确认双客户端方向形成开发基线；日期、旧决策、失败、候选范围及材料阻断保留 |
| 递归链接所需 134 份既有文档材料（127 MD、6 JSON、1 HTML） | 纳入可移植文档图，包含原计划、必要验收说明及其工单草稿来源；历史草稿不变成新的功能授权，HTML 仍是设计样稿 |
| 87 个历史源码、测试或材料合同目标 | 继续保留本地，通过[本地历史索引](../evidence/2026-10-18-local-development-history.md)连接原路径、字节和权限。它们均在[10 月 1 日原始工程索引](2026-10-01-engineering-baseline.files.json)中，87/87 当前字节及权限相同；无 #76 运行必需性证据，不能仅为链接纳入代码 |
| 11 个仓库外 M2 证据附件 | 原文件保留；可点击链接指向本地历史索引，索引明确原本机位置、摘要、候选和失败范围。原始附件不伪装成仓库文件 |
| `verification/manifests/pack-content-v1.json` | 仅整合两个精确 bundled dependency 前缀 `node-pty`、`node-addon-api`，修复干净开发树实际 pack 拒绝。原有五项 Host input `required` 增量继续留在工作树 |
| `tests/pack-content.test.mjs` | 整合已有真实原生文件正例和嵌套未列依赖拒绝例，与上述声明共同验收；不修改 validator 或弱化原断言 |
| 其余既有运行代码、测试、WebUI、CI、inventory、manifest/lock 修改 | 继续留在原工作树；没有因历史文档引用一并整合。具体路径与开工摘要见逐文件清单 |

所有新增文档在整理前的原字节另保存在本地证据 `pi130-01-closeout-20261018T062251Z/baseline-inputs/`，引用映射同时保存原目标与新索引目标。历史失败、当前材料许可和接口阻断没有变成 PASS；#21/#23、U2、Full、真实 Provider 和安装晋升保持各自门槛。原始证据不上传。

## 复现与验证边界

原证据 `pi130-01-20261018T032930Z/doc-link-baseline-comparison.json` 及两份 missing 清单完全一致：122 条，introduced=0；111 次内部引用对应 68 个 untracked 目标，另 11 次越界附件引用。递归文档图展开后涉及上述 134 份文档和 87 个本地实现目标。本轮保留 Markdown 检查器和检查范围，未删除文档或将链接批量降为纯文本。

从入口提交建立独立 Git worktree，使用该提交自己的 manifest/lock 执行 `npm ci --ignore-scripts --no-audit --no-fund`。Node 24.19.0 下定向执行 docs-links、pack-content、bootstrap-staging 和 ci-contract：31 项，28 PASS / 3 FAIL。失败分别为原 122 条链接，以及两项实际 npm pack 检查的原生依赖 allowlist 拒绝；bootstrap 与 CI 合同通过。原始日志、命令、退出码和前后源码摘要保存为 `checks/red-clean-development-baseline.*`，不覆盖红色结果。

基线整理提交与 #76 最终验证说明分开。最终选定提交另创建干净验证目录，独立安装其自身依赖，补齐双 Node 类型/合同、真实进程、真实扩展 PTY、收尾完整测试及适用 M11。测试期间冻结被测源码和依赖；不将原工作树 1823 PASS 或 Node 24 混合源码运行改写为最终干净提交通过。

## 保留与生效

文件内容、权限和原工作区状态以开工机器清单为保护基线；提交只按明确路径及共改文件的选中增量操作，不全量暂存。最终回执逐项比较所有未纳入文件。磁盘上的文档纳入仓库后可由后续会话读取，本轮不声称当前会话或其他会话自动重新加载任何规则。

#77 的候选合同、依赖获取、补丁、声明、四项 installed 测试和同候选 Ego/CLI 回归由 #77 自己完成。本次不实施该票、不更改其他工单依赖、不切换日常安装、不调用付费 Provider、不 push 或公开发布。
