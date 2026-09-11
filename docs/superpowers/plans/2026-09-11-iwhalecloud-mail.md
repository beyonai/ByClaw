# Iwhalecloud Mail Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 网页账号连接器与 mail 只读 bycli 支持；knowledge-collection 仅设计。
**Architecture:** ACCOUNT_TEMPLATE 复用现有账号服务。独立 Node 包装调用 bycli 与既有 bridge bootstrap，输出统一安全 JSON，不改凭据投影。
**Tech Stack:** Node.js builtins / node:test、Python unittest、Maven。
**Spec:** docs/superpowers/specs/2026-09-11-iwhalecloud-mail-bycli-integration-design.md

## Global Constraints

- 不操作生产服务；不提交无关现存改动。
- 迁移版本必须由用户指定，未指定前不创建或编辑 DDL/DML。
- 单附件 25 MiB、任务附件累计 100 MiB；固定只读命令；Cookie 不出浏览器。
- knowledge-collection 执行代码不变。

## Task 1: mail bycli 边界

Files: 新建 middleware/openclaw/skills/mail/scripts/iwhalecloud-mail.mjs、iwhalecloud/process.mjs、iwhalecloud/download.mjs；测试 scripts/iwhalecloud-mail.test.mjs。
Interface: execute(request, deps) 返回 {schemaVersion, source, sourceSkill, backend, operation, ok, status, items, coverage, error?}。
- [x] 写失败测试：check 空邮箱成功；read 保留完整正文、删除未知凭据字段；拒绝写操作；错误不泄露 raw stderr。
```js
assert.equal((await execute({operation:'send'})).error.code, 'UNSUPPORTED');
```
- [x] 运行 node --test middleware/openclaw/skills/mail/scripts/iwhalecloud-mail.test.mjs 确认 RED。
- [x] 实现固定参数数组、分页校验、单次 bootstrap、安全结果字段、错误映射。
- [x] 加附件测试：只接受单个 ID，预检查/运行中限制、路径逃逸、重名不覆盖、失败清理与累计预算。
- [x] 实现 private staging + exclusive publication + session lock，运行 Node 测试。

## Task 2: 连接器与技能接线

Files: mail/SKILL.md、mail/README.md、现有镜像 Dockerfile；deploy/migrations/versions/V0.5.0/V0.5.0__dml.sql。
- [x] 更新技能路由：浩鲸绕过 mailctl accounts，调用 Node 包装；账号上下文歧义先解析。
- [x] 新增/更新部署文档和构建能力检查，确认实际镜像入口的 bycli/扩展配套。
- [x] 按用户指定 V0.5.0 写 ACCOUNT_TEMPLATE 幂等迁移，模板数据为 iwhalecloud-mail-web / 浩鲸邮箱 / CustomLink / https://mail.iwhalecloud.com/。
- [ ] 运行相关技能契约测试；如修改 BE 则运行 mvn -B -f byclaw-be/pom.xml verify。

## Task 3: 验证交付

- [ ] Node 测试、现有 mail Python 测试与相关镜像/技能测试。
- [ ] 审查 diff、敏感信息、路径与命令边界；报告未具备真实登录验证、迁移版本等实际限制。
- [ ] 向用户说明登录→读取→下载→未来知识采集流程；保持文档本地，不自动提交。
