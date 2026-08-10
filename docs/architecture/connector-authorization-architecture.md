# 连接器统一授权架构设计

## 1. 背景

当前统一连接器接口已经接入钉钉 DWS 设备授权，但核心编排服务
`ConnectorAuthorizationService` 仍直接依赖 `DwsAuthService`，并通过
`connectorCode == "dingtalk"` 判断平台。除钉钉外，现有通用分支只返回静态
`authorizationUrl`，状态查询不会调用平台能力，也不会将授权任务推进到
`CONNECTED`。

仓库当前使用的三套 CLI 认证模型并不相同：

| 平台 | CLI | 实际认证模型 | 状态验证 |
| --- | --- | --- | --- |
| 钉钉 | `dws` | `auth login --device` 长进程轮询 | `auth status --format json` |
| 飞书 | `lark-cli` | `--no-wait` 发起、`--device-code` 完成的两阶段 Device Flow | `auth status --json --verify` |
| 企业微信 | `wecom-cli` | `init --noninteractive --no-open` 长进程扫码初始化 | 本地缓存状态与实际业务探针 |

因此不能通过替换 CLI 名称复用 `DwsAuthService`。统一授权层应只编排授权任务，
平台差异由独立 Provider 封装。

## 2. 设计目标与边界

### 2.1 目标

- 前端统一调用连接器授权的启动、状态查询和取消接口；
- `ConnectorAuthorizationService` 不直接依赖任何平台 CLI、SDK 或 OAuth 实现；
- 通过 `providerCode` 路由 Provider，新增平台时不修改核心状态机；
- 统一任务状态、用户归属校验、过期处理、错误映射和授权绑定写入；
- 授权会话可在多实例部署和服务重启后继续查询；
- CLI 登录态按用户、平台严格隔离，隔离失败时关闭失败，不回退到全局凭证；
- 以 `runtime_manifest.runtime.commands` 作为 CLI 参数数组的唯一数据库来源，消除 Manifest 声明与
  Provider 硬编码命令之间的漂移；
- 保留现有 `/devloop/dws/*` 接口，兼容旧页面和旧扫描任务。

### 2.2 非目标

- 本阶段不重写 `DwsAuthService` 的全部业务能力；
- 本设计只统一授权，不统一钉钉、飞书、企微的业务命令和扫描协议；
- Manifest 不承担通用工作流 DSL 职责；命令组只描述可执行 argv，条件分支、异步等待、重试和状态迁移
  仍由 Provider 编排；
- 不要求三套 CLI 暴露完全一致的 token、refresh token 或账号字段；
- 不把 CLI 管理的真实 token 复制到数据库，除非平台实现明确要求应用管理凭证；
- 通用 OAuth Provider 与 `wecom-cli` Provider 分开，不能把企微 CLI 初始化假设为 OAuth 回调。

### 2.3 当前交付范围

当前实现已交付 DWS、Lark CLI 和 WeCom CLI 的统一授权：

- 完成 Provider 接口、Registry、Redis 授权会话和统一编排；
- 将钉钉 DWS 包装为 Provider，保持现有授权行为；
- 完整实现 `LarkCliAuthorizationProvider`；
- 实现 `WecomCliAuthorizationProvider` 的扫码初始化、进程生命周期、缓存状态与只读业务探针；
- 实现 `ConnectorManifestCommandResolver` 和不可变 `ManifestCommandCatalog`，三个 CLI Provider 的实际
  argv 均从 `runtime_manifest.runtime.commands` 获取；
- 支持二维命令组、仅占据完整 argv 元素的受控占位符，以及授权会话 Manifest 摘要校验；
- 通过 `V0.5.1__dml.sql` 将三个内置连接器模板迁移到二维命令组，并同步更新新环境初始化数据；
- 通用 OAuth2 和多实例进程租约后续按需实施。

Provider 仍负责平台协议编排、可执行文件与子命令白名单、输出解析、重试和状态迁移，但不再维护与
Manifest 重复的生产命令常量。测试构造器中的默认命令只用于隔离单元测试，不进入 Spring 生产注入路径。
进行中的授权会话保存启动时的 canonical Manifest 摘要；后续查询若检测到摘要变化，会先尽力取消旧
Provider 运行时资源，再将会话关闭失败，要求用户基于新模板重新授权。

首批部署约束：CLI 授权进程表仍是单实例内存资源。在跨实例进程租约、owner 路由和远程取消完成前，
必须将处理连接器授权接口的后端固定为单副本（仓库渲染脚本默认 `BYCLAW_BE_REPLICAS=1`），不能直接
使用 `replicas: 2` 的静态示例部署该能力。共享 Redis 只解决会话状态，不会自动把进程句柄迁移到其他实例。

## 3. 总体架构

```text
ConnectorController
        ↓
ConnectorAuthorizationService（统一状态机与跨存储一致性编排）
        ↓
AuthorizationProviderRegistry（providerCode 路由）
        ↓
ConnectorManifestCommandResolver（Manifest 命令校验、解析与受控占位符填充）
        ↓
┌─────────────────────────────────────────┐
│ DwsDingtalkAuthorizationProvider         │
│ LarkCliAuthorizationProvider             │
│ WecomCliAuthorizationProvider            │
│ OAuth2AuthorizationProvider（可选通用）  │
└─────────────────────────────────────────┘
        ↓
平台 CLI / SDK / OAuth

RedisAuthorizationSessionRepository
        ↓
Redis（短生命周期授权任务）

ConnectorAuthRepository
        ↓
byai_connector_auth
```

职责边界：

