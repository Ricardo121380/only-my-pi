# CLI 产品账号设置与登录

本页描述 #78 的开发入口，使用 Node 24.19.0、精确 Pi 1.3.0。它不表示已发布的终端 Preview 已包含这些命令，也不要求启动 Only my pi GUI/Host。实际验收身份、范围和剩余门槛见 [CLIENT-01A 验收记录](compatibility/2026-10-20-cli-product-accounts.md)。

## 账号与原配置

CLI 和图形端共用当前 `PI_CODING_AGENT_DIR` 下的产品账号目录；未指定该变量时沿用原 Pi 配置根。只有显式 `--account` 才使用产品账号。`omp account list` 将产品账号标为 `source: product`，将原 CLI 配置标为 `cli-readonly / source: original_pi`。原 Pi 的认证、偏好、外部配置和历史不会自动导入或被覆盖。

```sh
omp account help
omp account list
```

同一 Provider 可以新增多个账号，每个账号有独立 UUID、凭据与服务/模型配置。后续命令中的 `ACCOUNT_ID` 使用新增命令返回的 `accountId`，不能使用显示名称或 Provider ID 代替。

## API Key

```sh
omp account add --provider openai --name "Work API" --auth api_key
omp account login ACCOUNT_ID
omp account status ACCOUNT_ID
omp account models ACCOUNT_ID
omp --account ACCOUNT_ID --model openai/MODEL_ID
```

`login` 在终端隐藏输入，不回显 API Key；Ctrl+C 取消。自动化可以显式使用安全 stdin，例如从已有的秘密管理器将值直接传给 `omp account login ACCOUNT_ID --stdin`。不要把秘密放进启动参数、shell 命令正文、模型输入、临时配置或可回放历史。

内置服务不需要覆盖端点。自定义服务使用不含凭据的 JSON 文件：

```json
{
  "baseUrl": "https://api.example.com/v1",
  "api": "openai-completions",
  "models": [
    { "id": "chosen-model", "name": "Chosen model", "contextWindow": 32000, "maxTokens": 4096 }
  ]
}
```

```sh
omp account configure ACCOUNT_ID /absolute/provider.json
omp account models ACCOUNT_ID
omp --account ACCOUNT_ID --model PROVIDER_ID/chosen-model -p "Inspect this project"
```

只接受静态服务/模型声明；配置不得携带 API Key、Authorization 头或取密命令。远程端点必须使用 HTTPS；本机受控服务可以使用 loopback HTTP。自定义配置属于所选账号，不覆盖同 Provider 的其他账号。

## OAuth

```sh
omp account add --provider openrouter --name "Personal OAuth" --auth oauth
omp account login ACCOUNT_ID
omp account status ACCOUNT_ID
omp account models ACCOUNT_ID
omp --account ACCOUNT_ID --model openrouter/MODEL_ID
```

Provider 必须支持当前 Pi 的公开 OAuth 能力。认证命令显示 Provider 授权网页地址；在浏览器完成该 Provider 的认证，不需要启动 Only my pi 图形端。Pi 根据服务能力接收一次性 loopback 回调、设备授权或隐藏的手工输入。API Key 和 OAuth 都由 Pi 自己的认证及凭据存储实现负责。

Ctrl+C 取消登录；默认最长等待五分钟，可用 `--timeout-ms` 在 100–300000 毫秒范围内设置更短的期限。取消、超时和重复/过期回调不会切换账号或复用另一账号的结果。独立 CLI 登录属于其真实父进程；启动 Host 不会将仍合法运行的登录进程当作孤儿终止。

`stored` 只表示凭据已保存，实际服务是否接受以调用结果为准。`stored_sync_failed` 明确表示凭据已经保存、随后模型状态同步失败，命令以非零状态退出；先查询状态并检查模型配置，不把它当成“没有保存”而盲目重复登录。`removed_sync_failed` 则表示凭据已经移除、状态同步失败。认证成功不授予编程或工具调用权限；正式 TUI 仍从 Inspect 开始。

## 显式选择、协调与清理

```sh
omp account rename ACCOUNT_ID "New name"
omp account logout ACCOUNT_ID
omp account remove ACCOUNT_ID
```

`--account` 必须同时指定 `--model`，模型 ID 必须精确出现在该账号的模型目录中（先用 `omp account models ACCOUNT_ID` 核对）。产品账号不会把拼写不完整的模型名模糊匹配到另一模型，也不接受尚未配置的自定义 ID；自定义模型先通过 `configure` 声明。需要推理强度时使用独立的 `--thinking` 参数。缺失/失效凭据、账号不存在、模型不属于该账号或服务拒绝时，调用明确失败，不自动换号，不借用环境变量或原 CLI 的凭据。新调用在 Pi 历史中追加非秘密账号绑定；旧历史和原目录保留。

已有产品账号绑定的历史不能在省略 `--account` 时静默改用原 CLI 默认身份，入口会返回 `ACCOUNT_SELECTION_REQUIRED`。停止后显式选择新产品账号会追加新绑定，旧绑定保持。完整的双向历史发现、配套版本准入与交接仍由 #82/#83 验收。

CLI 与 GUI 的账号使用和变更通过共享磁盘预占协调。活动账号不能被另一端修改、删除、重新登录或登出；登录变更期间也不接受该账号的新使用。收到 `ACCOUNT_BUSY` 时先结束相关执行或登录。仍存活的子进程组、身份未知或未确认终止的使用者不会因超时被抢占；`ACCOUNT_RECONCILIATION_REQUIRED` 需要核对实际进程后处理，不应手动删除锁来绕过。

产品账号执行期间，原生 `/login`、`/logout` 和运行时 key 覆盖入口会拒绝变更。退出该执行进程后使用 `omp account` 命令或图形端账号设置。未选择产品账号的原 CLI 路径保持其原有归属。

交互 TUI 通过其正常取消/退出操作清理。自动化的 Pi 1.3.0 print 进程使用该版本公开支持的 `SIGTERM` 清理路径；发送信号本身不等于进程已退出，应等待实际退出和调用连接关闭后再修改账号。只要原进程仍合法存活，占用便继续保留。

本票只交付账号基础和账号 OAuth。MCP 认证、共享工具/模型设置、会话发现与跨端交接由后续工单承担；本地受控服务验收不代表所有外部 Provider、Linux 新能力、日常安装或产品发行通过。
