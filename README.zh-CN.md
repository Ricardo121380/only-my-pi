# only-my-pi

[English](README.md) | **简体中文**

**先理解代码，再授权修改。**

only-my-pi（OMP）是基于 [Pi](https://github.com/earendil-works/pi) 的终端 AI 编程助手，安装在当前用户目录。进入项目运行 `omp`，即可阅读代码、分析问题，并在明确授权后进行项目内修改。

Pi 提供终端界面、模型、会话和基础工具；OMP 在此之上增加编程审批、有预算的子代理协作，以及可验证的安装与回滚。

> **已发布预览版：[v0.3.0-preview.1](https://github.com/Ricardo121380/only-my-pi/releases/tag/v0.3.0-preview.1)**<br>
> 受控安装仅支持 **macOS 14+、原生 Apple Silicon（arm64）**。模型账户与费用由你自行配置和承担。

[快速开始](#快速开始) · [日常使用](#日常使用与审批) · [常见问题](#常见问题) · [安全边界](#安全与许可证)

## 项目能力

| 你需要什么 | OMP 如何处理 |
| --- | --- |
| 修改前先看清范围 | 新进程从只读 `Inspect` 开始；复杂任务先出计划，获得审批后再编程。 |
| 保留已有工作 | 记录 Git 基线和未提交路径；写入任务与已有改动重叠时，由主 Agent 在原工作区处理。 |
| 协作而不无限扩张 | 按需使用只读子代理、一个写入子代理和独立上下文的审查者，并限制并发与累计用量。 |
| 检查后再合入子代理补丁 | 在克隆中运行项目检查，通过审查和补丁校验后合入，再验证真实工作区。 |
| 明确管理本地安装 | 先预览安装计划，再显式执行；发布包可校验，受控栈支持诊断、回滚和移除。 |

日常使用不需要选择 Workflow、Swarm、Goal 或 Ultra。**这些约束不等于操作系统沙箱**，详见[安全边界](#安全与许可证)。

## 快速开始

<a id="平台与运行时"></a>

### 1. 确认环境

当前预览版不支持 Intel Mac、Rosetta、Linux 或 Windows 的受控安装。受控栈使用固定的 **Node.js 24.19.0** 和 **Pi 0.84.3**；安装器提供运行时，不需要预装系统 Node 或 npm。写入子代理需要 Git；安装器使用 macOS 的 `curl`、`shasum`、`tar`、`awk` 和 `mktemp`。

<a id="安装"></a>

### 2. 校验安装器并预览计划

以普通用户身份操作，不要使用 `sudo`。先下载固定版本的脚本并核对 SHA-256；下面的哈希**只适用于 0.3.0-preview.1**：

```bash
mkdir -p only-my-pi-preview &&
cd only-my-pi-preview &&
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  https://github.com/Ricardo121380/only-my-pi/releases/download/v0.3.0-preview.1/install.sh \
  --output install.sh &&
printf '%s  install.sh\n' \
  '542dbcb468221841b460199c41afa9af1d178e8842d7a649b61e00742186e886' \
  | shasum -a 256 -c -
```

只有看到校验成功后，才阅读脚本并生成安装计划。下载或校验失败时不要继续：

```bash
less install.sh
sh install.sh --release 0.3.0-preview.1 --payload thin --plan
```

`--plan` 不提交受控安装状态，但仍会下载并解压已验证的资产到临时目录。

### 3. 确认安装

核对计划中的目标路径、包所有权和拟执行改动后，再运行：

```bash
sh install.sh --release 0.3.0-preview.1 --payload thin
```

安装器会请求确认。已明确批准的非交互安装可加 `--yes`；只有显式添加 `--configure-shell` 才会修改 shell 配置。

如果出现 `PATH_ACTION_REQUIRED`，按输出指引设置路径。默认安装在当前 shell 中可这样检查：

```bash
export PATH="$HOME/.local/bin:$PATH"
omp admin doctor --json
```

<a id="首次启动与模型配置"></a>

### 4. 配置模型，进入项目

尚未配置模型时，先运行 `pi`，按 [Pi 文档](https://github.com/earendil-works/pi)配置服务商和认证；支持的登录流程可使用 `/login`。完成后退出 Pi，回到项目目录：

```bash
cd /path/to/project
omp
```

按 Pi Project Trust 提示确认你信任该项目，再选择已认证的模型。也可以使用 `omp --model provider/model-id`；请将占位符替换成实际模型标识。

**日常使用运行 `omp`，而不是 `pi`。** `pi` 是高级原始运行时入口，可能加载不同的扩展集合。用户级安装不代表本地模型推理；OMP 不提供模型订阅或服务商额度，也不要把凭据写入项目配置。

## 日常使用与审批

```bash
omp                                      # 进入交互式会话
omp "检查登录测试失败的原因，先不要修改文件"  # 带初始任务启动
omp -c                                   # 继续最近的 Pi 会话
omp -r                                   # 选择要恢复的会话
omp --model provider/model-id             # 显式选择模型
omp -p "检查错误处理" --model provider/model-id  # 非交互式只读检查
omp -- "status"                          # 将管理命令同名词当作任务
```

进入会话后直接描述目标，例如：“修复这个测试，修改前说明影响范围和验证方法。”需要完整计划时，输入 `/plan 为登录模块补充输入校验和回归测试`。

| 命令或按键 | 用途 |
| --- | --- |
| `/plan <任务>` | 先以只读方式制定计划，再请求编程授权。 |
| `/access` / `/access revoke` | 查看授权状态，或撤销授权并返回 `Inspect`。 |
| `/agents` | 查看子代理任务和累计预算用量。 |
| `/model` | 切换模型。 |
| `Esc` | 中断当前工作，并向子任务传递取消。 |
| `/exit` / `Ctrl+D` | 退出；`Ctrl+D` 需要输入框为空。 |

**授权范围是当前项目、当前交互进程。** 授权范围内的后续工作可以复用这次授权；`-c` 和 `-r` 恢复对话历史，不恢复编程权限。新进程需要重新审批。公开 Web 研究也需要针对该任务单独审批，不能复用编程授权。

`-p` / `--print` 模式只提供阅读和搜索工具，不提供 Bash、写入子代理或交互式 Web 审批。没有可用的最近模型时，必须显式指定模型。

## 写入子代理与项目验证

简单修改由主 Agent 完成；复杂任务可以委派给受控 Git 克隆中的**一个写入子代理**，由 `pi-subagents` 创建实际子进程。只读子代理、写入子代理和审查者继承主 Agent 的模型及思考级别。

克隆从获批的 Git HEAD 创建，**不包含未提交内容**。请求范围与已有改动重叠时，OMP 返回 `MAIN_AGENT_FALLBACK_DIRTY_OVERLAP`，交由主 Agent 在原工作区处理；不要为启用子代理而丢弃已有改动。

写入补丁的合入顺序是：**克隆内项目检查 → 独立上下文审查 → 基线、范围与补丁检查 → 合入 → 真实工作区再次验证**。缺失检查清单、测试失败、审查未通过、漂移或冲突都会阻止合入，并保留补丁供检查。

<details>
<summary>为项目配置写入验证：.pi/only-my-pi-gates.json</summary>

自动合入要求可信项目与克隆在获批 HEAD 上包含相同的检查清单。请先创建并提交 `.pi/only-my-pi-gates.json`，再委派写入任务。这不是普通只读使用的前置条件。

下面的示例适用于已定义 `npm test` 的 Node 项目；请替换为实际可用的项目检查：

```json
{
  "$schema": "https://raw.githubusercontent.com/Ricardo121380/only-my-pi/v0.3.0-preview.1/schemas/project-gates-v1.schema.json",
  "formatVersion": 1,
  "id": "project-checks",
  "gates": [
    {
      "id": "unit-tests",
      "description": "Run the project's unit tests",
      "command": "npm",
      "args": [
        "test"
      ],
      "cwd": ".",
      "timeoutSeconds": 900,
      "env": {
        "CI": "1"
      }
    }
  ]
}
```

执行前会展示实际可执行文件、参数、工作目录、环境和超时供确认，不会直接执行模型自由描述的验证文本。**检查进程允许列表和经过清理的环境，不提供文件系统或网络隔离。**

详见[检查清单 schema](schemas/project-gates-v1.schema.json)和[运行时验证实现](packages/direct-agent/writer-verification.mjs)。

</details>

## 配置与子代理预算

全局偏好位于 `~/.pi/agent/only-my-pi/preferences.json`；可信项目可以提供 `.pi/only-my-pi.json`。项目配置只能收紧能力和预算，不能扩大当前授权。修改与执行相关的偏好后需要重启 OMP。

默认每个进程最多 **2 个并发子代理、累计 8 个子代理、1 个写入子代理**。子代理预算不包含主 Agent 用量，**也不是服务商账单的精确硬上限**。

<details>
<summary>预算默认值与项目配置示例</summary>

| 限制 | 默认值 |
| --- | --- |
| 委派深度 | `1`；设为 `0` 可禁用子代理 |
| 累计上报的 tokens / 费用 | `50,000` / `$0.25` |
| 共享时间窗口 | `1,800` 秒，从首个子代理获准启动时开始 |
| 单个子代理轮次 / 工具调用 | `8` / `16`，角色还可能有更低上限 |
| 累计工具调用 | `64` |
| 单个 / 累计返回结果字节数 | `65,536` / `262,144` |

例如，在 `.pi/only-my-pi.json` 中降低项目的子代理预算：

```json
{
  "$schema": "https://raw.githubusercontent.com/Ricardo121380/only-my-pi/v0.3.0-preview.1/schemas/preferences-v1.schema.json",
  "formatVersion": 1,
  "budgets": {
    "daily": {
      "maxConcurrency": 2,
      "maxChildren": 4,
      "maxDepth": 1,
      "maxTotalTokens": 20000,
      "maxWallSeconds": 900
    }
  }
}
```

限制取适用预算中的最小值，并在同一进程内累计；配置键 `daily` 不代表每日账单配额。已完成和失败的子代理用量均计入预算。耗尽预算、用量无效或无法证明取消已结束时，会停止进一步委派和写入合入。用量可能延迟上报；字节限制只覆盖返回结果，不覆盖全部私有日志。

详见[偏好 schema](schemas/preferences-v1.schema.json)和[配置实现](packages/daily-config/index.mjs)。

</details>

<a id="更新回滚与移除"></a>

## 安装管理

查看版本、诊断安装并显式检查同一 Preview 系列的新发布：

```bash
omp admin version --json
omp admin doctor --json
omp admin stack status --json
omp admin release check --channel preview --json
```

**没有后台更新器。** 当前安装器和发布解析器绑定精确版本；安装未来版本应使用该版本经过验证的安装器，不要把旧脚本中的版本替换成 `latest` 或猜测的版本号。

<details>
<summary>更新、回滚与移除命令</summary>

对于已安装管理 CLI 支持的版本，可先预览经过验证的本地包：

```bash
omp admin stack update --bundle /absolute/path/reviewed-full.tar.gz --plan --json
```

核对后再执行：

```bash
omp admin stack update --bundle /absolute/path/reviewed-full.tar.gz --apply --yes --json
```

回滚需要已有可用的已知良好栈。先查看计划：

```bash
omp admin stack rollback --plan --json
```

确认目标后再回滚：

```bash
omp admin stack rollback --apply --yes --json
```

移除受控栈同样先预览：

```bash
omp admin stack remove --plan --json
```

确认保留与移除范围后再执行：

```bash
omp admin stack remove --apply --yes --json
```

管理 CLI 的修改操作使用 `--apply --yes`，与引导脚本的 `--yes` 不同。`omp admin uninstall` 仅移除 OMP 激活配置和入口，不等于完整栈移除。

存在活动的受控 Pi 进程时，先正常退出；终止它们需要单独的 `--terminate-pi` 授权。移除会核对所有权并保留预先存在或已变化的用户数据，可能要求人工处理。服务商凭据、会话和系统 Homebrew 安装不属于卸载目标。

</details>

<details>
<summary>默认安装位置与现有 Pi 的关系</summary>

| 路径 | 用途 |
| --- | --- |
| `~/.local/bin/omp`、`~/.local/bin/pi` | 用户级命令链接 |
| `~/.local/share/only-my-pi/stacks/` | 经过验证的受控栈 |
| `~/.local/share/only-my-pi/current-stack`、`~/.local/share/only-my-pi/lkg-stack` | 当前栈与可用时的已知良好栈指针 |
| `~/.local/share/only-my-pi/transactions/` | 安装事务日志 |
| `~/.pi/agent/only-my-pi/` | 偏好、配置状态及私有运行产物 |
| `~/.pi/agent/npm/` | 用户拥有的外部 Pi 包 |

已有 Homebrew Node / Pi 安装会保留，但 `PATH` 顺序可能让用户级 `pi` 优先被找到。未知的同名命令不会直接覆盖；第三方包保持用户所有权，冲突需要显式核对。不要手动删除事务日志或修改栈指针。

</details>

## 常见问题

| 现象或错误码 | 建议处理 |
| --- | --- |
| `PATH_ACTION_REQUIRED` / `SHIM_CONFLICT` | 检查命令路径和现有同名文件；不要覆盖未知命令。 |
| `MODEL_AUTH_UNAVAILABLE` / `HEADLESS_MODEL_REQUIRED` | 通过 Pi 配置认证，再显式选择可用模型。 |
| `CODING_ACCESS_REQUIRED` / `COMPLEX_PLAN_REQUIRED` | 先检查并批准当前进程所需的编程计划。 |
| `MAIN_AGENT_FALLBACK_DIRTY_OVERLAP` | 保留已有改动，由主 Agent 处理重叠范围。 |
| `WRITER_GATE_MANIFEST_REQUIRED` / `WRITER_GATE_MANIFEST_DRIFT` | 核对检查清单是否已提交到获批 HEAD，以及清单是否一致。 |
| `WRITER_REVIEW_BLOCKED` / 检查失败 | 阅读保留的补丁和检查结果，不要绕过合入条件。 |
| `DIRECT_CHILD_BUDGET_EXHAUSTED` | 查看 `/agents`；当前进程不能继续委派或合入写入补丁。 |
| `OMP_CONTROLLED_STACK_UNAVAILABLE` / `M12_UPDATE_REQUIRED` | 运行版本与诊断命令，使用经过验证的安装包恢复，不要手动改链接。 |
| `MANUAL_RECONCILIATION_REQUIRED` / 校验冲突 | 保留错误信息、事务日志和备份，按报告核对后再重试。 |

[报告非敏感问题](https://github.com/Ricardo121380/only-my-pi/issues)时，请附精确版本、平台、脱敏错误码和最小复现；不要上传凭据、原始会话或私有源码。

## 安装包与发布验证

| 安装包 | 适用方式 |
| --- | --- |
| **Thin** | 在线安装；按清单获取并验证精确依赖。快速开始默认使用此方式。 |
| **Full** | 包含内嵌运行时和完整依赖载荷；可在预先下载、验证并传输后离线安装。 |

两者安装同一套规范栈。在线脚本的 `--payload full` 仍会从 GitHub 下载；**完全离线安装需要本地 Full 包**。离线安装不意味着模型调用也离线。

<a id="验证发布资产"></a>
<a id="发布流程与证据"></a>

<details>
<summary>验证发布资产、签名与构建来源</summary>

使用支持 `release verify`、`release verify-asset` 和 `attestation verify` 的 GitHub CLI，在新的空目录下载全部发布资产并逐项核验。只有所有检查都通过后才继续安装：

```bash
mkdir only-my-pi-release-assets &&
cd only-my-pi-release-assets &&
gh release download v0.3.0-preview.1 --repo Ricardo121380/only-my-pi &&
gh release verify v0.3.0-preview.1 --repo Ricardo121380/only-my-pi &&
shasum -a 256 -c SHA256SUMS &&
(
  for asset in *; do
    gh release verify-asset v0.3.0-preview.1 "$asset" \
      --repo Ricardo121380/only-my-pi || exit 1
  done
)
```

`SHA256SUMS` 不包含自身和 `release-index.json`；发布证明用于验证完整资产集合。还可核对 Full 包绑定的源码与构建工作流：

```bash
gh attestation verify only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz \
  --repo Ricardo121380/only-my-pi \
  --source-digest aaf22c968c9defeb9106680a30504e4ca6949052 \
  --signer-digest aaf22c968c9defeb9106680a30504e4ca6949052 \
  --source-ref refs/heads/main \
  --signer-workflow Ricardo121380/only-my-pi/.github/workflows/m11-publish.yml \
  --deny-self-hosted-runners
```

Thin 包可使用相同的来源检查。添加 `--predicate-type https://spdx.dev/Document/v2.3` 可选择 SPDX 证明。发布材料还包括软件物料清单（SBOM）、依赖载荷清单及第三方许可证声明。

本版本已发布资产不可变；`main` 上后续文档或工作流提交不会改变已发布字节。详见[发布说明](docs/releases/0.3.0-preview.1.md)和[发布工作流](.github/workflows/m11-publish.yml)。

</details>

<details>
<summary>使用本地 Full 包完成首次离线安装</summary>

先在联网设备验证 Full 包及所需证明，再传输到目标 Mac。将下方路径替换为已验证归档的绝对路径；此方式使用包内 Node，不获取受控安装所需的依赖：

```bash
omp_bundle="/absolute/path/only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz"
omp_extract="$(mktemp -d)"
tar -xzf "$omp_bundle" -C "$omp_extract"
omp_payload="$omp_extract/only-my-pi"
mkdir "$omp_payload/omp"
tar -xzf "$omp_payload/only-my-pi.tgz" -C "$omp_payload/omp"

env PATH="$omp_payload/node/bin:$PATH" \
  "$omp_payload/node/bin/node" "$omp_payload/omp/package/bin/omp.mjs" \
  admin stack install --bundle "$omp_bundle" --plan --json
```

核对计划后，在同一 shell 中安装：

```bash
env PATH="$omp_payload/node/bin:$PATH" \
  "$omp_payload/node/bin/node" "$omp_payload/omp/package/bin/omp.mjs" \
  admin stack install --bundle "$omp_bundle" --apply --yes --json
```

已安装 OMP 时，可直接使用 `omp admin stack install --bundle "$omp_bundle" --plan --json`，核对后改为 `--apply --yes --json`。保留经过验证的压缩包用于恢复；解压目录只是引导用临时目录。

</details>

<a id="开发与验证"></a>

## 开发与贡献

仓库开发需要 **Node.js >=22.19.0**；CI 检查 `22.19.0` 和 `24.19.0`。源码开发与面向用户的受控安装是两条不同路径：

```bash
git clone https://github.com/Ricardo121380/only-my-pi.git
cd only-my-pi
npm ci --ignore-scripts --no-audit --no-fund

npm run lint
npm run typecheck
npm run schema:check
npm run pack:check
node --test tests/ci-contract.test.mjs tests/docs-links.test.mjs
npm run verify:m12
```

`npm test` 运行仓库测试集。`npm run verify:m12` **查看**直接 Agent 的验收契约，不是执行验收；`npm run verify:m12:run` 执行 C1–C10，受保护的 C11 / C12 需要另行授权采集的证据。`NOT_RUN_BY_POLICY` 不是实际模型验收通过。

源码修改不会替换已安装的受控栈。集成测试应使用临时项目和配置目录，不要默认指向真实 Pi home，也不要提交凭据、会话或运行归档。贡献前阅读[贡献指南](CONTRIBUTING.md)与[行为准则](CODE_OF_CONDUCT.md)。

<a id="架构与目录结构"></a>

## 架构与文档

| 入口 | 职责或进一步阅读 |
| --- | --- |
| [直接会话扩展](extensions/omp-direct/) / [直接运行时](packages/direct-agent/) | 模型选择、编程授权、工具边界、克隆写入与验证 |
| [安装与发布栈](packages/release-stack/) / [引导安装](packages/bootstrap/) | 校验、所有权、事务、恢复与回滚 |
| [固定依赖清单](contracts/release/external/package.json) / [启动器](packages/direct-agent/launcher.mjs) | 审核过的依赖组合与实际启用的扩展；被打包不等于被启用 |
| [架构决策](docs/decisions/ADR-0013-direct-terminal-coding-agent.md) / [文档索引](docs/README.md) | 产品边界与设计资料 |
| [更新记录](CHANGELOG.md) / [里程碑](docs/STATUS.md) / [Labs](docs/LABS.md) | 版本变化、历史记录及非默认实验 |

`pi-subagents@0.57.0` 是唯一实际创建子代理的运行时。旧编排控制保留在 `/omp advanced ...`，不是日常任务的必选步骤；直接会话不再使用 `/omp run`。历史文档中的 `0.2.0-preview.1` 仍保持 `HOLD_PUBLICATION`，定位为 `INTERNAL_DISTRIBUTION_FOUNDATION`，不是已发布安装目标。

<a id="安全许可证与参考资料"></a>

## 安全与许可证

**审批控制 Agent 的工作流程，不隔离整个进程。** Pi 扩展和包以当前用户的操作系统权限运行；Project Trust、工具限制和 Git 克隆都不是完整沙箱。Bash 沙箱只覆盖特定执行入口，需检查实际 active / degraded 状态。不可信代码或扩展需要覆盖相关文件、凭据与网络访问的外层隔离。

编程授权不包含项目外写入、秘密读取、破坏性 Git 操作、部署或发布；OMP 不会静默暂存、提交或推送。当前直接产品不启用 MCP、memory、sync 或实验覆盖层，也不提供静默越权或后台更新。

凭据应留在 Pi 的认证机制或你的密钥管理器中。疑似漏洞请通过[私密安全报告](https://github.com/Ricardo121380/only-my-pi/security/advisories/new)提交，不要公开披露敏感内容。另见[安全策略](SECURITY.md)和[威胁模型](docs/threat-model.md)。

第一方代码采用 [MIT 许可证](LICENSE)。第三方组件遵循各自许可证，参见[第三方声明](THIRD_PARTY_NOTICES.md)和发布包中的 SBOM。
