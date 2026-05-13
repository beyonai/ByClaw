# 技术栈

本文档详细介绍 ByClaw 使用的技术栈及选型理由。

## 前端技术栈

### 核心框架

| 技术 | 版本 | 用途 |
|------|------|------|
| [React](https://react.dev/) | 18.2 | UI 组件库 |
| [Umi Max](https://umijs.org/docs/max/introduce) | 4.4 | 企业级前端框架 |
| [TypeScript](https://www.typescriptlang.org/) | 5 | 类型安全 |

### UI 组件

| 技术 | 版本 | 用途 |
|------|------|------|
| [Ant Design](https://ant.design/) | 5.27 | 组件库（自定义前缀 `beyond`） |

### 状态管理

| 技术 | 用途 |
|------|------|
| [Zustand](https://github.com/pmndrs/zustand) | 全局状态 |
| [DVA](https://dvajs.com/) | Redux 模型（Umi 内置） |
| [React Query](https://tanstack.com/query/) | 服务端状态 |

### 数据可视化

| 技术 | 用途 |
|------|------|
| [ECharts](https://echarts.apache.org/) | 图表 |

### 富文本 / Markdown

| 技术 | 用途 |
|------|------|
| [Slate.js](https://www.slatejs.org/) | 富文本编辑器 |
| [react-markdown](https://github.com/remarkjs/react-markdown) | Markdown 渲染 |
| [Shiki](https://shiki.style/) | 代码高亮 |
| [KaTeX](https://katex.org/) | 数学公式渲染 |

### 构建与工具

| 技术 | 版本 | 用途 |
|------|------|------|
| [pnpm](https://pnpm.io/) | 9 | 包管理 |
| [Webpack](https://webpack.js.org/) | - | 构建（通过 Umi） |
| [ESLint](https://eslint.org/) | 8 | 代码检查 |
| [Prettier](https://prettier.io/) | 2.8 | 代码格式化 |
| [Stylelint](https://stylelint.io/) | 16 | 样式检查 |

### 测试

| 技术 | 用途 |
|------|------|
| [Jest](https://jestjs.io/) | 单元测试 |

### 其他关键依赖

| 技术 | 用途 |
|------|------|
| [ahooks](https://ahooks.js.org/) | React Hooks 库 |
| [axios](https://axios-http.com/) | HTTP 客户端 |
| [@fortaine/fetch-event-source](https://github.com/AzureAD/microsoft-authentication-library-for-js) | SSE 流式响应 |
| [crypto-js](https://github.com/brix/crypto-js) / [jsencrypt](https://github.com/nicktrav/jsencrypt) | 请求签名与加密 |
| [react-dnd](https://react-dnd.github.io/react-dnd/) | 拖拽交互 |
| [motion](https://motion.dev/) | 动画 |
| [recorder-core](https://github.com/nicktrav/Recorder) | 音频录制 |

---

## 后端技术栈

### 核心框架

| 技术 | 版本 | 用途 |
|------|------|------|
| [Java](https://openjdk.org/) | 21 | 编程语言 |
| [Spring Boot](https://spring.io/projects/spring-boot) | 3.4.5 | 应用框架 |
| [Spring Cloud](https://spring.io/projects/spring-cloud) | 2024.0.1 | 微服务基础设施 |
| [Spring Security](https://spring.io/projects/spring-security) | 6.5 | 安全框架 |
| [Maven](https://maven.apache.org/) | 3.3.9+ | 构建工具 |

### 数据访问

| 技术 | 版本 | 用途 |
|------|------|------|
| [MyBatis](https://mybatis.org/) | 3.5.14 | ORM 框架 |
| [MyBatis-Plus](https://baomidou.com/) | 3.5.5 | MyBatis 增强 |
| [Druid](https://github.com/alibaba/druid) | 1.2.23 | 连接池 |

### 缓存与消息

| 技术 | 版本 | 用途 |
|------|------|------|
| [Redis](https://redis.io/) (Jedis) | 5.0.2 | 缓存、会话、Pub/Sub |
| [Spring Kafka](https://spring.io/projects/spring-kafka) | - | 消息队列 |

### AI / LLM

| 技术 | 版本 | 用途 |
|------|------|------|
| [Spring AI](https://spring.io/projects/spring-ai) | 1.0.0 | AI 模型集成 |
| [LangChain4j](https://docs.langchain4j.dev/) | 1.1.0 | LLM 应用框架 |
| [MCP SDK](https://modelcontextprotocol.io/) | 0.7.0 | Model Context Protocol |

### 搜索

| 技术 | 版本 | 用途 |
|------|------|------|
| [Elasticsearch](https://www.elastic.co/) | 8.15 | 全文检索 |

### 弹性与可观测

| 技术 | 版本 | 用途 |
|------|------|------|
| [Resilience4j](https://resilience4j.readme.io/) | 2.0.2 | 熔断、限流、重试 |
| [OpenTelemetry](https://opentelemetry.io/) | 2.22.0 | 分布式追踪 |
| [Micrometer Prometheus](https://micrometer.io/) | - | 指标采集 |

### 安全与认证

| 技术 | 用途 |
|------|------|
| JWT (jjwt + java-jwt) | 认证令牌 |
| BouncyCastle | 加密算法 |
| JustAuth | 第三方社交登录 |

### 文件与文档处理

| 技术 | 用途 |
|------|------|
| [MinIO](https://min.io/) | 对象存储 |
| [Aliyun OSS](https://www.aliyun.com/product/oss) | 云对象存储 |
| [Apache POI](https://poi.apache.org/) | Office 文档处理 |
| [PDFBox](https://pdfbox.apache.org/) | PDF 处理 |

### API 文档

| 技术 | 用途 |
|------|------|
| [SpringDoc OpenAPI](https://springdoc.org/) | API 文档生成 |

### HTTP 客户端

| 技术 | 用途 |
|------|------|
| [OpenFeign](https://spring.io/projects/spring-cloud-openfeign) | 声明式服务调用 |
| [OkHttp](https://square.github.io/okhttp/) | HTTP 客户端 |

### 工具库

| 技术 | 用途 |
|------|------|
| [Guava](https://github.com/google/guava) | 通用工具 |
| [Hutool](https://hutool.cn/) | Java 工具集 |
| [Lombok](https://projectlombok.org/) | 代码简化 |

---

## Python 技术栈

### byclaw-data（数据云服务）

| 技术 | 用途 |
|------|------|
| Python 3.12 | 编程语言 |
| [uv](https://docs.astral.sh/uv/) | 包管理和虚拟环境 |
| [Ruff](https://docs.astral.sh/ruff/) | 代码检查和格式化 |
| [pytest](https://docs.pytest.org/) | 测试框架 |

### byclaw-qa（QA 管理服务）

| 技术 | 用途 |
|------|------|
| Python 3.12 | 编程语言 |
| [uv](https://docs.astral.sh/uv/) | 包管理和虚拟环境 |
| [Ruff](https://docs.astral.sh/ruff/) | 代码检查和格式化 |
| [pytest](https://docs.pytest.org/) | 测试框架 |

### byclaw-exe（扩展插件）

| 技术 | 用途 |
|------|------|
| Python 3.10+ | 技能脚本 |
| TypeScript | 扩展插件定义 |

---

## 数据存储

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| [PostgreSQL](https://www.postgresql.org/) / [OpenGauss](https://opengauss.org/) | 关系数据库 | 兼容 PostgreSQL 生态，支持向量检索 |
| [Redis](https://redis.io/) | 缓存/会话/消息 | 高性能、数据结构丰富 |
| [MinIO](https://min.io/) | 对象存储 | 兼容 S3、高性能、易于部署 |
| [Elasticsearch](https://www.elastic.co/) | 全文检索 | 分布式搜索引擎 |

---

## 基础设施

| 技术 | 用途 |
|------|------|
| [Docker](https://www.docker.com/) | 容器化 |
| [Docker Compose](https://docs.docker.com/compose/) | 本地编排 |
| [Nginx](https://nginx.org/) | 反向代理、静态资源 |
| [GitHub Actions](https://github.com/features/actions) | CI/CD |

---

## 开发工具

| 类别 | 工具 |
|------|------|
| IDE | VS Code, IntelliJ IDEA |
| 版本控制 | Git |
| API 测试 | Postman, curl |
| 数据库工具 | DBeaver, DataGrip |

---

## 技术选型原则

1. **成熟稳定** - 优先选择社区活跃、文档完善的技术
2. **生态丰富** - 丰富的第三方库和工具支持
3. **团队熟悉** - 考虑团队现有技术栈
4. **国产优先** - 关键组件优先选择国产开源方案
5. **云原生** - 支持容器化部署和水平扩展
