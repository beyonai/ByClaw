# Devflow Midscene 交付计划

## 文档与任务入口

需求权威：[总 PRD](2026-09-14-devflow-midscene.md)。用户选择仅使用本地 Markdown tracker，不发布 GitHub Issue，不创建远端标签。PRD frontmatter 的 `labels` 承载本地分类；`ready-for-agent` 表示已整理成可执行需求，实际开始实现仍遵循 Trellis 规划流程。

| 任务 | 交付 | 依赖 | 对应需求 |
|---|---|---|---|
| `09-14-devflow-midscene` | 共同范围、基线、M1/M2 集成验收 | 无 | 全部用户故事 |
| `09-14-midscene-web-acceptance` | 验收技能、Playwright/Midscene 用例、报告与门禁 | 总 PRD | 用户故事 1–22、30–34；M1 |
| `09-14-midscene-native-web` | 原生 Web provider/工具、隔离、生命周期和结果重放 | M1 实际通过 | 用户故事 9–16、19–34；M2 |

任务位于 DSH 父工作区的 Trellis 任务目录；本 worktree 保存可随 Git 交付的总 PRD、计划和调研记录。任务的 prd/design/implement 是范围拆分与执行指引，需求冲突以总 PRD 为准。

## 基线

- Worktree：`dsh-devflow-plugins-midscene`；分支：`feat/devflow-midscene`。
- 基于本地 main `fb2e14736b1580048e4953df58491f51e0ec52e2`，不是业务知识分支，也没有复制源工作区未提交文件。
- 调研本轮发现远端 main `23d9f57d2347b01324cd02cb5912f5383f9d201d` 与本地 main 分叉：远端仍有 testenv 执行器，本地 main 已改为 runbook 技能。开发基线沿用本地 main；合并到远端前单独评估分叉，不隐式恢复旧实现。
- 远端 `a3352bc` 的 HTML 相关合并只增加了 pointer + separate-file 文档和组合测试，没有 HTML 报告预览功能。可参考其模式，不把它当作已存在的附件导入服务。
- Harness 公共依赖精确固定 `0.1.5-rc.2`；不以本地 Harness 未发布源码代替插件依赖。

## 阶段一执行顺序

1. 在新 worktree 读取相关规范与现有环境 runbook；如没有可执行 runbook，先完成只针对本试点的环境启动/检查/停止指引。
2. 固定 Playwright/Midscene/视觉模型配置，建立真实 SDK 断言契约探针；覆盖成功、失败与基础设施错误。
3. 编写最小 Devflow 导航用例及可控预期失败，用例覆盖映射到验收标准。浏览器及测试数据隔离。
4. 实现运行清单、有限结果字段和独立报告产出；通过 Harness shell/jobs 显示输出并支持取消。对超时、部分完成、零用例和重启中断给出明确分类。
5. 通过既有产物工具写 Markdown 测试摘要；配置完成边真实重跑验收。门禁此次运行与先前预检查的 runId、报告及用途分开显示，不能用预检查通过替代门禁结果。
6. 从真实 Loader/profile 跑完整正向、预期失败、取消/超时和重启读取路径；记录 M1 证据。
7. 按影响范围完成质量检查、构建与打包。M1 只有在真实视觉模型与浏览器证据齐备后才能通过。

## 阶段二执行顺序

1. 先读 M1 证据，复用实际稳定的结果与报告约定。不得在阶段一尚未实际通过时开写阶段二。
2. 基于当前 Harness defineTool、provider、jobs 和 Client slot 实现 Web 目标的完整服务/消费路径；避免把七个旧转发方法原样搬过来。
3. 目标身份、owner、卡片归属和串行访问统一校验；覆盖自有 Chromium 与连接已有测试浏览器两种所有权。
4. 串联前台 signal、后台 job cancel、硬超时与资源清理；停止真实工作后才报告停止完成。
5. 将进度、结果、用量与报告引用接入已有工具/任务显示，持久化重放需要的元数据。
6. 通过真实 Loader、两个隔离目标、跨 owner 拒绝、卸载清理与会话重放验证 M2。用同一验收用例比较脚本入口和工具入口的外部结果。
7. 验证安装依赖、tarball、隔离 profile、真实浏览器与视觉模型路径，分别列出通过和未通过的检查。

## 测试入口与质量要求

主要测试入口是“真实 Harness 组合中的工具/命令调用 → 报告 → Devflow 产物 → 门禁结果”。SDK 级测试用于证明真实第三方契约，不代替这个组合入口。真实模型、真实浏览器验收与 keyless 测试分开运行和记录。

实现阶段按受影响范围运行仓库 `typecheck`、`lint`、普通测试及逐文件覆盖率；构建后执行 `preflight:tarballs`。先检查 package scripts 和所需运行时，再执行命令。本文档规划不安装依赖、不运行产品测试，也不自动发布或部署。

## 实施前阅读地图

- 本 worktree 的 AGENTS、Devflow 架构说明、testenv、artifact-gate、gates、tool、web、ui 与 parent-gate 文档。
- 父工作区 `.trellis/spec/dsh-devflow-plugins/` 下相关包规范。部分 spec 可能仍描述旧 testenv，遇到差异以已核实的选定源码基线为准并记录需更新之处。
- Harness 工具添加指南、jobs 类型与生命周期说明、公开发布包导出；外部插件只能依赖公开入口。
- [调研证据](2026-09-14-devflow-midscene-research.md)。其中 2026-09-14 版本信息是采样值，实施时需重新确认并精确固定。

## 完成与回退

- 阶段一和阶段二各自形成独立可审查变更；本规划不创建产品提交。后续不得把用户其他工作区改动混入。
- 阶段二可通过移除可选插件组合回退，阶段一脚本验收继续可用；历史报告仍可读。
- 验收失败不移动卡片至 done，环境失败不假装为代码断言失败，缺少真实模型证据不冒充 M1/M2 通过。

## 本轮规划校验

已检查 PRD 七个模板章节、34 条用户故事、文档链接、父子任务关系、阶段依赖与 planning 状态。Trellis 上下文清单验证通过，超出注入大小的架构长文已改为按需阅读。验证器在无 Git 的 DSH 父目录报告分支不存在；已通过实际插件仓库的 `show-ref` 和 worktree HEAD 独立确认 `feat/devflow-midscene` 存在且指向 `fb2e147`。本轮只写规划文档，未运行产品测试。
