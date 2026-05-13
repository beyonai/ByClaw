# Beyond (鲸智百应)

> 基于 React 18 + Umi Max + TypeScript 构建的企业级 AI 智能助手平台

[![CI](https://github.com/beyondAI/byclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/beyondAI/byclaw/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18.20.0-green.svg)](.nvmrc)

---

## 核心特性

- **AI 智能对话** - 集成多模型 AI 能力，支持文本、语音、文件等多模态交互
- **知识中心** - 企业知识库管理，支持文档上传、检索与智能问答
- **数字员工** - 可配置的 AI Agent，覆盖多种业务场景
- **工作中心** - 任务管理与协作，AI 辅助工作流
- **多端适配** - 支持 PC 端与移动端，响应式布局
- **管理后台** - 数字员工管理、仪表盘、运营监控
- **国际化** - 内置中英文支持，可扩展多语言

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + Umi Max 4 |
| UI 库 | Ant Design 5 |
| 语言 | TypeScript 5 |
| 状态管理 | Zustand + dva |
| 数据请求 | Axios + React Query |
| 富文本 | Slate.js |
| 图表 | ECharts 5 |
| 样式 | Less (CSS Modules) |
| 测试 | Jest + React Testing Library |
| 代码规范 | ESLint + Prettier + Stylelint |

## 快速开始

### 前置条件

- **Node.js** >= 18.20.0（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理版本）
- **pnpm** >= 8.0（推荐的包管理器）

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/beyondAI/byclaw.git
cd byclaw

# 安装依赖
pnpm install

# 启动开发服务器
npm run dev
```

启动后访问 `http://localhost:8000`。

### 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产环境包
npm run lint         # 代码检查（ESLint + Stylelint + Prettier）
npm run lint:fix     # 自动修复代码规范问题
npm run test         # 运行单元测试
npm run test:coverage # 生成测试覆盖率报告
npm run format       # 格式化代码
```

## 项目结构

```
byclaw/
├── .github/              # GitHub Actions & 模板
│   ├── workflows/        # CI/CD 流水线
│   └── ISSUE_TEMPLATE/   # Issue 模板
├── .ai/                  # AI 编程规范
├── docs/                 # 项目文档
│   ├── quick-start/      # 快速入门
│   ├── architecture/     # 架构设计
│   └── api/              # API 文档
├── src/                  # 源代码
│   ├── assets/           # 静态资源
│   ├── components/       # 公共组件
│   ├── constants/        # 常量定义
│   ├── hooks/            # 自定义 Hooks
│   ├── layout/           # 布局组件
│   │   ├── pc/           # PC 端布局
│   │   ├── mobile/       # 移动端布局
│   │   └── managerLayout/# 管理后台布局
│   ├── locales/          # 国际化
│   ├── models/           # 状态管理
│   ├── pages/            # 页面组件
│   │   ├── chat/         # AI 对话
│   │   ├── manager/      # 管理后台（仪表盘、数字员工管理）
│   ├── service/          # API 服务层
│   ├── styles/           # 全局样式
│   ├── typescript/       # 类型定义
│   └── utils/            # 工具函数
├── config/               # 构建配置
├── public/               # 静态资源（不经 webpack 处理）
├── scripts/              # 自动化脚本
├── .umirc.ts             # Umi 主配置
├── tsconfig.json         # TypeScript 配置
├── package.json          # 项目元数据
└── Dockerfile            # 容器化构建
```

## 构建与部署

### 构建生产包

```bash
npm run build

# 自定义 publicPath
npm run build -- --publicPath=/custom/path/
```

构建产物输出到 `dist/` 目录。

### 静态部署（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }

    location /byaiService/ {
        proxy_pass http://your-backend-api/byaiService/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 容器化部署（Docker）

```bash
# 构建镜像
docker build -t beyond-frontend .

# 运行容器
docker run -d -p 8080:8080 beyond-frontend
```

## 环境配置

### API 代理

在 `.umirc.ts` 中配置后端 API 代理：

```typescript
const target = 'http://your-api-server:8569';
```

### 路由配置

路由定义位于 `config/route.config.ts`。

## 文档

- [快速入门](docs/quick-start/README.md)
- [架构设计](docs/architecture/README.md)
- [API 文档](docs/api/README.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)

## 参与贡献

我们欢迎所有形式的贡献！请阅读 [贡献指南](CONTRIBUTING.md) 了解如何参与。

## 社区

- [GitHub Issues](https://github.com/beyondAI/byclaw/issues) - Bug 反馈与功能建议
- [GitHub Discussions](https://github.com/beyondAI/byclaw/discussions) - 问答与交流

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。

Copyright 2026 beyondAI
