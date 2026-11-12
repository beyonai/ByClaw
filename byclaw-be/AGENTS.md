# ByClaw Backend Agent Guide

本文件适用于 `byclaw-be/` 及其子目录，是仓库根目录 `AGENTS.md` 的后端补充；同时遵守根目录约定及适用的更深层规则。修改前先阅读相关实现和模块文档。只修改任务需要的内容，保留用户已有改动；未经明确要求，不暂存、提交或推送代码，不打印或提交凭据及本地环境文件。

## 项目架构

- 基础包：`com.iwhalecloud.byai`；Java 21、Spring Boot 3.x、Maven，具体依赖版本以 `pom.xml` 为准。
- 持久化使用 MyBatis / MyBatis-Plus，分页复用现有 PageHelper 及项目分页封装；Redis 使用既有 Spring Data Redis / Jedis 配置与工具。

```text
src/main/java/com/iwhalecloud/byai/
├── manager/
│   ├── interfaces/controller/<module>/  # 管理接口
│   ├── interfaces/response/             # ResponseUtil 等响应封装
│   ├── application/                     # 应用用例编排
│   ├── domain/<module>/                 # 业务规则与领域服务
│   ├── entity/<module>/                 # 数据库实体
│   ├── mapper/<module>/                 # 数据访问接口
│   ├── dto/、qo/、vo/                   # 按现有业务模块组织的数据类型
│   └── config/、infrastructure/、security/、validate/
├── state/
│   ├── interfaces/controller/<module>/  # 对话、文件、会话等运行态接口
│   ├── application/service/<module>/    # 应用服务
│   ├── domain/<module>/                 # 运行态领域能力
│   └── common/、config/、database/、infrastructure/、aspect/
├── gateway/                             # channels、route、sandbox 等外部适配
└── common/                              # 公共常量、异常、分页、登录与工具

src/main/resources/mapper/<module>/      # Mapper XML
```

- 按目标业务的现有分区和包结构落代码。`manager` 已将 Entity、Mapper、DTO、Qo、VO 独立存放，不照搬其他项目将它们整体搬入 domain，不另建 `hacu` 包或平行架构。
- 常规调用链为 `controller → application → domain → mapper`；简单用例允许 `controller → domain → mapper`，不创建只有转发作用的 application 层。
- Controller 负责 HTTP 入参、校验和响应包装；application 负责跨领域用例编排与视图转换；domain 负责业务规则；mapper 负责数据访问。跨领域用例统一由应用服务编排，避免领域服务循环依赖或随意跨域调用。
- 新增编排服务命名为 `XxxApplicationService`，领域服务命名为 `XxxService`，不使用 `XxxDomainService`。已有公共能力优先复用，不因命名差异重命名无关代码。
- `common` 仅放跨业务共用的稳定能力。外部平台、沙箱及渠道调用复用既有 gateway 和适配层，不在 Controller 中堆积协议、连接及重试逻辑。
- 禁止新增跨产品模块的源码直接耦合。已有 Maven 资源打包关系按 `pom.xml` 保留；OpenClaw / Harness 的共享资源只在仓库 `middleware/builtin/` 维护，遵守根目录共享资源规则。

## Java 规范

- Java 代码格式化必须遵循 [`rules/formatter/Java-Formatter.xml`](rules/formatter/Java-Formatter.xml)，CheckStyle 代码检查必须遵循 [`rules/CheckStyle/checkStyle.xml`](rules/CheckStyle/checkStyle.xml)（路径均相对于 `byclaw-be/`）。新增或修改 Java 代码前必须阅读这两份配置，并严格按照其中的格式与编码规范编写；具体配置是格式化和 CheckStyle 规则的依据。
- 可读性优先，命名表达完整业务含义。对象变量通常使用类型名的小驼峰形式，例如 `CreateDepartmentReq createDepartmentReq`；避免 `req`、`resp`、`obj` 等泛化简称。同类型的多个对象用业务角色区分。
- `if`、`else`、`for`、增强 `for`、`while`、`do-while` 一律使用 `{}`，即使只有一条语句。
- 方法职责单一，复杂条件和深层嵌套通过明确命名的变量或方法拆分；保持所在文件现有排版，禁止无关的全文件格式化。
- 新增类添加职责、创建者和创建日期注释；创建者使用实际已知身份或明确的 Agent 标识，不虚构人员。新增方法添加简洁 Javadoc，按实际情况说明入参和返回值。
- 禁止通配符导入，包括静态通配符；不使用 `record` 定义项目类。
- Getter、Setter 优先使用 Lombok `@Getter`、`@Setter`，按需添加，不滥用 `@Data`。
- 优先复用 `common.util` 中的 `StringUtil`、`DateUtils` 等工具，避免重复实现已有能力。

- 公共常量放在 `com.iwhalecloud.byai.common.constants`；模块常量放在该包下对应模块包或目标模块已有的常量包，避免重复体系。
- 同一字段、字典或业务含义有两个及以上取值时，使用独立常量类集中管理。常量类使用 `final`、私有构造方法和 `public static final` 字段；不强制改成枚举。
- 不在 `XxxService` / `XxxApplicationService` 中新增业务常量或系统状态常量；日志对象等技术设施字段除外。
- 依赖注入优先使用 `@Autowired`，其次使用构造注入；保留已有实现的一致性，不为调整注入方式重写无关代码。
- 字段按静态常量、`@Value` 配置字段、`@Autowired` 依赖字段排列。字段注解独占一行，位于声明上方，不同注入字段间留空行，字段使用完整明确的类型小驼峰名称。
- 常规依赖直接注入实际类型。只有明确需要延迟解析、动态获取或可选依赖生命周期管理时才使用 `ObjectProvider`、`Provider`、`ObjectFactory`，并说明原因；不为必需依赖增加无意义的空值判断。

