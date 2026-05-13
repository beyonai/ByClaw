# 开发指南

本文档面向希望参与 ByClaw 开发或进行二次开发的开发者。

## 开发环境

在开始之前，请确保已配置好开发环境：

- [开发环境搭建](../getting-started/development.md)

## 模块开发指南

| 模块 | 技术栈 | 文档 |
|------|--------|------|
| byclaw-fe | React 18 + Umi Max 4 + TypeScript 5 | [前端开发指南](./frontend/) |
| byclaw-be | Spring Boot 3.4 + Java 21 | [后端开发指南](./backend/) |
| byclaw-data / byclaw-qa | Python 3.12 + uv | [Python 开发指南](./python/) |

## 开发工作流

### 1. Fork 仓库

```bash
# Fork 到自己的账号
git clone https://github.com/YOUR_USERNAME/byclaw.git
cd byclaw
```

### 2. 创建分支

```bash
git checkout -b feature/your-feature-name
```

### 3. 开发

- 编写代码
- 添加测试
- 更新文档

### 4. 提交

```bash
git add .
git commit -m "feat: add new feature"
```

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

### 5. 推送并创建 PR

```bash
git push origin feature/your-feature-name
```

然后到 GitHub 创建 Pull Request。

## 代码规范

### 提交信息规范

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `docs` | 文档更新 |
| `style` | 代码格式调整 |
| `refactor` | 重构 |
| `test` | 测试相关 |
| `chore` | 构建/工具相关 |

示例：
```
feat: add knowledge base search filter

- Add filter by document type
- Add filter by upload date
- Update API documentation
```

## 贡献指南

详细贡献流程请参考 [贡献指南](../contributing/)。

## 调试技巧

### 前端调试

- 使用 React DevTools 浏览器扩展
- 在 VS Code 中配置断点调试
- 使用 Umi 的 `MFSU` 加速开发

### 后端调试

- 使用 IDE 的 Remote Debug 功能
- 启用详细日志：`logging.level.root=DEBUG`
- 使用 Actuator 端点检查状态

### Python 调试

- 使用 `pdb` 或 `ipdb` 断点调试
- 使用 `uv run` 运行脚本
- 使用 `logging` 模块记录调试信息

## 常见问题

### 依赖安装失败

- 前端：检查 Node.js 版本，清除缓存重试
- 后端：检查 Maven 配置和 JDK 版本
- Python：使用虚拟环境，检查 Python 版本

### 服务启动失败

- 检查端口是否被占用
- 检查环境变量配置
- 检查中间件是否已启动

更多问题请参考 [FAQ](../getting-started/faq.md)。