1. Controller 只处理 HTTP 契约和当前用户身份；
2. 编排服务拥有授权任务 ID、状态迁移和用户连接器绑定；
3. Manifest Command Resolver 将二维命令组解析为不可变命令目录，在执行前完成结构、平台命令策略和
   占位符校验；
4. Provider 处理平台认证协议、选择命令组中的具体命令、提供受控动态参数并转换平台结果；
5. 会话仓储保存临时授权任务，授权绑定表保存长期连接状态；
6. CLI 凭证工作区服务负责用户目录解析、权限和环境变量注入。

## 4. 对外接口

保留现有统一接口：

```http
POST /byaiService/connector/authorization/start
GET  /byaiService/connector/authorization/status?authorizationId=...
POST /byaiService/connector/authorization/cancel
GET  /byaiService/connector/connections
```

OAuth Provider 需要增加平台回调入口：

```http
GET /byaiService/connector/authorization/callback/{providerCode}
```

回调只接收平台返回的 `code/state/error`。Provider 通过 `state` 定位授权会话，
编排服务完成用户归属、状态和幂等校验。CLI Device Flow 不使用该回调。

前端继续面对统一状态：

```text
pending → connected | failed | expired
pending → cancelled
```

内部枚举使用大写 `PENDING/FINALIZING/CONNECTED/FAILED/EXPIRED/CANCELLED`；`FINALIZING`
对前端仍序列化为 `pending`，其余状态序列化为对应小写值。
当前前端状态联合类型需要增量增加 `cancelled`，`ConnectorAuthorizationDto` 需要增加可选
`errorCode`；现有字段和 start/status/cancel 接口语义保持兼容。

## 5. Provider 路由

### 5.1 连接器元信息

在 `byai_connector_info` 增加独立字段：

```text
provider_code VARCHAR(64)
```

`providerCode` 是执行路由，不应长期埋在 `auth_config` JSON 中。迁移时为现有连接器填充：

| connectorCode | providerCode | authMode |
| --- | --- | --- |
| `dingtalk` | `dws-dingtalk` | `DEVICE_FLOW` |
| `feishu` 或实际飞书编码 | `lark-cli` | `DEVICE_FLOW` |
| `wecom` 或实际企微编码 | `wecom-cli` | `CLI_INIT` |

实际连接器编码以数据迁移中的 `connector_code` 为准，不在 Java 中维护平台白名单。
`auth_config` 只保存不构成 CLI argv 的非敏感 Provider 参数，例如授权超时、输出上限和平台行为开关。
飞书 domain/scope 对应的 CLI 参数以及企业微信业务探针命令统一迁入
`runtime_manifest.runtime.commands`，不能在 `auth_config` 和 Manifest 中各维护一份命令。
现有 `auth_mode` 是无数据库约束的字符串字段，迁移时同步更新实体注释和数据字典，使其支持
`DEVICE_FLOW`、`CLI_INIT`；原有 `NONE/OAUTH2/AK_SK/PASSWORD/TOKEN` 保持兼容。

### 5.2 Registry

```java
public interface ConnectorAuthorizationProvider {

    String providerCode();

    AuthorizationStartResult start(AuthorizationStartContext context);

    AuthorizationStatusResult queryStatus(AuthorizationSession session);

    default void cancel(AuthorizationSession session) {
    }

    default AuthorizationStatusResult handleCallback(
            AuthorizationSession session,
            AuthorizationCallback callback) {
        throw new UnsupportedOperationException("callback is not supported");
    }
}
```

Provider 不生成系统 `authorizationId`，也不写 `byai_connector_auth`。这些职责属于
`ConnectorAuthorizationService`。

Registry 在应用启动时按 `providerCode` 构建不可变映射；重复编码应导致启动失败，
未找到 Provider 时返回明确配置错误。

### 5.3 Provider 与 Manifest 命令目录

Provider 是平台授权协议适配器，不是命令配置的第二事实源。它负责回答：

- 当前授权状态应执行哪个 action 以及命令组中的哪个索引；
- 哪些动态参数可用于该命令，动态参数从哪个可信运行时结果产生；
- CLI 输出如何解析为 `PENDING/CONNECTED/FAILED/EXPIRED/CANCELLED`；
- 哪些进程需要登记、等待、终止或在服务恢复后重新探测。

`runtime.commands` 负责回答“该 action 对应哪些 argv 模板”。每个 value 统一使用二维数组：外层是有序
命令组，内层是一条直接交给进程执行器的 argv。二维数组本身不表示通用执行器必须无条件顺序执行；
是否执行、跳过、重复检查或等待，由对应 Provider 的协议状态机决定。

```json
{
  "commands": {
    "login": [
      ["lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json"],
      ["lark-cli", "auth", "login", "--device-code", "${deviceCode}", "--json"]
    ],
    "status": [
      ["lark-cli", "auth", "status", "--json", "--verify"]
    ]
  }
}
```

Provider 只能使用注册过的占位符。以 Lark 为例，`${deviceCode}` 来自 `login[0]` 的 CLI 输出，先写入
加密的 `providerState`，后续查询状态时解密、校验并填入 `login[1]`。请求参数、数据库普通字段或前端
metadata 不能直接成为命令占位符值。填充过程操作 argv 元素，不生成 shell 字符串。

## 6. 统一领域模型

### 6.1 启动上下文

```java
public class AuthorizationStartContext {
    private String authorizationId;
    private String userId;
    private Long connectorId;
    private String connectorCode;
    private String providerCode;
    private String redirectUrl;
    private Map<String, Object> providerConfig;
    private ManifestCommandCatalog commandCatalog;
}
```

