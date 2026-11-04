# Only My Pi · WebUI 0.1.0-preview.1

这是 macOS Apple Silicon 的 WebUI 预览版，内置 Node 24.19.0、Pi 1.5.0 和预构建页面。
账号、项目和会话从空配置开始，应用主任务和只读子代理均限定 DeepSeek。
现有纸墨设计、对话阅读区和工作区交互保持不变。

## 下载与启动

支持 macOS 15 或更新版本的 Apple Silicon；需要系统 Git。
下载 `only-my-pi-webui-0.1.0-preview.1-darwin-arm64.tar.gz` 与 `SHA256SUMS`，在同一目录执行：

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing
tar -xzf only-my-pi-webui-0.1.0-preview.1-darwin-arm64.tar.gz
cd only-my-pi-webui
./start.command --check
./start.command
```

也可解压后打开 `start.command`。启动后在浏览器打开终端显示的配对链接；该链接仅供本机使用，请勿分享。
添加项目，在设置里添加模型服务账号、API Key 和 DeepSeek 模型，明确选择后开始会话。
连接测试会发起一次短模型请求，可能计费。模型服务地址和 API 协议须与所选账号匹配。

程序自带运行依赖，启动不需要 npm 安装或前端编译。终端输入 `stop` 或按 Ctrl+C 正常停止；
输入 `pair` 获取新的配对链接。界面里的停止按钮停止当前任务，保留项目和历史。

默认数据目录是 `~/Library/Application Support/OnlyMyPi/WebUI Preview/0.1.0-preview.1/`。
可通过 `./start.command --data-dir /绝对路径 --port 4318` 指定另一份独立数据与端口。
数据与当前解压目录及依赖身份绑定；搬动程序目录后如出现身份不匹配，请保留原数据并显式选择新目录。
此预览使用自己的入口和数据，不自动导入旧终端版本的账号、配置或历史。

## 可以体验

- 项目选择、原生 Pi 会话、流式回复和实际工具回执。
- 只读起步，明确审批后修改项目；文件查看、Git diff 和工具目标跳转。
- 真正的只读 `omp-explorer` 子代理：继承本次账号与 DeepSeek 模型，独立上下文，只开放读取和搜索。
- 主任务及子代理停止，刷新后查看历史，Host 重启后重新配对并显式继续原会话。
- 日夜主题、小屏对话与工作区切换，以及现有键盘操作。

## 验收范围与已知边界

[公开发行验收记录](../evidence/2026-11-05-webui-preview-release.md)绑定源码、CI 候选、
Ego Lite 实机与匿名下载后的同一归档；Release 附件不重新构建或覆盖。

Pi/DeepSeek 的源码核心旅程已完成真实服务验收；本预览另对实际归档解压后的独立运行、
真实 Pi、本地受控模型、子代理、审批、停止与恢复留证。受控模型不是外部 Provider 验收。
版本、源码、运行文件和第三方依赖分别记录在 `preview-manifest.json`、`build-receipt.json` 与 `sbom.spdx.json`。

当前子代理只读；每次执行最多 4 个、并发 2 个、深度 1，每个子代理 120 秒和 8 轮。
累计 Token、费用和返回字节的硬预算仍待实现；未报告的用量和费用保持未知。
持久草稿、完整输入与队列的异常恢复、多窗口、真实 IME 和多日连续使用仍待完整验收。
这次先发布 WebUI；CLI 联动、Full/Thin 日常安装晋升、Electron 和其他平台后续独立推进。

审批和工具限制约束 Agent 的工作流程，扩展进程仍以当前系统用户的权限运行。
请在信任的项目中使用；需要文件、凭据或网络隔离时，应另外提供相应的系统隔离环境。

## 许可与记录

项目使用 MIT 许可。Node 的完整许可位于 `node/LICENSE`；原生依赖的许可随各自包保存。
前端依赖许可全文位于 `app/webui-preview-assets/THIRD_PARTY_NOTICES.txt`，另保留源码 notices。
SBOM 的 `licenseDeclared` 来自实际锁定包的声明，`licenseConcluded=NOASSERTION` 表示未宣称额外法律结论。

旧 GitHub Releases 退役后，原标签、历史源码和验收记录仍保留。旧终端版本的 npm/Homebrew
条目不属于这次 WebUI 发布渠道；依赖旧 Release 附件的历史候选工作流需在重新开展 CLI 工作时调整。
依赖这些附件下载地址的旧 Homebrew/Full/Thin 安装入口随之退役；已安装的 CLI 和 npm 注册表条目保持原状。