- 普通 JSON Controller 接口统一复用 `manager.interfaces.response.ResponseUtil`；application / domain 不以它作为业务返回类型。SSE、WebSocket、文件下载、Range 响应及代理透传遵循既有协议，不强行包装，以免破坏状态码、响应头或流式行为。
- Controller 方法的请求映射注解必须明确写出路径，入参使用明确的数据类型及适用的 Jakarta 校验。分页入参沿用所属业务的 `XxxQo`，复用 `common.page.PageInfo` 等现有封装，不照搬参考项目新建统一 `PageVo`，不改变现有接口契约。
- 自定义业务异常统一使用 `common.exception.BaseException`，不直接抛出裸 `RuntimeException`。错误码引用 `common.constants.errorcode.CommonErrorCode`，禁止数字字面量或业务类自定义错误码；无适用错误码时使用 `ERROR_CODE_50500`。已有 HTTP / 协议异常保留必要的状态与类型语义。
- 所有新增或修改的 `catch` 分支及异常处理器必须通过日志框架的 `error(...)` 直接记录原始异常对象，异常作为最后一个参数，例如 `log.error("创建部门失败，operationId={}", operationId, e);`，保留原始消息、堆栈和因果链。即使重抛、重试或返回默认值也必须记录；禁止仅记录 `getMessage()`、降为 WARN / INFO、吞异常或使用 `printStackTrace()`。
- 不通过 `SafeExceptionUtil`、重建异常、替换消息或复制堆栈丢弃诊断信息；不额外把凭据、请求头或请求正文拼入日志。客户端沿用既有错误包装，不返回内部堆栈和敏感配置。
- 用户、租户、工作组、会话及文件归属从既有可信身份上下文派生；不能仅凭请求中的 ID 授权。处理越权、参数边界和失败情况，不绕开现有认证过滤器或权限检查。
- 异步任务保留必要身份上下文并正确清理；线程池、远程调用和重试应有明确容量、超时及失败语义。流、连接和临时资源由其拥有方释放。

- 所有新增或修改的 Redis 业务功能同时考虑单机和真实 Redis Cluster，优先复用 `common.util.RedisUtil`、既有模板及协调抽象，不新增单机连接旁路。
- 独占连接正确归还，共享模板或集群句柄不擅自关闭。不得依赖 `SELECT` 切换库、单节点 `KEYS` / `SCAN` 或单节点连接语义实现集群功能。
- 多键命令、事务、管道和 Lua 检查哈希槽约束；跨槽操作按现有协调设计拆分，原子操作使用经过设计的同槽键。不得擅自更改已有键、哈希标签、前缀、序列化、TTL 或 Stream 语义。
- Lua 访问的键全部通过 `KEYS` 显式传入，不放在 `ARGV` 或在脚本内拼接隐藏键；锁续期、释放、CAS 必须校验持有者身份。
- 扫描、批处理和重试使用客户端集群兼容能力，明确部分失败及幂等处理。

- 凭据通过环境或既有配置注入，不提交真实 Token、内部连接凭据和本地环境文件。配置变更沿用当前配置组织方式，不为完成任务擅自替换部署环境。
- 工具沙箱依赖下载遵守根目录国内源要求：默认使用已验证国内源，禁止静默回退海外；无可靠国内源时使用固定版本、校验摘要的受控制品，缺失或校验失败即中止。镜像配置和远程 Shell 均需覆盖，并报告未实际下载验证的入口。
- LLM 和 Embedding 的真实端点、Token、模型编码在模型管理配置；初始化值是占位符，`.env` 中的 `OPENAI_API_KEY` 不等于已配置默认模型。两类模型均需调试、启用并设置默认值，Embedding 维度必须匹配。

- 遵守根目录文档治理：`docs/` 下文件在暂存或提交前须获得明确批准；设计文档默认不暂存、不提交，也不主动询问是否提交。用户未要求提交时保持工作区改动供审阅。

## SQL 规范

- 数据库实体字段与表字段一一对应，不添加非表扩展字段；扩展数据放入 VO / DTO，按现有契约选择继承实体或组合。
- 每个数据库实体对应的 Mapper 继承 `BaseMapper<Entity>`，基础 CRUD 复用其方法，不在 Mapper XML 中重复实现。
- 自定义 SQL 放在 `src/main/resources/mapper/<module>/` 对应 XML 中，namespace、方法签名与 Mapper 保持一致，不在 Java 注解或字符串中新增自定义 SQL。
- 禁止 `SELECT ... FOR UPDATE`，包括 ORM / 查询构造器生成的形式。禁止 `SELECT *`，明确列出查询字段，多字段结果使用 `resultMap` 映射。
- 参数优先使用 `#{...}` 绑定。`${...}` 只能用于经过严格允许值白名单校验的安全来源，不能直接拼接用户输入。
- 保持目标数据库的现有兼容范围；修改事务、批处理或并发更新时明确原子性、幂等与部分失败处理，不靠禁用约束掩盖问题。

- 任何 DDL / DML 都属于迁移。用户未明确指定精确迁移版本时，必须先询问版本，不能自动递增或猜测。
- 普通开发只修改获准的 `deploy/migrations/versions/<version>/`。DDL 只放 `__ddl.sql`，DML 只放 `__dml.sql`，修改后从仓库根目录运行 `python3 deploy/migrations/merge_migrations.py --dry-run`，修复所有分类错误。
- 不手工修改 `deploy/middleware/initdb/` 或 `deploy/migrations/.applied`。只有用户明确授权发布合并时，才运行不带 `--dry-run` 的合并脚本；生成文件只能由该脚本变更，随后核对每个待合并版本恰好追加一次。
