---
status: accepted
date: 2026-11-04
---

# ADR-0023 · 独立 WebUI 预览包与后置 CLI 联动

用户确认先发布当前原生 Pi WebUI 的预览版，对外直接称 WebUI，CLI 配套后移。
沿用现有设计，内部原型代号和兼容命令保留。这补充 [ADR-0022](ADR-0022-pi-native-web-first.md)
的交付顺序：WebUI 预览及后续 Electron 不以完成 CLI 跨端联动为前置。

本次选择 GitHub prerelease `webui-v0.1.0-preview.1`，只提供 macOS 15+ Apple Silicon 的便携归档，
内置固定 Node 24.19.0、Pi 1.5.0、依赖与预构建页面。复用现有原生 Host 和会话路径，
使用独立配置与数据；应用主任务和只读子代理仅使用 DeepSeek。npm、Homebrew、旧 CLI
Full/Thin、日常安装晋升和其他平台仍保留各自出口，不把新包映射成旧发行验证通过。

WebUI 开发分支 CI 和预览构建固定使用 `macos-15` arm64。GitHub 已于 2026-11-02
[退役 macOS 14 runner](https://github.com/actions/runner-images/issues/13518)，原任务的排队取消记录保留；
不沿用退役 runner，也不跳过必需检查。新归档按 macOS 15+ 明确支持范围，历史平台证据保持原身份。

默认分支的下载说明单独按纯文档变更检查与合入。旧主线 runner 迁移在
[PR #107](https://github.com/Ricardo121380/only-my-pi/pull/107) 单独跟踪：文档、WebUI 和
CLI 检查已经通过，静态与安装任务多次未获得 hosted runner，原取消及失败记录保留。
不把这些未执行项计为通过，也不把旧主线 runner 迁移作为已通过独立源码、归档与
公开下载验收的 WebUI 预览文档的前置。

源码经过所选 CI 后，候选由 GitHub macOS runner 构建一次。候选携带源码/tree、运行文件
摘要、实际依赖 SPDX 清单、原许可及 GitHub provenance/SBOM attestations。实际解压包
验证内置运行时、真实 Pi、本地受控服务、只读子代理、审批、停止、重启与显式续接；
Ego Lite 再验证同一候选页面。既有真实 DeepSeek 源码旅程保持原身份，不改称新归档已
覆盖所有外部服务或长期日用。发布输入固定已验收归档 SHA-256，经原有 `public-preview`
环境审核后发布同一批字节，不重新构建或覆盖同版本附件。

用户同时明确允许删除旧 GitHub Releases。本次对 v0.3.0-preview.1、v0.4.0-preview.1、
v0.4.0-preview.2 先备份说明和全部附件并核对远端摘要，在新预览公开下载验证通过后
删除 Release 条目及附件。原标签、Git 历史、源码与失败记录保留。这是对
[ADR-0012](ADR-0012-public-preview-distribution-and-history-privacy.md) 中旧发布保留策略
的本次明确例外；没有修改历史证据。依赖旧 Release seed 的候选工作流暂不属于新发版
路径，后续恢复 CLI 工作时需重新处理；现有 npm/Homebrew 条目不由本次删除操作变更。
