# Midscene 集成依据

日期：2026-09-14。源码和文档已读取；未安装 SDK、未调用视觉模型、未进行真实浏览器验收。这里保存事实与验证入口，需求以总 PRD 为准。

## 本地基线

- 本地 Devflow main `fb2e14736b1580048e4953df58491f51e0ec52e2`：testenv 只贡献 runbook 技能，Harness agent 执行工作流。当前 worktree 精确基于此提交。
- 本轮读到远端 main `23d9f57d2347b01324cd02cb5912f5383f9d201d`，与本地 main 分叉；它仍有旧 testenv 执行器。PRD 不依赖该旧实现。
- 远端合并 `a3352bc` 的 HTML 相关变更只有文档和组合测试，说明 Markdown pointer + 独立文件模式；没有报告预览或通用附件导入服务。
- Harness 本地源码参考 `fb2c4b9e69`；插件实际依赖应通过发布包 `0.1.5-rc.2` 的公开接口验证，不依赖本地源码路径。

## 官方 Midscene

| 已核实的事实 | 一手来源 |
|---|---|
| 调研时 `@midscene/web/latest` 为 `1.12.6`；实施时精确锁定并验证 | [npm metadata](https://registry.npmjs.org/@midscene/web/latest) |
| Playwright page 可交给 PlaywrightAgent，已有 fixture 和 reporter | [Playwright 集成](https://midscenejs.com/integrate-with-playwright) |
| MCP 已退役，最后支持版本是 `1.9.8` | [MCP 说明](https://midscenejs.com/mcp) |
| 官方提供平台 CLI + Skills，新 Midscene Test 标为 Beta | [Skills](https://midscenejs.com/skills)、[Test](https://midscenejs.com/midscene-test/overview) |
| v1.12.6 有 progress/dump listener、模型实例配置及 aiAct abortSignal | [固定版本 Agent 源码](https://github.com/web-infra-dev/midscene/blob/v1.12.6/packages/core/src/agent/agent.ts) |
| 报告可转换 Markdown 或拆出 JSON/图片；解析结构可能变化 | [报告处理](https://midscenejs.com/consume-report-file) |
| 模型配置独立；不能推断 Harness 主模型和用量预算自动覆盖 Midscene | [模型配置](https://midscenejs.com/model-config)、[API](https://midscenejs.com/reference/) |

完整取消仍需验证 SDK 正在执行的动作/请求能否及时停止；设置 abortSignal 不证明资源已经释放。原始报告最终化与自有 browser/context 关闭属于实际集成责任。

## 社区插件

源码基线 `158f751a9cd64ba7ac0204c914474abccedf8649`，插件 `0.1.1`，Midscene `1.11.0`，开发依赖 Harness `0.0.1-rc.5`。[manifest](https://github.com/ciky20171114/dsh-plugin-midscene/blob/158f751a9cd64ba7ac0204c914474abccedf8649/package.json)

可参考 service/provider/tool 分层、单工具 action 分派及外部 Chrome 只 disconnect 的所有权原则。必须重做目标路由、调用取消、清理失败、结果 metadata 和依赖验证。两个工具共享同一服务，没有证明 Web/Android 目标隔离；Web 运行时 import puppeteer，但 manifest 仅列 devDependency。

**断言错误已由源码确认：** v1.11.0 默认 aiAssert 通过返回 undefined，失败抛错；只有 keepRawResponse 返回对象。插件工具不传该选项，provider 却用 `result?.pass ?? false`，将通过映射成失败。其 mock 测试没有证明真实 SDK 行为。[SDK](https://github.com/web-infra-dev/midscene/blob/v1.11.0/packages/core/src/agent/insight.ts#L114-L169)、[provider](https://github.com/ciky20171114/dsh-plugin-midscene/blob/158f751a9cd64ba7ac0204c914474abccedf8649/src/web.ts)、[tool](https://github.com/ciky20171114/dsh-plugin-midscene/blob/158f751a9cd64ba7ac0204c914474abccedf8649/src/tool.ts)、[tests](https://github.com/ciky20171114/dsh-plugin-midscene/blob/158f751a9cd64ba7ac0204c914474abccedf8649/tests/web.spec.ts)

keepRawResponse 也会将部分 TaskExecutionError 转成 pass:false，不能仅开启它就宣布基础设施错误分类正确。需要用所选 SDK 重验成功、断言失败和不可用路径。

## 已存在的 Devflow/Harness 接口

- Devflow attachArtifact：path 必须在卡片目录；kind + content 由 store 写 Markdown。登记需要真实 actor、当前 revision 与可写阶段。
- Command gate：运行配置命令；不能在同一卡片 transition waterfall 内调用 attachArtifact。首版真实重跑，历史报告不缓存放行。
- Artifact gate：检查配置的 Markdown 结构；不自动证明报告来源、业务内容正确或代码新鲜度。
- Harness defineTool：exec.signal、结构化 output、可持久化 presentationMeta；Web 展示需客户端 slot，不能只写 Host presenter。
- jobs-local：提供 owner 隔离、输出和取消，记录在内存；跨重启只保留本集成自己写出的结果文件，不保留活跃 job。

源码阅读地图与实施命令见 [交付计划](2026-09-14-devflow-midscene-delivery.md)。实现前核对选定 worktree 与已发布包的具体契约，再决定最小修改面。
