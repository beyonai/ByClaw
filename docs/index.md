---
layout: home

hero:
  name: ByClaw
  text: 鲸智百应
  tagline: 企业级 AI 智能助手平台
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started/
    - theme: alt
      text: 部署指南
      link: /deployment/
    - theme: alt
      text: GitHub
      link: https://github.com/beyondAI/byclaw

features:
  - icon: 🤖
    title: AI 智能对话
    details: 集成多模型 AI 能力，支持文本、语音、文件等多模态交互
  - icon: 📚
    title: 知识中心
    details: 企业知识库管理，支持文档上传、检索与智能问答
  - icon: 👤
    title: 数字员工
    details: 可配置的 AI Agent，覆盖多种业务场景
  - icon: 🛠️
    title: 开放扩展
    details: 灵活的插件系统，易于集成和扩展
---

## 快速开始

### 前置条件

- Docker & Docker Compose
- Git

### 一键启动

```bash
git clone https://github.com/beyondAI/byclaw.git
cd byclaw

# 复制环境配置
cp .env.example .env

# 启动中间件和单体应用
cd deploy/middleware && sh start-all.sh
cd ../mono && sh start-all.sh
```

访问 http://localhost:8080 开始使用。

## 技术栈

| 前端 | 后端 | 基础设施 |
|------|------|----------|
| React 18 | Spring Boot 3.4 | PostgreSQL / OpenGauss |
| Umi Max 4 | Java 21 | Redis |
| TypeScript 5 | LangChain4j / MCP | MinIO |
| Ant Design 5 | Spring AI / Kafka | Docker |

---

<p align="center">
  <a href="./getting-started/">开始使用</a> •
  <a href="./architecture/">了解架构</a> •
  <a href="./api/">查看 API</a> •
  <a href="./contributing/">参与贡献</a>
</p>

<p align="center">
  Apache License 2.0 © BeyondAI
</p>