Provider 必须使用上下文中的显式 `userId`，不得依赖 `CurrentUserHolder`。这样后台线程、
回调和定时任务都能使用同一实现。`commandCatalog` 必须由服务端在调用 Provider 前从当前连接器
`runtime_manifest` 校验并解析得到，不能把原始 Manifest JSON 或可变 Map 直接交给 Provider。

`queryStatus`、凭证 `verify` 和 `revoke` 也必须接收本次调用重新构造的不可变命令目录。Redis 会话只保存
canonical Manifest 摘要，不复制完整命令目录；后续调用读取最新 Manifest 并验证摘要一致后再解析，避免
把渠道模板或完整 Manifest 复制到用户会话。

### 6.2 Provider 启动结果

```java
public class AuthorizationStartResult {
    private AuthorizationStatus status;
    private String authorizationUrl;
    private String qrCodeContent;
    private Date expiresAt;
    private String providerSessionId;
    private String providerState;
    private String errorCode;
    private String errorMessage;
}
```

`providerState` 只在服务端使用，写入 Redis 前必须加密；它可以保存 Lark `device_code`、OAuth
PKCE verifier 等临时秘密。Provider 返回的错误必须先脱敏。

### 6.3 Provider 状态结果

```java
public class AuthorizationStatusResult {
    private AuthorizationStatus status;
    private String accountId;
    private String accountName;
    private Date credentialExpiresAt;
    private String credentialReference;
    private String errorCode;
    private String errorMessage;
}
```

统一层只要求 `status`。账号和过期字段允许为空，不能为了统一字段而伪造
`refreshTokenValid`、`expiresAt` 等平台不提供的信息。

## 7. Redis 授权会话

授权会话是 10～15 分钟有效的临时状态，使用 Redis 保存，不新增数据库授权会话表。
每个任务使用独立 Key：

```text
connector:authorization:{auth}:session:{authorizationId}
connector:authorization:{auth}:user:{userId}:{connectorId}
```

两类 Key 使用相同 Redis Cluster hash tag `{auth}`，确保创建、CAS、终态释放和过期清理脚本涉及的
session/user-index Key 总在同一 slot，避免集群模式出现 `CROSSSLOT`。活跃索引仅由
`PENDING/FINALIZING` 会话持有。

Value 使用 JSON：

| 字段 | 说明 |
| --- | --- |
| `authorizationId` | 系统生成的授权任务 ID |
| `user_id` | 发起用户 ID |
| `connectorId` | 连接器主键 |
| `connector_code` | 连接器业务编码快照 |
| `providerCode` | Provider 路由编码 |
| `status` | 当前内部状态 |
| `authorizationUrlCipher` | 加密后的授权 URL，可空 |
| `providerSessionId` | 平台侧非敏感任务标识，可空 |
| `providerStateCipher` | 加密后的临时状态，可空 |
| `manifestDigest` | 启动时 canonical Manifest 的摘要，用于防止后续阶段混用模板版本 |
| `ownerInstanceId` | 当前 CLI 进程所属实例，可空 |
| `expiresAt` | 任务过期时间 |
| `errorCode` | 脱敏错误码 |
| `errorMessage` | 脱敏错误信息 |
| `version` | CAS 状态版本 |
| `createdAt` / `updatedAt` | 审计时间 |

前端查询和取消至少校验：

```text
authorizationId + currentUserId
```

OAuth 回调通常不存在当前登录会话，不接收或信任前端 `userId`。它必须通过不可猜测、一次性的
`state` 定位授权会话，再校验 URL 中的 `providerCode` 与会话一致、会话未过期且仍为
`PENDING`。状态更新使用 Redis Lua 脚本或 WATCH/MULTI 做 CAS，保证状态迁移和 TTL 刷新原子化：

```text
当 status=PENDING 且 version=expectedVersion 时：
  写入新状态
  version=version+1
  保留原 expiresAt 对应的剩余 TTL
```

授权 URL 可能携带 user code，二维码也可能包含临时秘密，因此需要加密或只在启动响应中
返回。Redis Key 的 TTL 使用 Provider 返回的有效期；终态只短暂保留结果，随后由 TTL 自动清理。
Redis 丢失时先通过对应 CLI 验证登录态，已成功则可补写最终连接器绑定，否则要求重新授权。

## 8. 用户授权绑定与凭证归属

`byai_connector_auth` 继续表示“用户可以使用该连接器”，由统一编排服务在 Provider 返回
`CONNECTED` 后保存或更新。

数据库通过 `(user_id, connector_id) WHERE status_cd = '00A'` 部分唯一索引保证同一用户、同一连接器
最多只有一条有效绑定。V0.3.1 升级时优先保留 `enable_flag = 'Y'` 的当前开启记录；同等状态下再按
`update_time`、`create_time`、`auth_id` 逆序保留最新记录。`expire_time` 不参与绑定保留、连接器开启状态
或消息 metadata 的判断。其余重复有效记录
软失效为 `00X/N`，再创建唯一索引；不删除历史记录。

两类凭证采用不同策略：

- CLI 管理型：DWS、Lark CLI、WeCom CLI 的真实 token 保留在用户专属 CLI 工作区；
  `auth_credential` 只保存加密后的工作区引用、Provider 元数据、账号摘要和本次 `authorizationId`，
  不复制 token。`authorizationId` 用于确认 `FINALIZING` 自愈读取到的是本次任务写入的绑定，不能仅凭
  已存在的旧绑定推断本次授权成功；
- 应用管理型：通用 OAuth/SDK Provider 确需保存 token 时，将完整凭证 JSON 加密后写入
  `auth_credential`，并保存 `expire_time` 和刷新时间。

`saveEnabledAuthorization` 应接收统一状态结果，写入：

