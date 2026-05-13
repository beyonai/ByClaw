# ByClaw 文档中心

欢迎来到 ByClaw（鲸智百应）文档中心！

## 什么是 ByClaw？

ByClaw 是一个企业级 AI 智能助手平台，提供：

- **AI 智能对话** - 多模型支持，支持文本、语音、文件等多模态交互
- **知识中心** - 企业知识库管理，文档上传、检索与智能问答
- **数字员工** - 可配置的 AI Agent，覆盖多种业务场景
- **工作中心** - 任务管理与协作，AI 辅助工作流

## 快速导航

| 读者 | 推荐入口 |
|------|---------|
| 🚀 **想快速体验** | [快速开始](./getting-started/) |
| 📖 **想部署使用** | [部署指南](./deployment/) |
| 🏗️ **想了解架构** | [架构设计](./architecture/) |
| 👨‍💻 **想开发贡献** | [开发指南](./development/) |
| 🔌 **想集成 API** | [API 文档](./api/) |
| ❓ **遇到问题** | [常见问题](./getting-started/faq.md) |

## 目录结构

```
docs/
├── getting-started/     # 入门指南
├── architecture/        # 架构文档
├── guide/               # 用户指南（使用手册）
├── api/                 # API 文档
├── deployment/          # 部署文档
├── development/         # 开发指南
├── contributing/        # 贡献指南
└── assets/              # 图片等资源
```

## 项目模块

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| [byclaw-fe](../byclaw-fe/) | React + Umi Max + TypeScript | 前端 Web 应用 |
| [byclaw-be](../byclaw-be/) | Spring Boot 3 + Java 21 | 后端服务 |
| [byclaw-exe](../byclaw-exe/) | Python | 扩展插件和技能脚本 |
| [byclaw-data](../byclaw-data/) | Python (uv) | 数据云服务（Agent 编排） |
| [byclaw-qa](../byclaw-qa/) | Python (uv) | QA 管理和 Agent 服务 |

## 相关链接

- [项目首页](../README.md)
- [贡献指南](../CONTRIBUTING.md)
- [行为准则](../CODE_OF_CONDUCT.md)
- [更新日志](../CHANGELOG.md)
- [许可证](../LICENSE)
