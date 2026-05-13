# 后端项目结构

本文档详细介绍 ByClaw 后端项目的目录结构和组织方式。

## 目录概览

```
byclaw-be/
├── config/                         # 外部配置（运行时加载）
│   ├── application.properties      # 主配置文件
│   └── logback.xml                 # 日志配置
├── src/
│   ├── main/
│   │   ├── java/com/iwhalecloud/byai/
│   │   │   ├── common/            # 横切关注点
│   │   │   ├── gateway/           # API 网关层
│   │   │   ├── manager/           # 管理面（用户、组织、权限）
│   │   │   ├── state/             # 对话/聊天核心域
│   │   │   └── ByaiServerApplication.java
│   │   └── resources/
│   │       └── com/iwhalecloud/byai/manager/mapper/  # MyBatis XML
│   └── test/
├── pom.xml
├── Dockerfile
└── Dockerfile.arm64
```

## 包结构详解（DDD 风格）

项目采用领域驱动设计（DDD）的包组织方式，而非传统的分层架构。

### common/ — 横切关注点

```
common/
├── annotation/         # 自定义注解
├── cache/              # 缓存工具
├── config/             # Spring 配置类
├── constants/          # 常量定义
├── datasource/         # 数据源配置
├── ecrypt/             # 加密工具
├── exception/          # 异常定义与全局处理
├── feign/              # Feign 客户端与拦截器
│   ├── client/         # 服务调用客户端
│   └── interceptor/    # 认证拦截器
├── i18n/               # 国际化
├── jwt/                # JWT 工具
├── log/                # 日志切面
├── login/              # 登录相关
├── message/            # 消息通知
├── page/               # 分页工具
├── qo/                 # 查询对象基类
├── storage/            # 文件存储（MinIO/SFTP/OSS）
├── typehandler/        # MyBatis 类型处理器
├── util/               # 通用工具类
├── vo/                 # 通用视图对象
└── web/                # Web 配置与过滤器
```

### gateway/ — API 网关层

```
gateway/
├── channels/           # 渠道集成（钉钉、微信等）
├── route/              # 路由转发
└── sandbox/            # 代码沙箱控制器与 Mapper
```

### manager/ — 管理面

```
manager/
├── application/        # 应用服务
├── dingtalk/           # 钉钉集成
├── domain/             # 领域模型
├── dto/                # 数据传输对象
├── entity/             # 数据库实体
├── infrastructure/     # 基础设施实现
├── interfaces/         # 控制器（对外接口）
├── mapper/             # MyBatis Mapper 接口
├── qo/                 # 查询对象
├── security/           # 安全配置
├── validate/           # 校验逻辑
└── vo/                 # 视图对象
```

### state/ — 对话/聊天核心域

```
state/
├── application/        # 应用服务
├── aspect/             # AOP 切面
├── common/             # 域内公共
├── config/             # 域配置
├── database/           # 数据库访问
├── domain/             # 领域模型
│   ├── agent/          # Agent 域
│   ├── chat/           # 对话域
│   ├── auth/           # 授权域
│   ├── knowledge/      # 知识库域
│   ├── toolkit/        # 工具集域
│   └── workspace/      # 工作空间域
├── infrastructure/     # 基础设施实现
└── interfaces/         # 控制器
    └── controller/
```

## 配置方式

项目不使用 Spring YAML profiles，配置文件为外部 `config/application.properties`：

```properties
# 通过环境变量注入，带默认值
server.port=${BE_SERVER_PORT:8086}
spring.datasource.url=jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_DATABASE}?currentSchema=${DB_SCHEMA}
```

应用启动时通过 `resolveConfigPath()` 方法从 CWD 向上搜索 `config/application.properties`，同时加载 `.env` 文件设置系统属性。

## 入口类

```java
@SpringBootApplication(scanBasePackages = "com.iwhalecloud")
@EnableTransactionManagement
@EnableAsync
@EnableScheduling
@EnableDiscoveryClient
@EnableFeignClients
@MapperScan({"com.iwhalecloud.byai.manager.mapper", "com.iwhalecloud.byai.gateway.sandbox.mapper"})
@EnableWebSecurity
@EnableMethodSecurity
@EnableRedisHttpSession
public class ByaiServerApplication { ... }
```

## Feign 客户端

后端通过 Feign 调用其他服务：

| 客户端 | 用途 |
|--------|------|
| `FeignConversationService` | 对话/会话后端 |
| `FeignDocChainService` | 文档链处理 |
| `FeignManagerService` | 管理服务 |
| `FeignPythonToolService` | Python 工具调用 |
| `FeignPythonMemoryService` | 记忆服务 |
| `FeignSandboxService` | 代码沙箱执行 |
| `FeignAiWriterService` | AI 内容生成 |

各客户端 URL 通过 `feign.<name>.*` 属性配置。

## 模块依赖关系

```
interfaces/controller (对外 API)
    ↓
application/service (应用服务，编排领域逻辑)
    ↓
domain (领域模型，核心业务规则)
    ↓
infrastructure (基础设施实现，数据库/外部服务)
```

## 新增功能流程

1. **确定所属域** — 判断功能属于 state、manager 还是 gateway
2. **创建 Entity** — 在对应域的 entity 或 domain 包下
3. **创建 Mapper** — 在对应域的 mapper 包下，XML 放在 resources 对应路径
4. **创建 Service** — 在 application 包下定义应用服务
5. **创建 Controller** — 在 interfaces/controller 包下暴露 API
6. **编写测试** — 在 test 目录对应包下

## 常用命令

```bash
# 编译
mvn -B compile

# 测试
mvn -B test

# 完整验证
mvn -B verify

# 打包（跳过测试）
mvn -B package -DskipTests

# 运行
mvn spring-boot:run

# 输出 JAR 名称
# target/ByaiServer-1.0.jar
```
