# 如何贡献

本文档详细介绍如何为 ByClaw 项目做出贡献的具体步骤。

## 选择贡献方式

根据您的时间和技能，可以选择以下贡献方式：

| 方式 | 所需时间 | 技能要求 |
|------|---------|---------|
| 报告 Bug | 15-30 分钟 | 无 |
| 改进文档 | 30-60 分钟 | 基础写作 |
| 修复 Bug | 1-4 小时 | 相关技术 |
| 开发新功能 | 4+ 小时 | 相关技术 |
| 代码审查 | 30 分钟-1 小时 | 项目熟悉度 |

## 报告 Bug

### 好的 Bug 报告应该包含

1. **清晰的标题** - 一句话描述问题
2. **环境信息** - OS、浏览器/版本、ByClaw 版本
3. **复现步骤** - 详细的步骤说明
4. **预期行为** - 您期望发生什么
5. **实际行为** - 实际发生了什么
6. **错误信息** - 截图或日志
7. **附加信息** - 其他相关信息

### Bug 报告模板

```markdown
## Bug 描述
简要描述 Bug

## 环境信息
- OS: [例如 macOS 14.1]
- 浏览器: [例如 Chrome 120]
- ByClaw 版本: [例如 1.0.0]
- 部署方式: [例如 Docker]

## 复现步骤
1. 进入 '...'
2. 点击 '...'
3. 滚动到 '...'
4. 出现错误

## 预期行为
应该发生什么

## 实际行为
实际发生了什么

## 错误日志
```
粘贴错误日志
```

## 截图
如果有，添加截图
```

## 改进文档

### 可以改进的地方

- 修复拼写和语法错误
- 澄清不清晰的说明
- 添加缺失的示例
- 更新过时的信息
- 添加图示和截图
- 翻译文档

### 文档编辑流程

1. Fork 仓库
2. 编辑 `docs/` 目录下的文件
3. 本地预览（如使用 VitePress）
4. 提交 PR

## 修复 Bug

### 寻找 Bug

- 查看 [good first issue](https://github.com/beyondAI/byclaw/labels/good%20first%20issue) 标签
- 查看 [help wanted](https://github.com/beyondAI/byclaw/labels/help%20wanted) 标签
- 查看 [bug](https://github.com/beyondAI/byclaw/labels/bug) 标签

### Bug 修复流程

1. **确认 Bug** - 复现问题
2. **理解代码** - 阅读相关代码
3. **编写测试** - 添加失败测试用例
4. **修复 Bug** - 修改代码
5. **验证修复** - 测试通过
6. **提交 PR** - 创建 Pull Request

### 示例

```bash
# 1. Fork 并克隆
git clone https://github.com/YOUR_USERNAME/byclaw.git
cd byclaw

# 2. 创建分支
git checkout -b fix/login-error

# 3. 修复代码
# 编辑相关文件...

# 4. 运行测试
cd byclaw-be && mvn test
cd ../byclaw-fe && pnpm test

# 5. 提交
git add .
git commit -m "fix(be): resolve login error for special characters

- Fix username validation regex
- Add test for special characters in username

Fixes #123"

# 6. 推送
git push origin fix/login-error

# 7. 创建 PR
```

## 开发新功能

### 新功能流程

1. **讨论** - 在 Issue 中讨论功能设计
2. **设计** - 确定实现方案
3. **开发** - 编写代码
4. **测试** - 添加测试
5. **文档** - 更新文档
6. **审查** - 代码审查
7. **合并** - 合并到主分支

### 功能开发建议

- 从小功能开始
- 先创建 Issue 讨论
- 保持代码简洁
- 添加充分的测试
- 更新相关文档

## 代码审查

即使不编写代码，您也可以帮助审查代码：

### 审查内容

- 代码是否正确实现了功能
- 是否有更好的实现方式
- 是否遵循代码规范
- 是否有足够的测试
- 文档是否更新

### 审查方式

1. 查看 [Open PRs](https://github.com/beyondAI/byclaw/pulls)
2. 选择感兴趣的 PR
3. 阅读代码变更
4. 在相关行添加评论
5. 提交审查意见

## 回答问题

帮助回答其他用户的问题：

- GitHub Discussions
- GitHub Issues
- Stack Overflow

## 推广项目

- 在社交媒体上分享
- 撰写博客文章
- 制作视频教程
- 在技术社区推荐

## 获取帮助

如果您在贡献过程中需要帮助：

1. 查看 [文档](../)
2. 搜索现有 Issue
3. 在 Discussion 中提问
4. 联系维护者
