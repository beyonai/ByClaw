# Midscene 阶段一实施与验证记录

## 状态

阶段一代码已在 `feat/devflow-midscene` worktree 实现。基线为本地 main `fb2e14736b1580048e4953df58491f51e0ec52e2`。**M1 尚未验收完成**：当前没有真实视觉模型配置，尚未在预期 Devflow UI/profile 上完成真实模型正向和刻意失败验收。M2 不启动。任务保持 in_progress；不发布 npm 包或 GitHub issue。

## 已实现

- 可选 `@zhchxiao123/dsh-devflow-midscene` 包，单独安装；插件只注册验收技能。
- `dsh-midscene run/inspect`、版本化套件、独立 Playwright/Midscene worker、构建探针、源码与套件指纹。
- 运行清单、有限结果计数、模型用量、Markdown/HTML/PNG 报告；报告 URL 必须可达且内容匹配。
- 进度输出、取消、超时、父进程丢失、异常 worker 退出和独立 Chromium 进程树清理。
- 真实 Loader/技能和 shell/工具/存储/产物门禁/命令门禁组合：附报告，失败拒绝完成，重新运行通过后才提交 done。
- 中英文使用说明、可修改套件模板、Agent Note，以及父工作区 Trellis 中的包规范。

使用入口：[包说明](../../packages/devflow-midscene/README.zh.md)。需求依据：[总 PRD](2026-09-14-devflow-midscene.md)。

## 最终质量检查

2026-09-14，Node 24.18.0、pnpm 11.24.0，Midscene 1.12.6、Playwright 1.63.0、匹配 Chromium 1243。

| 检查 | 结果 |
|---|---|
| `pnpm run typecheck` | 通过 |
| 包测试专用 tsconfig 类型检查 | 通过 |
| `pnpm run lint` | 通过；仅仓库原有 unused-disable 提示 |
| `pnpm run test:coverage` | 117 文件、1498 测试通过；逐文件四项门槛通过 |
| 覆盖率汇总 | Statements 5139/5139、Branches 3476/3476、Functions 1136/1136、Lines 4462/4462，全部 100% |
| `pnpm run build` | 通过 |
| `pnpm run preflight:tarballs` | 21 个包通过，未查询发布注册表 |
| 最终 tarball 独立安装、CLI help、run、inspect | 通过 |
| 隔离 Harness profile 安装与配置组合 | 通过；未修改用户现有 profile |

真实 SDK/Chromium 测试使用受控模型传输，覆盖成功、视觉断言 false、401 基础设施失败、构建不匹配、取消/超时、源码变化和部分执行。另有真实顽固 detached 子进程测试。模拟 IPC/SDK 故障的边界测试用于覆盖难以稳定制造的错误，不替代真实组合测试。没有降低覆盖率阈值或增加生产代码排除项。

## 安装证据

最终 tarball：`/tmp/midscene-package-smoke-final-20260914/zhchxiao123-dsh-devflow-midscene-0.4.0-dev.7.tgz`。

SHA256：`8655ed74d87c029099bd5a56048ee297bd3a9e1c722232a362227774b7e09127`。

最终独立安装的 CLI 运行：`8f94a59e-e14e-4a49-9859-12182b3a285e`，状态 passed；原始报告在 `/private/tmp/midscene-package-smoke-final-20260914/evidence/8f94a59e-e14e-4a49-9859-12182b3a285e/`。这是受控模型传输证据，不是 M1 真实模型证据。临时目录不是长期归档位置。

隔离 `DSH_HOME=/tmp/midscene-profile-smoke-20260914`，profile 为 `acceptance-final`。通过 Harness 0.1.5-rc.2 的 `dsh plugin add` 安装同一 tarball，`--dump-config` 识别 `devflow-midscene` 配置行。这个检查证明安装和组合，不代表 Web UI 已启动验收。

## 审查处理

规范审查指出 IPC 输入校验、诊断及计数一致性问题；已通过解码和边界测试处理。需求审查指出 detached 浏览器清理和报告迁移后链接不可达的问题；已修复，并补上异常退出收尾及报告检查期间取消。标准与需求两条审查线均保留对应复现测试。

## M1 剩余验收

1. 提供可使用的视觉模型配置文件路径或凭证环境变量名；不在对话或仓库写入密钥。
2. 准备目标 Devflow UI/profile 的环境 runbook、真实构建标记和试点卡片，将模板替换为版本化实际用例。
3. 从 Harness 对话运行成功和刻意失败用例，验证报告可打开、test-report 登记、失败门禁拒绝、取消及重启后的证据读取，记录实际用量。
4. 完成上述证据后确认 M1，再进入 M2 原生 Web 工具。
