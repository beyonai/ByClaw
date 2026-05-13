# 快速入门

本指南帮助你在本地快速搭建 Beyond（鲸智百应）开发环境。

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18.20.0 | 推荐使用 nvm 或 Volta 管理 |
| pnpm | >= 8.0 | 推荐的包管理器 |
| Git | >= 2.0 | 版本控制 |

## 安装步骤

### 1. 安装 Node.js

```bash
# 使用 nvm
nvm install 18.20.0
nvm use 18.20.0

# 或使用 Volta
volta install node@18.20.0
```

### 2. 安装 pnpm

```bash
npm install -g pnpm
```

### 3. 克隆项目

```bash
git clone https://github.com/beyondAI/byclaw.git
cd byclaw
```

### 4. 安装依赖

```bash
pnpm install
```

### 5. 启动开发服务器

```bash
npm run dev
```

启动成功后访问 `http://localhost:8000`。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（支持热重载） |
| `npm run build` | 构建生产环境包 |
| `npm run lint` | 运行代码检查 |
| `npm run lint:fix` | 自动修复代码规范问题 |
| `npm run format` | 格式化代码 |
| `npm run test` | 运行单元测试 |
| `npm run test:coverage` | 生成测试覆盖率报告 |

## 开发配置

### API 代理

开发环境的 API 代理在 `.umirc.ts` 中配置：

```typescript
const target = 'http://10.10.196.92:8569';
```

修改 `target` 为你的后端 API 地址即可。

### 编辑器配置

推荐使用 VS Code，并安装以下扩展：

- ESLint
- Prettier
- Stylelint
- EditorConfig

项目已包含 `.editorconfig`，编辑器会自动应用格式化规则。

## 常见问题

### 安装依赖失败

如果安装依赖时遇到网络问题，项目已配置了 npmmirror 镜像源（`.npmrc`），通常不需要额外配置。

### 端口冲突

如果 8000 端口被占用，Umi 会自动尝试下一个可用端口，请查看终端输出。

### 内存不足

如果开发时遇到内存不足，使用：

```bash
npm run dev:memory
```

该命令会将 Node.js 最大内存设置为 4GB。

## 下一步

- 阅读 [架构设计](../architecture/README.md) 了解项目整体架构
- 阅读 [API 文档](../api/README.md) 了解服务层接口
- 阅读 [贡献指南](../../CONTRIBUTING.md) 了解如何参与开发