- `auth_mode`；
- `auth_name`；
- `auth_credential` 或凭证引用；
- `expire_time`；
- `enable_flag = Y`；
- `last_sync_time`。

其中 `enable_flag` 是用户是否开启连接器的唯一业务开关。`expire_time` 字段可以继续保存平台返回的
凭证有效期或同步信息，但当前连接器列表、连接状态和消息 metadata 均不根据该字段判断是否过期；只有
`enable_flag = 'Y'` 且授权记录、连接器信息均为有效状态时，才会被视为用户已开启的连接器。

## 8.1 消息 metadata 中的连接器授权标识

消息初始化阶段由 `ScriptService.getMetadataByassistantChatDto` 查询全部有效连接器，并合并当前用户的
开启状态。连接器集合条件为 `byai_connector_info.status_cd = '00A'`；用户状态条件为：

- `byai_connector_auth.user_id` 匹配当前用户；
- `byai_connector_auth.enable_flag = 'Y'`；
- 授权记录和连接器信息的 `status_cd = '00A'`。

查询结果使用 `byai_connector_info.skill_code` 作为 metadata 的 key，value 为 Boolean：当前用户存在
有效且 `enable_flag = 'Y'` 的授权记录时为 `true`，否则为 `false`。`skill_code` 与
`runtime_manifest.skill.code` 保持一致，但消息高频链路不读取和解析完整 Manifest。连接器业务编码仍通过
`connector_id` 关联 `byai_connector_info`，不直接作为消息 metadata key。例如用户只开启钉钉时，最终
metadata 包含：

```json
{
  "mode": "basic",
  "agentId": "10000164",
  "role": "agent10000164-10000050",
  "authConnectorList": {
    "dws": true,
    "fws": false,
    "wecomcli": false
  }
}
```

`authConnectorList` 表示平台有效连接器的完整用户级开关映射，不读取请求中单次消息的 connector 选择
参数，也不校验 `expire_time`。即使用户没有开启任何连接器，所有有效连接器也必须以 `false` 写入；只有
平台不存在任何有效连接器时才返回空对象 `{}`。该 metadata 会在消息持久化和发送初始化事件前写入，
因此客户端请求中的 `metadata` 可以为空。旧字段 `authConnector` 不再输出。

`authMode = NONE` 的连接器可以直接建立绑定，但也必须写入 `byai_connector_auth`；不能只返回
`connected` DTO，否则连接器列表无法稳定反映连接状态。

## 9. CLI 用户隔离

所有可通过 `HOME` 隔离凭证的 CLI 统一存放在用户 bucket 内：

```text
{fileStorageRoot}/byclaw-{userCode}/by/.connector-auth/
├── .dws/                         # DWS 专属 HOME
│   ├── config/                    # DWS_CONFIG_DIR，保存 profile 配置
│   └── .local/share/dws-cli/      # DWS file-DEK 与 token（由 HOME 派生）
├── .lark-cli/                    # lark-cli 专属 HOME
│   └── .lark-cli/                # Lark CLI 配置、token 与缓存（由 HOME 派生）
└── .{providerCode}/              # 后续 CLI 的专属 HOME
```

`ConnectorCredentialWorkspaceService` 对通用 Provider 统一解析：

```text
{fileStorageRoot}/byclaw-{userCode}/by/.connector-auth/.{providerCode}/
```

它负责：

- 校验 `userId` 并解析用户 bucket；
- 创建权限受控的目录；
- 按 Provider 注入专属 `HOME`；Provider 需要额外配置目录或禁用系统 keychain 时自行追加环境变量；
- 返回不可变的进程环境描述；
- 解析失败时抛出错误，禁止继承后端进程的全局 `HOME`。

目录名称固定为隐藏的 Provider Code：`lark-cli` 使用 `.lark-cli`，未来 CLI 也使用
`.${providerCode}`。DWS 是命名例外：其运行能力名称与连接器 Provider Code 无关，固定使用
`.dws` 作为 HOME，并额外设置 `DWS_CONFIG_DIR={HOME}/config` 与
`DWS_DISABLE_KEYCHAIN=1`。

该约定只定义新目录，不自动迁移旧的 `by/.dws` 或旧连接器工作区中的凭证。升级后旧登录态
不会被新 HOME 读取，用户需要重新授权；如后续需要无感升级，应另行设计一次性、可回滚的加密凭证迁移。

每个 Provider 在实现前必须通过当前固定 CLI 版本验证真实存储位置。不能假定
`DWS_CONFIG_DIR`、`XDG_CONFIG_HOME` 或 `HOME` 对所有 CLI 都有相同行为。

上述 Provider 工作区环境用于后端授权进程。分发给 OpenClaw 的运行参数不写通用 `HOME`，而是使用
`DWS_HOME`、`LARK_HOME`、`WECOM_HOME`；对应 Skill 只在启动目标 CLI 子进程时将命名空间变量局部映射为
`HOME`。这样不会覆盖 OpenClaw 的全局 HOME，也避免多个连接器之间的变量冲突。完整物化规则见
[连接器 Runtime Manifest 对接设计](./connector-runtime-manifest-integration-design.md)。

现有 `DwsAuthService.newDwsProcess()` 必须检查 `applyUserDwsEnv()` 返回值。用户目录解析失败时
不得继续启动 CLI。

## 10. 平台流程

### 10.1 钉钉 DWS

```text
start
  → 创建系统授权会话
  → 从 Manifest commands.login[0] 解析命令
  → DwsDingtalkProvider 调用 dws auth login --device --no-browser --recommend -y
  → 解析 verificationUrl
  → 以 authorizationId 为键登记后台进程
  → 返回 pending

status
  → 执行 Manifest commands.status[0]：dws auth status --format json
  → token_valid=true 时返回 connected
  → 编排服务写 byai_connector_auth

cancel/expired
  → 终止该 authorizationId 对应的进程
  → 清除临时状态

revoke
  → 执行 Manifest commands.logout[0]：dws auth reset -y
```

