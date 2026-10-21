# CLI 独立设置与认证 MCP

这是未发行开发入口，要求经过核对的 Node 24.19.0 / Pi 1.3.0 运行栈。
日常安装与发布的终端 Preview 不会因本文自动切换。当前验收范围见
[CLIENT-01C 记录](compatibility/2026-10-21-cli-authenticated-mcp.md)。

`omp mcp` 与 `omp admin mcp` 使用同一产品配置。设置、输入凭据、OAuth
登录和实际 Pi TUI 调用均无需启动 OMP WebUI 或 Host。默认配置根与其他
产品入口相同；需要隔离时，在本轮 shell 为 `PI_CODING_AGENT_DIR` 指定
一个绝对路径。`--project` 必须是已存在的项目绝对路径，会按真实路径绑定。

```sh
omp mcp help
omp mcp list --project /absolute/project
omp mcp status --project /absolute/project
```

`list` 显示配置 revision、来源、目标、明确工具范围及非秘密认证引用；
`status` 显示实际运行、发现、调用及进程状态。列表中有配置、服务器发现了
工具、工具被加载到当前模型、获得调用许可，是四个不同事实。

## 保存与明确启用

配置修改采用 compare-and-swap。每次先读取当前 `revision`，审查目标和范围，
再将该值传给修改命令。发生冲突时重新审查，不自动重试或覆盖另一端的修改。
以下例子按空 MCP 配置开始；已有配置请使用实际 revision。

本地 stdio 使用现有受控进程准入。在 `/absolute/stdio-action.json` 保存：

```json
{
  "type": "save",
  "revision": 0,
  "server": {
    "name": "local",
    "transport": "stdio",
    "command": "/absolute/node-24.19.0/bin/node",
    "args": ["/absolute/mcp-server.mjs"],
    "codePaths": ["/absolute/mcp-server.mjs"],
    "cwd": ".",
    "env": {},
    "credentialRefs": {},
    "tools": [
      { "name": "read_file", "effect": "read", "pathArgument": "path", "paths": ["README.md"] }
    ],
    "enabled": false
  }
}
```

命令、代码路径、服务提供的工具名与参数必须与实际服务器一致。声明代码
及其依赖路径，选择精确文件范围；环境不会自动继承本机秘密。服务器的
`readOnlyHint` 不代替 OMP 的权限判断。当前 stdio 操作系统隔离验收限
macOS Apple Silicon；无法落实边界时拒绝项目写入。

```sh
omp mcp apply /absolute/stdio-action.json --project /absolute/project
omp mcp enable local --revision 1 --project /absolute/project
```

Streamable HTTP 在 `/absolute/http-action.json` 保存如下配置。这里的 loopback
URL 仅作本地受控服务示例，端口应取实际服务值。

```json
{
  "type": "save",
  "revision": 2,
  "server": {
    "name": "remote",
    "transport": "streamable-http",
    "url": "http://127.0.0.1:8080/mcp",
    "credentialRefs": {},
    "tools": [{ "name": "echo", "effect": "remote", "exposure": "deferred" }],
    "enabled": false
  }
}
```

```sh
omp mcp apply /absolute/http-action.json --project /absolute/project
```

示例使用本地端口 8080；请改为自己的实际服务地址。HTTP 只接受明确 HTTPS
目标或允许的本地 HTTP 目标，不支持旧 SSE 配置。
不接受 URL 内账号/口令、query、fragment、任意认证头或重定向取密。
设置或认证不会启动工具服务器，也不会授予工具或编程许可。

## HTTP token 与 OAuth

HTTP bearer token 从不回显的终端输入，例子接续上面的 revision 3：

```sh
omp mcp credential remote --revision 3 --project /absolute/project
```

凭据由现有 MCP 存储生成私有引用，绑定项目、连接名与目标。不要把秘密放进
action 文件、命令参数、模型提示或 shell 历史。明确的安全管道可以加 `--stdin`；
未加此选项的非终端输入会拒绝。`--env MCP_TOKEN` 是 HTTP 默认值；stdio 可为
显式允许的 `MCP_*` 名称设置引用，不能转借 Provider/账号认证。

OAuth 是上述 token 输入的另一条路径，从相同未认证的 revision 3 开始：

```sh
omp mcp login remote --revision 3 --project /absolute/project
```

