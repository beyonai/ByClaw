# 发布流程

本文档介绍 ByClaw 的版本发布流程。

## 版本号规范

ByClaw 使用 [语义化版本](https://semver.org/lang/zh-CN/) (SemVer)：

```
主版本号.次版本号.修订号

例如：1.2.3
```

| 版本号 | 说明 | 示例 |
|--------|------|------|
| 主版本号 | 不兼容的 API 修改 | 1.0.0 → 2.0.0 |
| 次版本号 | 向下兼容的功能新增 | 1.0.0 → 1.1.0 |
| 修订号 | 向下兼容的问题修复 | 1.0.0 → 1.0.1 |

## 发布周期

| 类型 | 频率 | 说明 |
|------|------|------|
| 主版本 | 不定期 | 重大架构变更 |
| 次版本 | 每月 | 新功能发布 |
| 修订版本 | 每周 | Bug 修复 |
| 热修复 | 按需 | 紧急问题修复 |

## 发布前准备

### 1. 创建发布分支

```bash
# 从 main 分支创建
git checkout main
git pull origin main
git checkout -b release/v1.2.0
```

### 2. 更新版本号

#### 前端

```json
// byclaw-fe/package.json
{
  "version": "1.2.0"
}
```

#### 后端

```xml
<!-- byclaw-be/pom.xml -->
<version>1.2.0</version>
```

#### Python

```toml
# byclaw-data/pyproject.toml
[project]
version = "1.2.0"
```

### 3. 更新 CHANGELOG

```markdown
## [1.2.0] - 2024-01-15

### 新增
- 添加知识库协作编辑功能
- 支持更多文档格式（PPT、Excel）
- 新增数字员工批量导入

### 修复
- 修复大文件上传超时问题
- 修复聊天记录导出格式错误

### 优化
- 优化 AI 响应速度
- 改进移动端界面适配
```

### 4. 全面测试

```bash
# 前端
cd byclaw-fe
pnpm lint && pnpm test && pnpm build

# 后端
cd byclaw-be
mvn clean verify

# Python
cd byclaw-data
ruff check . && pytest
```

### 5. 验证部署

```bash
# 构建 Docker 镜像
docker build -t byclaw-all:v1.2.0 -f Dockerfile-all .

# 本地测试部署
docker-compose -f deploy/mono/docker-compose.yml up
```

## 正式发布

### 1. 合并到主分支

```bash
# 创建 PR 合并 release 分支到 main
git push origin release/v1.2.0

# 在 GitHub 创建 PR
# 标题: Release v1.2.0
# 标签: release
```

### 2. 创建 Git Tag

```bash
# 切换到 main
git checkout main
git pull origin main

# 创建 tag
git tag -a v1.2.0 -m "Release version 1.2.0"

# 推送 tag
git push origin v1.2.0
```

### 3. 创建 GitHub Release

1. 访问 [Releases](https://github.com/beyondAI/byclaw/releases)
2. 点击 "Draft a new release"
3. 选择 tag: `v1.2.0`
4. 填写发布说明（复制 CHANGELOG）
5. 附加构建产物（可选）
6. 发布 Release

### 4. 构建并推送镜像

```bash
# 登录镜像仓库
docker login ghcr.io

# 构建并推送
./scripts/build-and-push.sh v1.2.0
```

### 5. 更新文档站点

```bash
# 如果文档使用独立部署
cd docs
npm run build
npm run deploy
```

### 6. 通知社区

- 在 Discussion 发布版本说明
- 在社交媒体分享
- 发送邮件通知（如有邮件列表）

## 热修复流程

对于紧急 Bug 修复：

### 1. 从最新 tag 创建分支

```bash
git checkout -b hotfix/v1.2.1 v1.2.0
```

### 2. 修复 Bug

```bash
# 修复代码
git add .
git commit -m "fix: resolve critical security issue"
```

### 3. 快速发布

```bash
# 更新版本号到 1.2.1
# 更新 CHANGELOG

# 创建 PR 到 main
git push origin hotfix/v1.2.1

# 合并后创建 tag
git tag -a v1.2.1 -m "Hotfix v1.2.1"
git push origin v1.2.1
```

## 发布后检查

- [ ] Docker 镜像可正常拉取
- [ ] 新部署工作正常
- [ ] 升级文档清晰
- [ ] 无重大 Bug 报告
- [ ] 性能指标正常

## 回滚方案

如果发布后出现严重问题：

```bash
# 快速回滚到上一版本
docker pull ghcr.io/beyondai/byclaw:v1.1.9

# 更新部署
docker-compose up -d

# 通知用户
```

## 自动化发布（规划中）

未来计划实现的自动化：

- [ ] 自动版本号更新
- [ ] 自动 CHANGELOG 生成
- [ ] 自动构建和测试
- [ ] 自动镜像推送
- [ ] 自动 GitHub Release