`DwsAuthService` 需要增加显式 `userId` 和 `authorizationId` 参数，并将当前全局
`AtomicReference<Process>` 改为按授权任务索引的进程注册表，避免不同用户互相终止授权。

统一会话 TTL 必须与 DWS 进程等待时间一致，默认取 Provider 实际返回或配置的过期时间，
不能继续保留“会话 10 分钟、进程等待 15 分钟”的不一致。

### 10.2 飞书 Lark CLI

```text
start
  → 执行 commands.configCheck[0]：lark-cli config show
  → 已配置：直接进入 user_authorization
  → 未配置：后台执行 commands.configInitialize[0]
  → 从增量输出提取应用初始化 URL
  → 返回 pending + app_initialization + authorizationUrl

status（app_initialization）
  → 初始化进程完成后再次执行 commands.configCheck[0]
  → 沙箱上下文需要时执行 commands.contextBind[0]
  → 验证成功后执行 commands.login[0]
  → 解析 verification_url、device_code 和过期时间
  → 加密保存 device_code
  → CAS 更新为 pending + user_authorization + 新 authorizationUrl

status（user_authorization）
  → 用 providerState 中的 device_code 填充并执行 commands.login[1]
  → 成功后执行 commands.status[0]
  → 条件更新会话为 connected
```

`status` 本身不应重复消费 `device_code`。后台任务必须以 `authorizationId` 做幂等控制；
`device_code` 过期或已使用后不得重试旧值。用户授权失败时重新 `start` 创建新会话。

飞书应用配置和用户授权是同一授权任务中的两个阶段：

1. `app_initialization`：每个用户在独立 `HOME` 中通过 `config init --new` 创建应用；
2. `user_authorization`：用户完成 Device Flow 授权。

不依赖部署级 App ID/App Secret。Provider 必须把应用初始化失败与用户未授权/缺 scope 映射为
不同错误。初始化 URL 只接受飞书官方域名的 `/page/cli`；阶段推进使用 Redis 短租约锁，
并在取锁后重读会话，避免并发轮询生成多个 device code。调用 Provider `start` 前还需按
`userId + connectorId` 获取启动锁，防止多个初始化进程同时写同一用户 HOME。Provider
调用前还需检查活跃授权索引，已有会话时直接拒绝重复启动。Manifest 登录命令中的
scope/domain 应遵循最小权限原则。

### 10.3 企业微信 WeCom CLI

```text
start
  → 执行 commands.login[0]：wecom-cli init --noninteractive --no-open
  → 从输出提取本次授权 URL
  → 以 authorizationId 为键登记长运行进程
  → 返回 pending + authorizationUrl

后台进程
  → 继续读取同一进程，直到成功、超时或异常退出
  → 成功后依次执行 commands.status[0] 缓存检查和 commands.status[1] 只读业务探针
  → 条件更新会话为 connected

status
  → 读取持久化会话
  → 对已完成会话执行轻量可用性探针
  → 返回 connected / pending / failed / expired
```

WeCom CLI 没有与 DWS 等价的统一 token/refresh token 状态模型。`CONNECTED` 的定义是：

```text
初始化进程明确成功 + 用户专属缓存存在 + 配置的只读业务探针成功
```

不能仅凭授权 URL 已生成、用户口头确认或进程仍存活判定成功。进程被中断时先执行探针，
确认配置是否已经落盘；探针仍返回初始化错误时才能重新发起授权。

企业微信默认命令组中 `status[0]` 为 `wecom-cli cache status`，`status[1]` 为
`wecom-cli contact get_userlist {}`。业务探针属于连接状态协议的一部分，应存放在 Manifest，不能继续
通过 `auth_config.probeCommand` 形成第二命令来源。

### 10.4 CLI 命令解析与动态参数

在任何 CLI 进程启动前，统一编排服务必须先读取并校验当前连接器 Manifest，再创建不可变
`ManifestCommandCatalog`。解析失败时不得启动 CLI，也不得创建可继续轮询的授权会话。

命令解析遵循以下规则：

1. action 名称和命令组最小数量由对应 Provider 的命令契约定义；
2. Provider 使用 `action + index` 选择模板，例如 Lark `login[0]` 发起授权、`login[1]` 完成授权；
3. 静态参数完全来自 Manifest，Java 代码不再维护等价 argv 常量；
4. 动态参数只来自显式用户上下文、CLI 上一步输出、加密 `providerState` 或受控平台回调；
5. Provider 必须按参数类型校验动态值，再逐元素填充允许的占位符；
6. 未知 action、索引越界、未知或未填充占位符、可执行文件不匹配均返回稳定平台配置错误；
7. 最终结果始终是 argv 数组，禁止生成 shell 字符串或通过 shell 解释执行。

### 10.5 通用 OAuth2

通用 OAuth2 Provider 与 WeCom CLI 分离：

```text
start
  → 生成 state + PKCE verifier
  → 加密保存临时状态
  → 返回平台 authorizationUrl

callback
  → 校验 state、会话、过期时间和一次性消费状态
  → 用 code 换取 token
  → 加密保存凭证
  → 更新会话和 byai_connector_auth
  → 跳转到受控 redirectUrl
```

`redirectUrl` 必须匹配服务端白名单，不能只校验为 HTTP/HTTPS 后原样使用，避免开放重定向。

## 11. 进程、并发与多实例

