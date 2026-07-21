# AGENTS.md

本文件只定义当前 monorepo 的共同开发规则。各模块的架构细节由模块内 `AGENTS.md` 单独约束。

## 当前阶段

- v1 采用最小骨架：只保留 `packages/by-conductor` 与 `apps/byclaw-super` 两个包；
- 适配器（Pi / OpenClaw / by-framework）作为 `apps/byclaw-super/src/adapters/` 下的目录，暂不独立成包；
- 新建 TypeScript 文件只允许写职责注释或最小入口，除非用户明确要求开始实现；
- 旧 Fastify/Pi/SSE 示例保存在 `legacy/fastify-pi-starter/`；
- 不要在 legacy 中继续开发新能力，也不要未经明确要求删除 legacy；
- 不要提前添加数据库、Redis、HTTP 或 Runtime 的真实接线代码；
- 当某个适配器接缝真的需要独立发布或被外部依赖时，再从目录提升为包。

## Workspace 边界

- `packages/by-conductor/` 是通用编排核心，框架中立；
- `apps/byclaw-super/` 是可部署的多租户服务，承载所有入站协议与适配器装配；
- `by-conductor` 不得依赖 `apps/byclaw-super`；
- 具体 SDK 类型（Pi / OpenClaw / by-framework / Fastify）不得泄漏到 `by-conductor` 的 `domain/`；
- 跨包依赖只能通过公开入口或端口，禁止导入其他包的内部 `src/` 路径。

## 共同规则

1. 只修改任务所需文件，不做无关重构。
2. 保持严格 TypeScript、ESM 和 NodeNext 解析方式。
3. 新行为必须有测试；协议边界优先提供 contract test。
4. 架构、配置、API 或事件变化需要同步更新相应 README/ADR。
5. 不提交 Token、API Key、私有连接串或生产凭据。
6. 不修改 `dist/`、覆盖率报告或其他生成文件。
7. 依赖 Pi SDK 和 by-framework 的代码只能进入 `apps/byclaw-super/src/adapters/` 或入站适配器。

## 验证

在仓库根目录运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

只改文档或职责注释时，至少执行 `pnpm typecheck` 和 `pnpm build`。无法执行时在交付说明中列出未验证项。
