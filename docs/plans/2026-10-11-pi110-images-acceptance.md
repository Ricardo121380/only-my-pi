# PI110-N12 / #73：会话生图局部验收

依据总规格 [#19](https://github.com/Ricardo121380/only-my-pi/issues/19)、[本票 #73](https://github.com/Ricardo121380/only-my-pi/issues/73) 和 [分类验收记录](2026-10-11-pi110-classification-acceptance.md)。前置 #72 已 completed。本票先独立验收、审查和关闭；历史、位置分支、下载及项目导出由 #74 继续。

## 范围与当前实现

项目分别选择聊天、分类、生图账号和模型。`omp image list ACCOUNT --project /absolute/project`、`apply /absolute/config.json --project /absolute/project`、`status --project /absolute/project` 与 TUI `/omp-image`、WebUI“生图模型”使用同一项目配置和请求账本。任务创建固定账号、模型定义摘要和额度；保存配置供下一任务使用，停用阻止后续发送。使用中的账号不能替换凭据、登出或删除。

生图复用 #72 的任务授权、请求 ID、持久预占和未知结算。首次调用需单独同意费用上限未知；许可不来自聊天、分类或历史。发送前预占请求、并发、输入输出字节、图片数和存储字节。额度跨父脚本共享，未知结果占额并阻止后续发送；原生 `maxRetries: 0` 和单次 fetch 门禁共同阻止重试。用量只属于请求账本，父 codemode 不再计费；缺失 token 保持 null，部分回报和 SDK 估价分别显示，估价不是账单。

实际入口是 Pi 1.1.0 公开 `ModelRegistry.generateImages`，目前支持单次 `openrouter-images` 协议。专用 `images.json` 通过 Pi 公开 Provider 注册及公开 adapter 子路径加载。协议未提供尺寸、质量或生成张数硬上限；不接受脚本扩参，不承诺 Provider 生成量或扣费硬上限。模型声明支持的文本、PNG 输入及非交错 8-bit RGB/RGBA PNG 输出开放；输出最多 4 MP，逐块检查 MIME、规范 base64、字节数、PNG chunk/CRC、解压边界和行过滤器。其他格式明确拒绝，不载入 G2 约束下的 parser。

验证后的图片与来源 manifest 在私有 `only-my-pi/model-calls/artifacts/<requestId>/` 以一次目录发布保存，文件 0600。来源保留项目、会话、任务、父脚本、账号、模型、输入摘要、内容 SHA-256 和尺寸。Pi 公开 custom entry 记录原分支位置的引用；不包含授权或预算。公开图片入口重新核对 ledger、manifest、项目、大小和内容摘要。codemode 只能输出已验证保存的图片，不暴露 native 临时路径，临时内容退出后删除。项目目录不会自动产生图片。

远端请求与本地存储有独立状态：空/无效输出、部分输出、Provider 错误、取消、无用量、保存失败、磁盘不足及发布后 durability 未确认均保留原请求和用量。已发布但目录同步失败保留可核对引用，标为 `IMAGE_SAVE_UNKNOWN`，不当成已确认保存，不重新生成。全局存储预占上限 256 MiB；不会为新输出删除历史。

账本升级为 version 2；旧 reader 对新版本拒绝读写。新版 reader 也拒绝 version 1 中夹带 image 数据或损坏的来源/额度，保持原文件，不重建或清零。实际安装和回滚由 #59 验收。

## 证据与身份

证据目录：`LOCAL_WORKSPACE/artifacts/issue-73-74-20261011`。起始 HEAD `f4147a59776feb987ad69decd7c6041ab395d645`，分支 `codex/webui-phase1`，起始有 302 个既有修改/未跟踪文件，index 为空。`baseline-files.json`、完整原件与 binary diff 固定该基线；只提交本票归属路径，App/TaskControl 仅提交本批增量，既有输入/会话 UI 工作保留。

C/P 使用当前工作树源码；每次受控 fixture 复制 OMP、真实 Pi 1.1.0 与所用 Node，记录源码摘要、SDK/Node 摘要、外部扩展物理摘要、冻结绑定、请求账本与服务接收数。P 接受 `OMP_IMAGE_LOCAL_ACCEPTANCE=1` / `OMP_CLASSIFIER_LOCAL_ACCEPTANCE=1`，复制既有真实用户扩展到临时私有目录，不安装、不切换用户栈、不复制真实 auth。Node 24.19.0 与 22.19.0 均实际运行。账号、凭据、prompt、Provider 均为受控合成输入；这是 SOURCE_HARNESS，不是 Full 候选或实际外部 Provider。

固定输入为独立 64×64 RGBA 棋盘格 PNG，253 字节，SHA-256 `e61ccede3be4b0179bfbfdf678991b58e81103a49f2c7ed7887f779450cd95d9`。公开预览和原子产物核对同一摘要；项目仍只有原 README。

| 证据层 | 已执行证据 | 结果与限制 |
| --- | --- | --- |
| C | `23-image-C-final.log`、`26-PNG-chunk-red.log`、`27-PNG-chunk-green.log` | 初轮 7/7 PASS；审查补充非法 PNG 块名高位反例，先 exit 1 复现再修复，最终 8/8 PASS。覆盖实际 PNG 边界、来源与字节、权限、损坏/缺失、ENOSPC/EDQUOT/低空间、发布后 fsync 不确定、ledger reader/来源保护。磁盘故障在隔离的公共 filesystem seam 注入，未填满真实磁盘。 |
| P / Node 24 | `14-images-classifier-P.log` | 46 项中 45 PASS / 1 FAIL，保留失败：Host 终态在异步账本核对前短暂可见；没有把此轮记为全绿。 |
| P / 修正后 | `16-P-terminal-fix.log`、`21-P-terminal-gate.log`、`24-image-P-core-final.log` | 10/10、1/1、4/4 PASS 及最终核心回归：延迟 outcome read 时公开任务仍 running，核对后失败；真实 Pi 图片/部分用量/保存失败，接收数、原请求及源摘要核对。其余已通过切片按源码/职责匹配保留，批次全套在 #74 后运行。 |
| P / Node 22 | `17-image-p22.log` | 5/5 PASS：Host 正常图片、账号快照、未知结果、扩参拒绝、CLI/真实 PTY TUI。 |
| B | Ego Lite TaskSpace 48；`B-image-*.png/json/txt`、`browser-image-*-receipt.json` | 图片 naturalWidth/Height=64、正常/部分用量、空输出、本地保存失败、缺失后恢复、账号 busy 拒绝。5 次显式发送；未知后重启及两次核对仍 5 次，原 ID/预占不变。 |
| 复用回归 | `14` 的分类片、`20-web-slices.log`、`B-class-partial.json/png`、`browser-final-receipt.json` | 分类账号/三原生协议/部分价格用量/未知结果保留；Web 15/15 PASS；Ego 实际分类输入 12、输出 null，不补零，核对单次 reception。 |
| 类型与构建 | `19-typecheck.log`、`18-build-web.log`、`25-typecheck-final73.log`、`28-typecheck-specfix73.log` | PASS。PNG 修正只改变校验解码及反例，不改变页面构建。最终命令/退出码与源码摘要见 `commands-73.json`、`source-73.json`。 |
| I / L / Full / Linux / remote CI / release | 本批未执行 | NOT_RUN；付费、外部模型、安装切换和 Full 仍遵守原授权边界。 |

浏览器初轮包含一个等待超过 codemode 时限的账号 A 任务，未批准、无请求；单独保留其空账本，不能当成生成证据。实际生图由明确批准的后续任务执行。B 初轮 Host 早于终态竞态修正，页面模块与图片机制保持匹配；该竞态由后续当前源码 P 延迟读取用例直接验证，不将旧 B 记录当成新 Host 时序证明。

## 审查

Standards：PASS。固定起始 HEAD 至 `5a7cc0c` 的 30 文件精确提交独立审查，无硬违规。P3 判断项为 UI 与 store 重复预算默认值/上限；当前一致，保留为维护事项，不扩大本批改动。

Spec：PASS（修正后）。初审发现 P2：PNG 块名 ASCII 解码丢弃高位，合法 CRC 的非法块名可被保存。保留反例红灯日志；改为保留每个字节的 latin1 解码，再由块名正则拒绝，四个块名字节分别验证。独立只读复核确认缺口封堵且未见新缺陷；首轮其余 30 文件未发现缺项。原有 Host 终态竞态也保留失败与修正证据，不删除失败记录。
