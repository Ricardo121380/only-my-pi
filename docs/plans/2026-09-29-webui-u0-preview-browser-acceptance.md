# U0 受管预览浏览器复验

日期：2026-09-29。**本轮实际浏览器场景 PASS；U0-06 尚未整体验收。** 新 Ego 空间授权已落实，空间 25 已完成并关闭。剩余的是异常退出/未知残留的故障注入矩阵，不再是等待浏览器授权。U0 仍为 4/6、整体 12/44，不进入 U1 或 Electron。

## 范围与身份

- 工作目录 `LOCAL_WORKSPACE/repo`，分支 `codex/webui-phase1`，HEAD `4ba9ee4645aecab98b73a8f4ec052a62de09c1d8`，保留既有脏文件。
- macOS 27.0 arm64；候选 H 的 Node 24.19.0、Pi 0.85.1，开发目录 Vite 8.3.0。准确 stack 路径及 5 个关键文件 SHA-256 见 `acceptance-summary.json`。
- 真实生产 Host 实现运行于私有空配置；实际 Pi SDK 子进程使用本机合成 Provider，预览为固定 Vite 配方与 3 文件镜像。这不是日常 Glacier 页面、Full 安装态或收费模型验收。
- 本轮只运行现有探针并更新记录，未修改生产代码、探针、日常安装、配置或已有证据。48 次本机 Provider 请求，外部 Provider 请求 0。

## 结果

| 检查 | 结果与证据 |
| --- | --- |
| 实际浏览器配对 | Host `/pair` 200，带协议头的 `/api/state` 200；随后访问同 IP 不同端口预览。一次性 token 仅在驱动内存传递，不输出或存档 |
| HTTP/WS 凭据隔离 | 浏览器接入后 worker HTTP 13 次、WS 2 次，Cookie/Authorization/敏感环境标记均 false。全程可信入口剥离计数 HTTP 31、WS 2；初始离线阶段 WS 为 1，浏览器接入增加 1。Cookie 仍会到达可信入口，不宣称浏览器按端口隔离 |
| 真实 Pi 写入＋热更新 | revision 2–21 共 20 次；页面文档标记不变，非手工刷新。驱动观测延迟 P95 **131 ms**，最大 **324 ms**，均满足本样本 P95 <2 秒目标 |
| 两种 hostname | `127.0.0.1` 完成上述测试；切至 `localhost` 后 revision 21→22，实际 HMR 更新成功，后端仍无凭据 |
| 入口限制 | redirect、`/api/state`、`/pair`、`/__open-in-editor` 均 403；合成响应 Cookie 未写入页面。浏览器隐藏 Set-Cookie 响应头本身不能作为剥离证据，此项同时采用控制器原始 HTTP 检查 |
| 预览服务端重放 | 重启前后各一次：伪造合法 Origin/协议头并携带非 Host 合成 cookie，真实 Host API 401、WebSocket 403；子服务没有取得 Host cookie |
| 预览重启 | Vite worker 完全停止后重建；浏览器自动重载并恢复 revision 22，随后 revision 23 更新成功；未人工刷新 |
| 执行中停止 | revision 24 在途时关闭控制器；全部 child 与进程组退出、服务关闭、项目锁可重新取得。浏览器确认入口不可访问；最后可见 revision 23，不承诺关闭前最后一条更新已渲染 |
| 原有本地负例 | 固定配方的绝对/相对源误写拒绝、源摘要不变、禁用项目配置/env、端口冲突、竞争锁后 busy 恢复通过 |

延迟是从源写入时间到浏览器谓词成功回执的驱动观测上界，包含测试工具往返，不是纯绘制耗时；仅适用于本机合成小项目，不能外推到大型项目或其他设备。已查看 `preview-restarted.png`，页面显示 revision 23。

## 证据与剩余门禁

证据位于仓库外 `../artifacts/webui-optimization/U0/browser-0929-H0ef2B/`：

- `browser-pairing.json`、`browser-hmr.json`、`browser-restart-policy.json`、`browser-shutdown.json`：实际 Ego 页面结果。
- `preview-managed-1.json`：11 条本地检查记录（含两次重放），进程/锁/服务清理、20 个原始延迟样本；该控制器只知道局部结果，因此原始状态保留 PARTIAL，不改写为整体 PASS。
- `acceptance-summary.json`：环境、源码摘要、浏览器子集 PASS 与总门禁未关闭的明确区分。
- `preview-restarted.png`：恢复后的真实页面截图。

G0-05 保留历史 FAIL 未整体关闭；本轮已补齐配对、两种 hostname、持续热更新、自动重连和协作式关闭证据。下一步补 **worker 意外退出、leader 已退出但组内进程残留、身份不明时保留占用/拒绝重用** 的可控故障注入，不能从正常关闭推断这些路径成立。

源写入竞争目前是同进程第二次生产 `acquireOwnership`，不是第二个独立 Agent 生命周期；任意项目脚本、用户依赖/插件、恶意同 UID 隔离以及产品 UI/安装态不在本轮证据范围。后续 U5 仍需生产集成验收；本轮不降低原并行目标，也不把简单测试页面当作 WebUI 已完成。