Redis 会话是临时状态真相，进程注册表只是当前实例的运行时资源：

```text
Map<authorizationId, ManagedAuthorizationProcess>
```

要求：

- 同一用户、连接器默认只允许一个有效 `PENDING` 会话；重复启动返回现有会话或显式替换；
- 进程启动、会话更新和后台任务提交需避免“会话存在但进程未启动”的悬空状态；
- 取消只终止对应 `authorizationId` 的进程；
- 后台任务完成后使用条件更新，取消或过期后不得写回 `CONNECTED`；
- 多实例下使用 Redis 锁或任务租约保证一个授权任务只有一个执行者；
- 飞书应用初始化进程在其他实例不可见时，`config show` 尚未成功则继续保持 Pending，不能据此判定授权失败；
- 服务重启后，DWS/WeCom 长进程不能恢复，应先探测凭证是否落盘，未成功则将会话标记失败或过期；
- Lark 两阶段任务可在 `device_code` 未过期且租约安全时恢复一次完成任务。

## 12. 编排服务状态机

### 12.1 start

1. 校验请求、当前用户和连接器有效性；
2. `authMode = NONE` 时直接创建/更新绑定并返回 `connected`；
3. 根据 `providerCode` 获取 Provider；
4. 对 CLI 型 Provider 校验并解析 `runtime_manifest.runtime.commands`，按 Provider 命令契约生成命令目录；
5. 创建系统 `authorizationId`，将命令目录放入启动上下文并调用 Provider `start()`；
6. 将 Provider 结果、Manifest 摘要、加密临时状态和过期时间原子写入 Redis；只有
   `PENDING/FINALIZING` 创建
   用户连接器活跃索引；
7. 若活跃索引竞争失败，清理本次 Provider 运行时资源并返回 `SESSION_ALREADY_ACTIVE`；
8. Provider 若启动即返回 `CONNECTED`，仍先创建可 CAS 的 `PENDING` 会话，再走
   `PENDING → FINALIZING → CONNECTED`，避免绕过唯一胜者；
9. 返回统一 DTO。

Provider 启动失败时会话更新为 `FAILED`，不得遗留无法查询的内存状态。

### 12.2 status

1. 按 `authorizationId + currentUserId` 查询会话；
2. 会话过期则清理临时秘密并返回 `expired`；
3. 对终态直接返回持久化结果；
4. 对 `PENDING` 重新读取当前 Manifest，校验 canonical 摘要与会话 `manifestDigest` 一致，并构造本次
   查询使用的不可变命令目录；摘要不一致时终止旧任务并要求重新授权；
5. 调用对应 Provider `queryStatus()`；
6. Provider 返回 `CONNECTED` 时 CAS `PENDING → FINALIZING`，胜出者幂等保存连接器绑定，
   成功后再 CAS 为 `CONNECTED`，数据库失败则改为 `FAILED`；
7. `FINALIZING` 查询仅在解密后的绑定元数据携带相同 `authorizationId` 时自愈为 `CONNECTED`；
   无法证明已落库时继续返回 `pending`，由 Redis TTL 最终释放悬空任务；
8. 返回统一 DTO。

### 12.3 cancel

1. 按 `authorizationId + currentUserId` 查询会话；
2. 使用条件更新将 `PENDING` 改为 `CANCELLED`；
3. 调用 Provider 终止运行时资源；
4. 清除临时秘密；
5. 重复取消返回幂等成功。

## 13. 错误模型

统一错误至少包含：

| errorCode | 场景 |
| --- | --- |
| `CONNECTOR_NOT_FOUND` | 连接器不存在或失效 |
| `PROVIDER_NOT_CONFIGURED` | `providerCode` 缺失或未注册 |
| `APP_INIT_URL_MISSING` | 飞书应用初始化未返回官方 `/page/cli` 链接 |
| `APP_INIT_FAILED` | 飞书应用初始化失败或初始化后校验失败 |
| `APP_INIT_EXPIRED` | 飞书应用初始化任务超时 |
| `AUTH_REQUIRED` | 用户尚未授权 |
| `SCOPE_MISSING` | 用户或应用权限不足 |
| `AUTH_EXPIRED` | 授权任务或设备码过期 |
| `AUTH_CANCELLED` | 用户取消授权 |
| `CREDENTIAL_WORKSPACE_UNAVAILABLE` | 用户凭证目录不可用 |
| `CLI_NOT_AVAILABLE` | CLI 不存在或版本不符合要求 |
| `MANIFEST_COMMAND_INVALID` | 命令二维数组、action、命令数量或 argv 不符合契约 |
| `MANIFEST_COMMAND_MISSING` | Provider 当前阶段要求的 action 或命令索引不存在 |
| `COMMAND_PARAMETER_INVALID` | 动态参数或受控占位符无法安全填充 |
| `PROVIDER_PROTOCOL_ERROR` | CLI 输出或平台响应不符合契约 |

日志可以记录 `authorizationId/userId/connectorId/providerCode/errorCode`，禁止记录 token、
device code、OAuth code、PKCE verifier、Cookie、App Secret、完整授权 URL和二维码内容。

## 14. 包结构

```text
domain/connector/
├── authorization/
│   ├── ConnectorAuthorizationProvider.java
│   ├── AuthorizationProviderRegistry.java
│   ├── AuthorizationStartContext.java
│   ├── AuthorizationStartResult.java
│   ├── AuthorizationStatusResult.java
│   ├── AuthorizationStatus.java
│   ├── RedisAuthorizationSessionRepository.java
│   ├── ConnectorCliRunner.java
│   ├── ManifestCommandCatalog.java
│   ├── ConnectorManifestCommandResolver.java
│   └── ConnectorCredentialWorkspaceService.java
├── provider/
│   ├── dingtalk/DwsDingtalkAuthorizationProvider.java
│   ├── lark/LarkCliAuthorizationProvider.java
│   ├── wecom/WecomCliAuthorizationProvider.java
│   └── oauth/OAuth2AuthorizationProvider.java（后续）
└── service/
    └── ConnectorAuthorizationService.java
```

