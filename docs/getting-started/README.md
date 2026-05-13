# 快速开始

欢迎使用 ByClaw！本指南将帮助你在几分钟内启动并运行 ByClaw。

## 选择你的路径

| 方式 | 适用场景 | 难度 |
|------|---------|------|
| [Docker 部署](#docker-部署) | 生产环境、快速体验 | ⭐⭐ |
| [本地开发](#本地开发) | 开发调试、二次开发 | ⭐⭐⭐ |

## Docker 部署

### 前置条件

- Docker >= 20.10
- Docker Compose >= 2.0
- Git

### 1. 克隆仓库

```bash
git clone https://github.com/beyondAI/byclaw.git
cd byclaw
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置必要的环境变量
```

### 3. 启动服务

**单体模式**（推荐快速体验）：

```bash
cd deploy/middleware && sh start-all.sh
cd ../mono && sh start-all.sh
```

访问 http://localhost:8080 即可使用。

详细部署选项请参考 [部署文档](../deployment/)。

## 本地开发

### 前置条件

| 模块 | 要求 |
|------|------|
| 前端 | Node.js >= 18.20.0, pnpm 9+ |
| 后端 | JDK 21+, Maven 3.3.9+ |
| Python | Python 3.12+, uv（可选） |

### 启动中间件

```bash
cd deploy/middleware
sh start-all.sh
```

这会启动 Redis、MinIO、OpenGauss、OpenSandbox。

### 启动后端

```bash
cd byclaw-be
mvn spring-boot:run
```

### 启动前端

```bash
cd byclaw-fe
pnpm install
pnpm dev
```

访问 http://localhost:8000 进行开发调试（本地 dev server 端口，部署时为 8080）。

详细开发指南请参考 [开发文档](../development/)。

## 下一步

- [安装指南](./installation.md) - 详细的安装步骤
- [开发环境配置](./development.md) - 本地开发完整指南
- [部署文档](../deployment/) - 生产环境部署
- [常见问题](./faq.md) - 常见问题解答
