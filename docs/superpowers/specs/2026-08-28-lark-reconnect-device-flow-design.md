# 飞书连接器重连 Device Flow 一致性修复设计

## 背景

用户完成过飞书连接后，先取消绑定，再重新连接。重新连接包含两个浏览器阶段：

1. 初始化或确认飞书应用；
2. 使用 Device Flow 授权当前用户。

同一次复现中，第二阶段弹窗二维码与“继续授权”按钮指向不同的 `flow_id/user_code`。按钮打开后，飞书返回错误码 `20001`（请求不合法）。这表明授权任务在阶段切换或轮询期间替换了 Device Flow，页面同时持有新旧两份授权入口。

## 目标

- 同一个授权任务的用户授权阶段最多创建一次 Device Flow。
- 二维码、按钮链接和后台完成命令始终引用同一组 `authorizationUrl/deviceCode`。
- 取消绑定后重新连接可以复用有效应用配置；若确实需要初始化应用，两阶段切换仍保持幂等。
- 为“首次连接、取消绑定、重新连接、完成两阶段授权”增加回归测试。

## 非目标

- 不改变飞书 OAuth/Device Flow 协议。
- 不修改连接器数据库结构或迁移文件。
- 不改变其他连接器的授权行为。
- 不在日志、响应或测试输出中暴露真实 `deviceCode`、token 或 App Secret。

## 方案

### 1. 后端以持久化授权会话作为唯一事实来源

`app_initialization` 完成后，后端只创建一次用户 Device Flow，并将以下数据作为一次状态迁移原子写入 Redis 授权会话：

- `phase=user_authorization`；
- 新的 `authorizationUrl`；
- 包含 `deviceCode` 的加密 `providerState`；
- 对应的过期时间；
- 递增后的会话版本。

如果状态迁移发生并发冲突，请求必须重新读取已持久化会话并返回其中的 Device Flow，不得再次调用 `lark-cli auth login --no-wait`。

### 2. 用户授权阶段禁止替换 Device Flow

进入 `user_authorization` 后：

- 首次状态查询可以启动一次 `auth login --device-code ...` 完成进程；
- 进程信息写回同一个加密 `providerState`；
- 后续查询只检查该进程或最终凭据状态；
- 除非当前授权任务已终止并由用户显式重新发起，否则不得生成新的授权 URL 或 device code。

### 3. 二维码与按钮使用同一个 URL

授权响应中的 `authorizationUrl` 是唯一授权入口。`qrCodeUrl` 必须由同一次响应的 `authorizationUrl` 生成。前端在授权 URL 改变时，以 URL 本身作为打开去重键，避免只按 `authorizationId + phase` 去重而掩盖同阶段的异常 URL 替换。

前端不解析、不缓存 `flow_id` 或 `user_code`。

### 4. 取消绑定后的配置复用

取消绑定继续执行 `lark-cli auth logout --json`，只清理用户 token。重新连接时先在相同用户沙箱和固定 `LARK_HOME` 中运行 `config show`：

- 配置有效：直接进入用户 Device Flow；
- 明确返回 `not_configured`：才进入应用初始化；
- 其他错误：终止并返回稳定错误，不通过强制初始化掩盖存储或沙箱异常。

本次修复不扩大到沙箱存储架构重构，但回归测试必须验证 revoke 不会主动删除应用配置。

## 本地复现策略

使用现有 Java 单元测试中的假 `SandboxCommandExecutor` 和 Redis 会话仓库模拟以下顺序：

1. 应用初始化返回 URL A；
2. 初始化完成后用户授权返回 Device Flow B；
3. 在状态切换边界发起重复状态查询或制造 CAS 冲突；
4. 当前实现若再次调用 `START_USER_AUTHORIZATION`，返回 Device Flow C；
5. 断言失败现象：响应二维码/链接或完成命令不再全部引用 B。

测试必须先在未修复代码上因重复生成或 URL 不一致而失败，再实施生产代码变更。

## 测试与验收

- Provider/runtime 测试：阶段切换只调用一次 `START_USER_AUTHORIZATION`。
- Service 测试：CAS 冲突后返回持久化会话的 URL，不重复调用 Provider 生成新流程。
- DTO/二维码测试：解码 `qrCodeUrl` 后内容与 `authorizationUrl` 完全一致。
- 前端测试：同阶段 URL 变化时使用完整 URL 作为打开去重键，并同步更新二维码与按钮。
- 取消绑定回归：logout 后重连的 `config show` 成功时不得调用 `config init`。
- 运行涉及的后端定向测试、前端 ConnectorControl 测试，以及模块级非变更式 lint/构建验证。

## 错误处理与安全

- 并发冲突返回最新持久化状态，不向用户返回内部锁或 CAS 细节。
- 任何无法确认配置状态的错误都不得触发新应用创建。
- 日志只记录授权任务 ID、阶段、沙箱 ID 和进程 ID；不记录完整授权 URL、user code、device code 或 token。

