# 后端开发入门

本文档介绍 ByClaw 后端项目的开发规范和工作流程。

## 环境准备

### 前置要求

- JDK 21+（项目通过 Maven Enforcer 强制要求）
- Maven 3.3.9+
- Docker & Docker Compose（用于中间件）

### 配置开发环境

```bash
# 验证 JDK 版本（需要 21+）
java -version

# 验证 Maven 版本
mvn -v
```

## 项目结构

```
byclaw-be/
├── config/                         # 外部配置（运行时自动加载）
│   ├── application.properties      # 主配置
│   └── logback.xml                 # 日志配置
├── src/main/java/com/iwhalecloud/byai/
│   ├── common/                     # 横切关注点
│   ├── gateway/                    # API 网关层
│   ├── manager/                    # 管理面（DDD 风格）
│   ├── state/                      # 对话核心域（DDD 风格）
│   └── ByaiServerApplication.java  # 入口
├── src/main/resources/
│   └── com/iwhalecloud/byai/manager/mapper/  # MyBatis XML
├── pom.xml
└── Dockerfile
```

详细结构说明参考 [项目结构文档](./project-structure.md)。

## 开发规范

### 分层架构（DDD 风格）

```
interfaces/controller (对外 API)
    ↓
application/service (应用服务)
    ↓
domain (领域模型)
    ↓
infrastructure (基础设施)
```

### 命名规范

| 层级 | 命名规则 | 示例 |
|------|---------|------|
| Controller | XxxController | `AgentController` |
| Service | XxxService / XxxServiceImpl | `AgentService` |
| Mapper | XxxMapper | `AgentMapper` |
| Entity | Xxx | `Agent` |
| DTO | XxxDTO / XxxReq | `AgentCreateReq` |
| VO | XxxVO | `AgentVO` |

### Controller 规范

```java
@RestController
@RequestMapping("/byaiService/api/agent")
@RequiredArgsConstructor
public class AgentController {

    private final AgentService agentService;

    @GetMapping("/info")
    public Result<AgentVO> getAgentInfo(@RequestParam Long agentId) {
        return Result.success(agentService.getAgentInfo(agentId));
    }

    @PostMapping("/create")
    public Result<Void> createAgent(@RequestBody @Valid AgentCreateReq req) {
        agentService.createAgent(req);
        return Result.success();
    }
}
```

### Service 规范

```java
public interface AgentService {
    AgentVO getAgentInfo(Long agentId);
    void createAgent(AgentCreateReq req);
}

@Service
@RequiredArgsConstructor
public class AgentServiceImpl implements AgentService {

    private final AgentMapper agentMapper;

    @Override
    public AgentVO getAgentInfo(Long agentId) {
        Agent agent = agentMapper.selectById(agentId);
        if (agent == null) {
            throw new BusinessException("Agent 不存在");
        }
        return convertToVO(agent);
    }
}
```

### Entity 规范

```java
@Data
@TableName("byai_agent")
public class Agent {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String description;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

## API 设计规范

### 上下文路径

所有 API 以 `/byaiService` 为上下文路径前缀。

### 响应格式

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... }
}
```

错误响应：

```json
{
  "code": 10001,
  "msg": "参数错误",
  "data": null
}
```

`code` 为 0 表示成功，非零为错误码。

## 数据库操作

### MyBatis Plus 使用

```java
@Mapper
public interface AgentMapper extends BaseMapper<Agent> {

    @Select("SELECT * FROM byai_agent WHERE name = #{name}")
    Agent selectByName(String name);

    List<Agent> selectAgentList(@Param("keyword") String keyword);
}
```

### 分页查询

```java
@Override
public Page<AgentVO> getAgentPage(PageParam pageParam) {
    Page<Agent> page = new Page<>(pageParam.getPageNum(), pageParam.getPageSize());

    LambdaQueryWrapper<Agent> wrapper = new LambdaQueryWrapper<>();
    wrapper.like(StringUtils.isNotBlank(pageParam.getKeyword()),
                 Agent::getName, pageParam.getKeyword());

    page = agentMapper.selectPage(page, wrapper);
    return convertToVOPage(page);
}
```

## 缓存使用

### Redis（Jedis 客户端）

项目使用 Spring Session Data Redis 管理会话，Jedis 作为 Redis 客户端。

```java
@Cacheable(value = "agent", key = "#agentId")
@Override
public AgentVO getAgentInfo(Long agentId) {
    return agentMapper.selectById(agentId);
}

@CacheEvict(value = "agent", key = "#req.id")
@Override
public void updateAgent(AgentUpdateReq req) {
    agentMapper.updateById(convertToEntity(req));
}
```

## 配置说明

项目使用外部 `config/application.properties`，通过环境变量注入：

```properties
server.port=${BE_SERVER_PORT:8086}
spring.datasource.url=jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_DATABASE:byai}?currentSchema=${DB_SCHEMA:byai}
spring.datasource.username=${DB_USER:gaussdb}
spring.datasource.password=${DB_PASS:password}
```

复制 `.env.example` 到 `.env` 即可配置本地开发环境。

## 常用命令

```bash
# 编译
mvn -B compile

# 测试
mvn -B test

# 完整验证
mvn -B verify

# 打包
mvn -B package -DskipTests

# 运行
mvn spring-boot:run
```

## 调试配置

### 远程调试

```bash
mvn spring-boot:run -Dspring-boot.run.jvmArguments="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005"
```

IDE 配置：
- Host: localhost
- Port: 5005

### 日志级别

日志配置在 `config/logback.xml`，默认：
- root: INFO
- com.iwhalecloud: DEBUG

## 最佳实践

1. **异常处理** - 统一异常处理，使用 BusinessException 抛出业务错误
2. **参数校验** - 使用 `@Valid` 进行入参校验
3. **日志记录** - 关键操作记录日志，便于排查问题
4. **事务管理** - 多表操作使用 `@Transactional`
5. **SQL 优化** - 避免 N+1 查询，合理使用索引
6. **安全** - 使用 `@PreAuthorize` 进行方法级权限控制
