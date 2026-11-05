# WebUI 0.1.0-preview.1 · 公开发行验收

记录日期为 2026-11-05（Asia/Shanghai）。
[WebUI 预览版](https://github.com/Ricardo121380/only-my-pi/releases/tag/webui-v0.1.0-preview.1)
于本地时间 02:48 公开发布，为不可变的 GitHub prerelease，Release ID `434313525`。
平台为 macOS 15+、原生 Apple Silicon，需要系统 Git。内置 Node 24.19.0、Pi 1.5.0、
预构建 WebUI、PTY 和原生搜索工具；应用主任务与只读子代理均限定 DeepSeek。

## 源码与归档身份

| 对象 | 已核对身份与结果 |
| --- | --- |
| 发布标签 | `webui-v0.1.0-preview.1`，直接指向提交 `fe2bc394018d1e00af4ebb90fcdd8403daa84a35`。 |
| 完整源码检查 | [`d5d37be` 的所选 CI](https://github.com/Ricardo121380/only-my-pi/actions/runs/41863765099)通过；[PR #106](https://github.com/Ricardo121380/only-my-pi/pull/106) 已合入开发分支，合并 tree 与受检 tree 一致。 |
| 最终源码检查 | `fe2bc39` 仅追加 4 个文档变更，[普通文档 CI](https://github.com/Ricardo121380/only-my-pi/actions/runs/41881907976)通过。 |
| GitHub 候选构建 | [41883234949，attempt 2](https://github.com/Ricardo121380/only-my-pi/actions/runs/41883234949)，`macos-15` arm64；构建、实际解压包检查、7 文件 provenance 与归档 SPDX attestation 全部通过。 |
| 发布工作流 | [41890511283](https://github.com/Ricardo121380/only-my-pi/actions/runs/41890511283)，通过既有 `public-preview` 环境的正常审核，发布已验收的同一批字节。 |
| 归档 | `only-my-pi-webui-0.1.0-preview.1-darwin-arm64.tar.gz`。 |
| SHA-256 | `57ba067ff83d3835de2e836fdbb27b4d7d8515c364c94c8b2edcb57ae061a394`。 |
| 内容清单 | 42,799 个清单条目、603 个 SPDX 包记录；源码、运行文件、锁、许可和依赖身份分别保存在发行附件。 |

发布附件恰为归档、`build-receipt.json`、`acceptance.json`、`preview-manifest.json`、
`sbom.spdx.json`、`SHA256SUMS`、`README.md`，未附带构建用的额外 Node 下载包。

## 实际程序与界面

候选工作流解压归档，使用其中的 Node 与实际 Pi，以及本地受控模型完成 7 个任务：
5 个成功，2 个主动取消。15 项断言全部为真，覆盖独立空配置、DeepSeek 限制、真实读取与
find/grep、物理只读子代理、审批前无写入、进程组停止、流式停止、历史保留、明确续接、
旧权限不继承、无任务重放、无系统 Node 回退及退出后无 worker。

本地较早的归档绑定 `d5d37be`，其 SHA-256 为
`e9f35dd9ae1bdbff93328186d2b74a5022729cfd3b9e17aad6cccc4cbead1ce1`。
Ego Lite 验证了项目与账号设置、原生读取、工具与文件对应、审批前后真实磁盘与 Git diff、
只读子代理、主/子进程停止、部分回复停止、刷新与 Host 重启后的显式同会话续接、
390px 与 1440px 布局及日夜主题。6 个任务为 4 次成功、2 次主动取消。

随后实际下载 GitHub 正式候选并重新解压。与前一归档逐项比较，所有启动文件相同；
全部清单内容仅有 4 个文档及 SBOM 元数据变化。Ego Lite 再对这份正式候选验证了：

- 独立空配置、添加实际项目、配置受控 DeepSeek 账号、原生 Pi 读取与文件跳转。
- 真实只读 `omp-explorer`，继承明确选择的账号与 DeepSeek 模型，完成 2 次工具调用。
- 刷新和 Host 重启后，同一 JSONL 摘要与任务数保持不变，模型请求数不增加。
- 重新配对、明确继续并发送新消息后，才在同一原生会话执行；3 个任务均成功且回到 Inspect。
- 390px 与 1440px 无文档横向溢出。正式候选的每个受检文档都明确挂载错误监听，未捕获到
  console.error、未处理异常或未处理 Promise 拒绝。

原本地浏览器的监听在导航后没有持续生效，该观测缺口保留；上述正式候选在每次导航前
重新挂载并确认监听生效。旧的自动化 selector、等待条件及停止确认时序失败没有删除，
也没有通过加大产品测试超时或重发用户动作隐藏。初次本地读取曾耗时约 28 秒，这只是
单次观测，不是性能修复或响应时间承诺。两次界面验收使用的 Host 均正常退出，合成测试凭据已移除。

## 公开下载与旧发行范围

通过不加载 curl 配置、不带账号认证的公开下载地址，重新取得全部 7 个附件。
逐项大小、远端摘要、`SHA256SUMS` 与已验收 CI 字节一致；`gh release verify`、
全部 `gh release verify-asset` 及源码限定的 `gh attestation verify` 通过。
对公开下载的归档重新解压并运行其内置 Node 的 `--check`，确认相同源码、Node 24.19.0、
Pi 1.5.0 与全部清单条目。没有用重建包代替下载的发行字节。

本次旧 Release 的退役范围为 `v0.3.0-preview.1`、`v0.4.0-preview.1`、
`v0.4.0-preview.2`。说明、标签对象与全部 30 个附件已离线备份，并逐项复核大小和 SHA-256。
删除 Release 条目与附件时保留原标签及 Git 历史；不删除源码或失败记录。
依赖旧附件地址的 Homebrew/Full/Thin 下载入口随之退役，既有 CLI 安装与 npm 注册表未变更。

默认分支的 [runner 迁移 PR #107](https://github.com/Ricardo121380/only-my-pi/pull/107)
另保留其多次 hosted macOS arm64 容量不足、无 runner/无步骤执行的记录，不能计为通过。
下载说明按现有路径分流规则作为纯文档变更检查，不修改 workflow、必需检查、断言或超时。

## 资格边界

本轮归档及界面使用本地受控服务，没有发起新的外部收费模型请求。此前的
[真实 DeepSeek 源码验收](https://github.com/Ricardo121380/only-my-pi/blob/codex/dev/pi-native-web/docs/evidence/2026-11-04-pi150-b2-deepseek.md)
保持原源码与账号范围；不把它改称本归档已验收所有外部服务。外部 Terra Max 验收仍为未执行。

累计 Token、费用及返回字节的硬预算、持久草稿、完整输入/队列异常恢复、多窗口、真实 IME、
连续多日使用、其他平台和桌面安装仍待分别完成。CLI 配套后置，不作为 WebUI 或 Electron 的前置。
