# BYAI 连接器表待办问题记录

## 范围

本文记录 `byai_connector_info` 和 `byai_connector_auth` 当前未在本次变更中处理的问题。

本次已处理的问题包括：

- 连接器列表在用户存在多条授权记录时可能重复；
- 授权记录查询、更新缺少当前用户归属条件；
- 已过期授权仍可能返回启用状态；
- 未授权、已禁用和已过期状态的接口表达混淆；
- 授权接口与前端路径/字段契约不一致；
- 查询对象承载用户身份、空请求和外部连接器 ID 不统一；
- 授权保存缺少连接器、授权模式、凭证和启用状态校验；
- 连接器表缺少关联约束和查询索引；
- V0.3.1 迁移脚本缺少 `search_path` 且唯一约束创建不可重复执行。

## 待处理问题

### 0. 第三方 OAuth 回调和凭证落库仍需平台适配

本次补齐了前端所需的连接器列表、授权开始和授权状态接口，并统一使用 `connectorCode` 作为外部 ID。当前授权任务接口可以返回已配置的授权地址和 `pending` 状态，但尚未接入钉钉、企业微信、飞书各自的回调、授权码换 token、凭证加密落库和刷新流程。

因此，生产启用 OAuth2 连接器前仍需补充：

- 每个平台的授权 URL、token URL、client 配置和 scope；
- 带用户绑定的 state/PKCE 防重放机制；
- 后端 callback 接口及授权任务持久化；
- token 交换、刷新、失效和 `byai_connector_auth` 写入；
- 多实例部署下不能依赖单机内存保存授权任务。

### 0.1 聊天执行链路尚未消费连接器选择

前端会在聊天请求的 `payload.extParams.connectors` 中发送连接器业务编码，但当前 Java 聊天处理链路中尚未发现对应的读取、授权校验和连接器调用逻辑。

后续需要在聊天请求边界统一完成：

- 校验连接器编码是否存在且属于当前用户可用连接；
- 将业务编码解析为内部连接器信息和授权记录；
- 禁止客户端直接传入数据库 `connector_id` 绕过业务编码校验；
- 将选中的连接器传递给实际检索/工具执行层。

### 1. 授权凭证的加密闭环尚未建立

`byai_connector_auth.auth_credential` 的注释要求保存加密后的 JSON，但当前实体和服务层没有统一的加密、解密、密钥管理和日志脱敏实现。

后续应补充：

- 保存前统一加密，禁止业务调用方直接写入明文；
- 读取凭证时只在连接器执行层解密；
- API DTO 禁止返回完整凭证；
- 日志、异常和审计记录对凭证字段脱敏；
- 加密密钥从密钥管理或环境变量注入，不写入数据库和代码仓库；
- 增加明文凭证迁移/检测方案，避免历史数据绕过加密流程。

### 2. 软删除规则尚未框架化

表使用 `status_cd = '00A' / '00X'` 表示有效和无效，但实体没有使用 MyBatis-Plus 的逻辑删除能力。除已明确编写条件的查询外，其他通用 `selectById`、更新和统计操作仍可能读到或操作无效记录。

后续应统一选择一种方案：

- 使用 `@TableLogic`，让框架自动追加逻辑删除条件；或
- 封装连接器授权专用 Mapper/Repository，禁止直接使用无状态过滤的通用 CRUD。

同时应补充恢复、删除和历史授权记录查询的明确接口语义。

### 3. JSON 配置字段缺少结构校验

`auth_config`、`request_config` 和 `auth_credential` 当前以字符串保存。数据库和应用层都没有验证 JSON 结构、必填字段或版本信息，配置格式错误只能在运行连接器时暴露。

后续应考虑：

- 为授权模板和请求配置定义版本化 JSON Schema；
- 保存和更新时进行结构校验；
- 为配置增加 `schema_version` 或在 JSON 内固定版本字段；
- 对需要查询的公共配置评估 JSON/JSONB 类型；
- `auth_credential` 仍应优先保证加密，不应为了可查询性直接暴露敏感字段。

### 4. `auth_mode` 冗余字段的一致性未统一

`byai_connector_auth.auth_mode` 被设计为冗余字段，理论上应与 `byai_connector_info.auth_mode` 一致，但当前没有数据库约束或服务层校验。连接器模板授权方式变更后，历史授权记录可能保留旧值。

后续应明确策略：

- 授权记录不保存 `auth_mode`，运行时始终读取连接器模板；或
- 保存快照，并在授权创建、刷新和执行时校验版本/模式；或
- 连接器授权方式变更时同步处理已有授权记录。

## 相关代码

- 表结构：`deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql`
- 连接器列表查询：`byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/connector/ConnectorInfoMapper.xml`
- 授权领域服务：`byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/connector/service/ConnectorAuthService.java`
