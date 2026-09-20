# 本机只读工作台（第一阶段）

工作台要求经过验证的 Pi 0.85.1 Full 候选栈。旧 Pi 0.84.3 安装不会因执行 `omp web` 自动升级。

```sh
omp web
omp web status --json
omp web stop --json
```

`omp web` 启动同一配置目录下的单实例 Host，并打开一次性配对链接。链接两分钟后失效；页面提示配对失效时重新执行命令，不要分享链接。Host 仅监听 `127.0.0.1` 的动态端口，不用于远程部署。`omp -- web` 仍将 web 当普通 Agent 任务文本。

## 使用

1. 从当前生效 Pi 会话目录汇总项目，或点击“添加”输入本机绝对路径。不会扫描整个用户目录。
2. 选择只读历史查看正文；每页最多 50 条，工具输出按需读取。旧会话不会续接或改写。
3. 选择已有可用模型，输入问题并点击“开始分析”。每次创建新会话，普通 Web 任务不能取得项目写入能力。
4. “取消任务”先变为“正在取消”，进程退出确认后才进入终态。关闭页面不停止任务；刷新重连恢复显示；`omp web stop` 停止 Host 管理的任务。
5. 右侧可以查看文件、当前 Git diff 和明确关联的验证回执，没有编辑保存或人工终端。窄屏用“项目 / 对话 / 检查”切换。

键盘：Enter 换行，Cmd/Ctrl+Enter 发送；输入法候选确认不会发送。工具输出、代码和 Markdown 都是展示数据，不是授权指令；远程图片不自动加载。

## 限制与故障

- 同时最多 4 个任务，保留最多 1000 个任务去重记录；只读任务最长 15 分钟。达到容量时明确拒绝，不自动丢弃去重记录。
- 文件预览最多 512KiB；符号链接、典型凭据文件、`.git` 和 `node_modules` 不提供预览。Git diff 禁用外部 diff/textconv/filter，不含未跟踪文件。
- Host 重启使浏览器授权失效，将未完成任务标记为中断，不自动重复模型请求。完整历史仍由 Pi 会话文件保存；Host 仅保存有界显示检查点。
- 项目不可访问时仍可看历史。模型列表为空时先通过现有 CLI 配置模型，M1 不提供账号表单。
- `OWNER_RECONCILIATION_REQUIRED` / `ORPHAN_WORKER_REQUIRES_RECONCILIATION` 表示无法安全证明旧进程已退出。不要删除锁或对未知 PID 强杀；先核对 `omp web status` 与对应进程身份。
- 账号隔离和 GUI 写入只在临时项目技术探针中验证；普通界面没有写入开关。完整写入、账号管理及人工终端留到 M2。

## 开发验证与回滚

```sh
npm run build:web
npm run test:web
npm run test:host
npm run typecheck
node scripts/phase1-gates.mjs /absolute/evidence-directory
```

最终候选打包会从清洁源码重新构建前端，并携带实际打包依赖及许可证。浏览器验收使用 Host 同源构建产物，不以 Vite 开发服务器代替认证验收。

日常 Full 栈回滚属于整个运行栈事务；不是 npm 安装或仅 Harness 回滚。先检查 `omp admin stack rollback --plan --json` 的目标是否为本次升级前 active，再按已审核回执操作。未确认旧栈身份、存在用户活动会话或进程归属不明时，停止切换。升级前后真实回执及最终状态见[第一阶段实施记录](plans/2026-09-20-omp-webui-phase1-progress.md)。