命令沿当前栈 Pi 的公开 OAuth 能力发现服务、执行 PKCE 并接收本地回调。
终端会给出此次认证的浏览器 URL；手动打开并批准，回到终端等待最终结果。
完整授权 URL 只属于这次认证交互，不写入普通 JSON 状态或会话历史。
无需打开 OMP 图形端；服务商的授权网页是 OAuth 的一部分。

等待期间按 Ctrl+C 取消，命令会关闭回调、等待认证工作收束并非零退出。
`--timeout-ms` 可在 100–120000 毫秒内选择期限，默认 120000。取消、超时、
错误 state/issuer、过期或重复回调不会自动重新登录或重放交换。

```sh
omp mcp auth-status remote --project /absolute/project
omp mcp enable remote --revision 4 --project /absolute/project
```

认证成功后仍须明确启用。`token` 表示手工凭据已绑定；`connected` 表示 OAuth
引用当前可用。状态不会把服务声明当作实际调用成功。OAuth 刷新也是明确操作：

```sh
omp mcp refresh remote --revision CURRENT_REVISION --project /absolute/project
omp mcp logout remote --revision CURRENT_REVISION --project /absolute/project
```

`logout` 撤销 OMP 中的凭据引用，阻止后续调用，不声称已经在远端授权服务器
撤销令牌。禁用连接使用 `omp mcp disable NAME --revision N`。这些变更需要与
`list` 一致的项目范围和最新 revision。

登录结果 `stored_sync_failed` 表示凭据已保存，但公开状态同步失败；它与认证
失败分别报告，并非零退出。`publication_unconfirmed` 表示发布持久性未确认，
后续凭据使用拒绝。先回读状态和绑定，不因非零退出而盲目重复登录。

## 默认值、项目覆盖与导入

省略 `--project` 的配置写入产品默认；指定项目后写项目覆盖。凭据与 OAuth
必须绑定明确项目。`list` 的 `source` 区分 `default` 和 `project`。

```sh
omp mcp preview /absolute/external-mcp.json --project /absolute/project
omp mcp import /absolute/external-mcp.json --revision N --digest REVIEWED_SHA256 --project /absolute/project
omp mcp reset remote --revision N --project /absolute/project
```

导入要求使用预览中的 digest；文件改变、命名冲突或旧 revision 会拒绝。
原 Pi/外部文件保持原字节。所有导入条目停用、工具范围与凭据引用为空，不
执行命令、联网、登录或授权。stdio 仍须补齐代码路径与工具范围才能受控使用。
`reset` 只移除指定项目的覆盖并撤回旧范围，不改默认或外部原件。

## 真实 Pi 调用与两端协调

先按 [账号指南](cli-accounts.md) 选择明确产品账号与模型，然后启动 TUI：

```sh
omp --account ACCOUNT_ID --model PROVIDER/MODEL --tui-mode regular
```

配置 `direct` 工具可直接出现在模型声明；`deferred` 通过 `mcp_tool_search`
明确加载；`codemode` 由脚本触达；`hidden` 或 inactive 不获得调用资格。
每次实际调用仍核对目标、定义、凭据、输入和当前许可。codemode 父脚本不
授予普通或 MCP 子调用许可；项目写入还须 Coding、项目单写者与真实隔离。
非交互 print 不能自动批准 MCP 提示。

GUI 与 CLI 使用同一配置、revision、目标摘要、凭据引用及运行账本。正在执行
的 Pi 逻辑运行固定快照；其排队续行保留该快照和额度。撤销、停用或凭据失效
阻止后续调用；下一次独立运行重读配置并重新授权。断连后可能已经执行的
远程操作保留 `unknown`，后续同目标业务拒绝自动重放。

OAuth 状态记录实际 owner PID 与进程身份。另一 CLI/Host 的登录冲突明确拒绝；
Host 启动不会把仍活着的独立 CLI 登录当成遗留进程。`auth-status` 可恢复已确认
死亡的认证 owner，保留 interrupted 结果；身份不明时保持阻断，不按经过时间
接管。另一端可查询活动状态；尝试取消会明确返回
`MCP_OAUTH_OTHER_CLIENT_OWNS_FLOW`。取消当前登录应回到启动它的终端。

本文不完成 #80/#81 的其余共享设置、#82/#83 的会话发现与交接，也不构成桌面、
日常安装、真实外部服务或 Linux 新 MCP 能力的验收。