现有模块布局如对 Repository 有统一约定，实施时应遵循已有 Mapper/Entity 分层，不为目录结构本身
做额外重构。

## 15. 兼容策略

旧 DWS 状态接口继续保留 URL 和 DTO 契约，但实际命令同样从连接器 Manifest 获取：

```text
DevloopController
  → DevloopApplicationService
  → ConnectorManifestCommandResolver
  → DwsAuthService
```

新接口使用：

```text
ConnectorController
  → ConnectorAuthorizationService
  → DwsDingtalkAuthorizationProvider
  → DwsAuthService
```

两条入口共享同一用户凭证目录和 DWS 命令契约，避免出现“旧页面已授权、新连接器显示未授权”或命令
漂移。旧的 `/devloop/dws/saveToken` 入口及把 token 放入 argv 的注入路径已移除；真实凭证只由 CLI
native-home 管理。

旧 `POST /devloop/dws/authStatus` 在一次请求内只允许执行一次
`dws auth status --format json`。`DevloopApplicationService` 必须复用该次查询得到的状态快照，同时生成
`runtimeAuthenticated`、`tokenValid` 和兼容字段 `hasToken`，不得为了计算 `hasToken` 再次启动 DWS
子进程。接口 URL、请求体、响应字段和字段类型保持不变；同一响应中的状态字段必须来自同一次 CLI 查询，
避免两次查询之间凭证刷新导致字段互相矛盾。

兼容字段 `hasToken` 统一表示用户 native-home 当前存在 DWS 认证状态，不再表示数据库中存在历史
`DWS_TOKEN` 元数据；`savedAt` 保留为字符串类型并固定返回空字符串。`DevloopController` 继续原样透传
应用服务响应，不修改 `/devloop/dws/authStatus` 的 URL、HTTP 方法、请求体及响应结构。

个人参数列表以数据库 `param_source` 作为唯一来源判定，不根据参数名前缀推断。列表响应为每条记录返回
`source`、`sourceRef`、`managed`、`editable`、`deletable` 和 `enableable`；其中
`param_source=CONNECTOR` 时固定为托管且三个操作权限均为 `false`。个人参数页面增加“来源”列，分别展示
“系统托管”和“用户配置”；托管记录的操作列只显示占位符，不显示停用、编辑和删除。后端保存、启停、
删除接口继续执行同样的托管权限校验，不能依赖前端隐藏操作实现安全控制。

## 16. 测试与验收

### 16.1 单元测试

- Registry 注册、重复编码和未知 Provider；
- start/status/cancel 的用户归属、状态迁移和幂等；
- `NONE` 模式成功写入连接器绑定；
- Provider 结果到统一 DTO/错误码的映射；
- DWS 用户目录失败时关闭失败；
- 旧 DWS `authStatus` 一次请求只执行一次 CLI 状态查询，且 `hasToken` 与
  `runtimeAuthenticated` 来自同一状态快照；
- 个人参数列表按 `param_source` 返回来源与操作权限，托管记录无用户操作入口；
- Lark `device_code` 只消费一次；
- Manifest 命令 value 必须为非空二维数组，内层 argv 必须为非空字符串数组；
- DWS、Lark、WeCom 的必要 action、命令数量、可执行文件和子命令策略校验；
- 未知、缺失或未填充占位符在启动 CLI 前失败；
- Lark `deviceCode` 只允许从加密 `providerState` 填入 `login[1]`，不能由请求直接覆盖；
- WeCom 只有缓存检查和只读业务探针均成功时才进入 `CONNECTED`；
- WeCom 长进程初始化、缓存检查、只读业务探针和取消/恢复状态映射；
- OAuth state、PKCE、回调重复消费和 redirectUrl 白名单。

### 16.2 集成测试

- Redis 会话 TTL、CAS 状态迁移和用户索引；
- 多实例并发轮询只产生一次连接器绑定（多实例进程租约阶段验收）；
- 服务重启后状态恢复策略（首批由 Redis TTL 收敛悬空进程任务）；
- CLI 子进程超时、取消、异常退出和输出解析；
- 每个用户只能访问自己的会话和凭证目录；
- 三个平台授权成功后 `connections` 与连接器列表状态一致。

### 16.3 验收标准

1. `ConnectorAuthorizationService` 不再 import 或注入 `DwsAuthService`；
2. Java 核心编排中不存在按平台增加的 `if/else`；
3. DWS、Lark、WeCom 都通过 Provider 返回统一状态；
4. 重启后 Redis 授权任务仍可查询，不能恢复的长进程由 TTL 收敛；跨实例运行时进程恢复在租约阶段验收；
5. 任意用户不能读取、取消或完成其他用户的授权任务；
6. 日志、DTO、Redis 明文和数据库明文字段中不出现真实凭证或临时秘密；
7. 旧 DWS 接口和现有钉钉扫描任务保持兼容。

### 16.4 构建与部署验收

连接器接口属于后端制品的一部分，镜像标签不能替代源码版本校验。发布前后必须执行以下检查：

1. 构建前确认工作区已切换到包含连接器改动的目标分支和提交，且 `git status --short` 为空；
2. 构建日志和镜像 `/app/build-info.json` 必须同时记录实际 `branch`、完整 `commit`、构建时间和 dirty 状态；
   镜像标签（例如 `D0.3.1`）与实际源码分支不一致时，发布必须失败；
