# 贡献指南

感谢您对 ByClaw 项目的关注！本文档将指导您如何为 ByClaw 做出贡献。

## 行为准则

请遵守 [行为准则](../CODE_OF_CONDUCT.md)，保持友善和尊重的交流环境。

## 如何贡献

### 报告 Bug

如果您发现了 Bug，请通过 [GitHub Issues](https://github.com/beyondAI/byclaw/issues) 报告：

1. 确认该 Bug 尚未被报告
2. 创建新 Issue，使用 Bug 报告模板
3. 提供详细的复现步骤
4. 提供环境信息（OS、版本等）

### 提出新功能

1. 先查看是否有相似的 Issue
2. 创建新 Issue，使用功能请求模板
3. 清晰描述功能的用途和预期行为
4. 等待维护者反馈

### 提交代码

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 开发准备

### 环境要求

- Git
- Docker & Docker Compose V2
- Node.js >= 18.20.0, pnpm 9+
- JDK 21+
- Python 3.12+, uv（可选）

### 克隆仓库

```bash
git clone https://github.com/beyondAI/byclaw.git
cd byclaw
```

### 启动开发环境

```bash
# 启动中间件
cd deploy/middleware
sh start-all.sh

# 启动后端
cd ../../byclaw-be
mvn spring-boot:run

# 启动前端（新终端）
cd ../byclaw-fe
pnpm dev
```

详细请参考 [开发文档](../development/)。

## 提交规范

### Commit Message 格式

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `docs` | 文档更新 |
| `style` | 代码格式调整（不影响功能） |
| `refactor` | 重构（既不是新功能也不是修复） |
| `perf` | 性能优化 |
| `test` | 添加测试 |
| `chore` | 构建过程或辅助工具的变动 |

### Scope 范围

可选，表示影响的模块：

- `fe` - 前端
- `be` - 后端
- `data` - 数据处理
- `exe` - 执行器
- `docs` - 文档
- `deploy` - 部署

### 示例

```
feat(fe): add dark mode support

- Add theme toggle in settings
- Implement dark color palette
- Persist theme preference in localStorage

Closes #123
```

```
fix(be): resolve concurrent chat session issue

- Add distributed lock for session operations
- Handle race condition in message storage

Fixes #456
```

## 代码规范

### 前端

- 使用 TypeScript
- 遵循 ESLint 和 Prettier 配置
- 组件使用函数式编程

```bash
cd byclaw-fe
pnpm lint
pnpm tsc
```

### 后端

- 使用 Java 21 特性
- 遵循阿里巴巴 Java 开发手册
- 编写单元测试

```bash
cd byclaw-be
mvn -B verify
```

### Python

- 使用类型注解
- 遵循 PEP 8
- 使用 Ruff 进行代码检查
- 使用 uv 管理依赖

```bash
cd byclaw-data
uv run ruff check .
uv run ruff format .
```

## Pull Request 流程

### 创建 PR

1. 确保代码已通过所有检查
2. 更新相关文档
3. 添加必要的测试
4. 填写 PR 模板中的所有项目

### PR 模板

```markdown
## 描述
简要描述这个 PR 做了什么

## 类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 文档更新
- [ ] 性能优化
- [ ] 代码重构

## 检查清单
- [ ] 代码遵循项目规范
- [ ] 添加了必要的测试
- [ ] 更新了相关文档
- [ ] 本地测试通过

## 相关 Issue
Fixes #(issue 编号)
```

### 审核流程

1. 至少需要一个维护者审核
2. 所有 CI 检查必须通过
3. 根据反馈进行修改
4. 合并到主分支

## 开发指南

### 前端开发

参考 [前端开发指南](../development/frontend/)

### 后端开发

参考 [后端开发指南](../development/backend/)

### Python 开发

参考 [Python 开发指南](../development/python/)

## 文档贡献

文档贡献同样重要：

- 修复文档错误
- 完善使用说明
- 添加示例代码
- 翻译文档

文档位于 `docs/` 目录，使用 Markdown 格式。

## 社区

- GitHub Discussions - 讨论和问答
- GitHub Issues - Bug 报告和功能请求
- Pull Requests - 代码贡献

## 许可证

通过贡献代码，您同意将您的贡献在 [Apache License 2.0](../LICENSE) 下授权。
