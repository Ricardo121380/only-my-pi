# Glacier 日常安装更新与验收

日期：2026-09-21。结论：PASS（本次界面增量的安装与只读冒烟验收）；不代表 M2 或新增真实模型任务验收。

## 身份与切换

- 用户明确要求更新日常 `omp web` 并验收。
- 源码：`5900693b069cb99b756a83a215ab2d18a11a64b7`，构建前工作树干净。
- 新栈：`sha256:64b0cd4f97f9ec11af2e1aabab846edb3d06d31f09e5d7b279dfb715af669262`。
- 升级前栈：`sha256:b17ce477747f87d908c03228e80d45dd0cc49f58910dfd726e5137153c354539`。
- Pi 0.85.1 / Node 24.19.0 / OMP 0.3.0-preview.1 不变；以源码及 stackId 区分本次更新。
- 使用既有 Full 栈构建与事务管理器，未直接覆盖安装目录。切换前确认 Host 任务均终态、无活动 Pi 进程；仅重启空闲 Host。
- 隔离安装→回滚→同候选重新应用 PASS，真实 RPC get_state/abort PASS。日常栈更新后完整安装状态验真通过，旧栈显式回滚预检通过；本次未在日常环境重复执行实际回滚。
- 设置文件摘要及独立 Homebrew Pi 字节摘要未变。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 前端 9 项组件测试、TypeScript、原稿资源一致性 | PASS |
| 完整候选构建及隔离安装 | PASS |
| PATH `omp admin version` 的源码/栈身份 | PASS |
| 实际安装 Host 配对与刷新后认证 | PASS |
| 安装资产 JS/CSS 返回 200，Glacier 标识 | PASS |
| 既有验收项目历史、calc.mjs 预览、真实 Git diff | PASS |
| 模型选择弹窗、外观弹窗、浅色/深色 | PASS |
| 底部输出开关与快捷键、窄屏抽屉 Escape | PASS |
| 390px 窄屏 document.scrollWidth = 390px | PASS |
| 最终日常 `omp web` 启动 | PASS，Host 保持运行，检查时无活动任务 |

浏览器使用 Ego Lite。一次选择器匹配多个节点、一次使用过期引用、一次等待手机隐藏的连接标签超时，均为自动化定位问题；通过当前页面状态重新定位，未重发任务。深色首张截图处于颜色过渡期，以稳定后的截图为视觉证据。

本次零模型调用：未重复 M1 已消耗的真实任务预算，不将历史展示冒充新任务执行验证。未修改项目文件、凭据或 CLI 模型默认值，未推送和公开发布。

## 证据位置

仓库外项目工作目录 `artifacts/glacier-install-5900693/`：

- `promotion.json`：安装事务与完整身份，状态为 INSTALLED_BROWSER_PENDING，描述浏览器检查前的安装检查点；最终浏览器结论以本文及 browser-acceptance.json 为准。
- `isolated-install-w6RPsL/rehearsal.json`：隔离安装、回滚及重新应用。
- `installed-history.png`、`installed-dark-stable.png`、`installed-mobile.png`：实际安装页面。
- `browser-acceptance.json`：本次浏览器检查与最终启动汇总。

使用：运行 `omp web` 打开日常 Glacier；退出服务用 `omp web stop`。配对材料不放入本文或公开链接。第二阶段能力仍保持未开放。