3. Maven 打包完成后校验制品包含 `ConnectorController`、`ConnectorAuthorizationService` 及其 Mapper 资源；
4. 发布后使用已签名的集成请求验证 `POST /byaiService/connector/listAll` 已被 Controller 映射，不能仅以未签名
   请求得到的 `401` 作为路由验收结果；
5. 后端 HTTP 服务端口为 `BE_SERVER_PORT`，默认 `8086`。容器 healthcheck 必须访问
   `http://localhost:${BE_SERVER_PORT}/actuator/health` 或等价的匿名健康检查端点；`8080` 是前端 Nginx 端口，
   不能作为后端容器的 healthcheck 地址。

若路由未注册，Spring MVC 会将请求交给静态资源处理器并产生 `NoResourceFoundException`。全局异常处理器应
记录原始异常、请求路径和关联 ID；对外可保持统一错误结构，但不能仅凭 `server_error` 判断为 OAuth 或鉴权故障。

## 17. 分阶段实施

### 阶段一：统一抽象并迁移钉钉

- 增加 Provider 接口、Registry 和统一结果模型；
- 增加 `provider_code` 并迁移钉钉配置；
- 新增 `DwsDingtalkAuthorizationProvider`；
- 移除 `ConnectorAuthorizationService` 对 `DwsAuthService` 的直接依赖；
- 修复 DWS 显式用户参数、隔离失败和全局单进程问题。

### 阶段二：Redis 授权会话

- 新增 Redis 会话模型和 Repository；
- 将 `ConcurrentHashMap` 中的业务状态迁移到 Redis，内存只保留进程句柄；
- 增加 TTL、CAS 状态迁移、用户索引、过期处理和进程注册表；
- 统一连接器绑定写入和 `NONE` 模式行为。

### 阶段三：接入 Lark CLI

- 实现两阶段 Device Flow、用户工作区和后台完成任务；
- 区分应用配置缺失、用户授权缺失和 scope 缺失；
- 增加状态验证、过期和重复消费测试。

### 阶段四：接入 WeCom CLI

- 实现长进程扫码初始化、URL 提取和进程管理；
- 定义并实现只读业务探针；
- 验证用户缓存隔离和重启后探测策略。

### 阶段四补充：多实例进程租约

- 使用 Redis owner/lease 保证同一 `authorizationId` 只有一个实例执行 CLI 完成任务；
- 增加 owner 路由或远程取消，使任意实例收到 cancel 都能终止实际持有进程的实例；
- 完成该阶段前，连接器授权接口按单副本部署约束运行。

### 阶段四补充：Manifest 命令驱动（已完成）

- 已将 `runtime.commands` 从一维 argv 升级为二维命令组，并通过 `V0.5.1__dml.sql` 迁移三个内置
  连接器模板；
- 已新增 Manifest 命令目录、Provider 命令契约和受控占位符解析；
- 已在调用 Provider 前完成命令校验，并移除生产路径中与 Manifest 重复的 argv 常量；
- 已将 Lark 多阶段命令和 WeCom 业务探针纳入 Manifest；
- Provider 继续负责条件分支、异步进程、重试、输出解析和状态迁移。

### 阶段五：按需增加通用 OAuth2

- 增加 callback、state、PKCE 和 redirectUrl 白名单；
- 实现应用管理型凭证加密、刷新和撤销。

## 18. 关键安全要求

- 所有授权任务绑定用户 ID，所有读取和变更校验任务归属；
- 用户工作区解析失败时关闭失败，不继承全局 `HOME`；
- 不在命令参数中传递可通过 stdin 或安全文件传递的长期 token；
- 不在日志、响应或明文字段记录 token、device code、OAuth code、Cookie 或 App Secret；
- 临时秘密加密存储并在终态或过期后清除；
- 首批实现沿用项目现有 `Sm4Util` 以保持兼容；其固定密钥和 ECB 模式属于系统级安全债务，后续应迁移
  到部署密钥托管且具备完整性校验的加密方案，并设计存量密文迁移；
- 授权 URL、二维码、state 和 provider session 均设置明确有效期；
- OAuth redirectUrl 使用服务端白名单；
- Provider 不得回退到其他用户、其他 Provider 或全局授权环境；
- Manifest 命令不得通过 shell 执行；Provider 必须限制可执行文件、子命令、命令数量和占位符集合；
- 动态命令参数不得直接来自未校验的前端输入，临时秘密只能从加密会话状态或受控平台响应恢复；
- 授权成功只由统一编排层写入 `byai_connector_auth`。

## 19. 结论

统一授权服务复用的是“授权任务状态机”，Manifest 提供平台 CLI 命令模板，Provider 负责平台协议编排。
最终依赖关系为：

```text
ConnectorAuthorizationService
        ↓
AuthorizationProviderRegistry
        ↓
ManifestCommandResolver / ManifestCommandCatalog
        ↓
ConnectorAuthorizationProvider
        ↓
DWS / Lark CLI / WeCom CLI / OAuth2
```

钉钉通过 Provider 包装现有 `DwsAuthService`；飞书实现应用初始化和用户 Device Flow 多阶段编排；
企业微信实现长进程初始化、缓存检查和只读业务探针。二维命令组不替代 Provider 状态机：Manifest 决定
“可执行哪些 argv 模板”，Provider 决定“何时执行哪一条、动态参数从哪里来以及结果代表什么”。Redis
会话、显式用户上下文、凭证工作区隔离和统一绑定写入仍是三种平台走通同一套接口的必要条件。
