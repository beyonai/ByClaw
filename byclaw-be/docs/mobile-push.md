# 工作组通用消息事件与 HACU 通知

2026-11-10 按用户授权调整为：**消息提交成功 → ByClaw 发布通用事件 → HACU 决定并发送通知 → 腾讯云 → 手机**。
聊天写入、WebSocket 发送/确认、历史、撤回和已读事实继续归 ByClaw；手机设备、通知偏好及腾讯云适配归 HACU BE。
旧 `/mobile-push/*` 手机接口和发送器已移出本项目；现有站内 `NotificationController` 保留。

## 提交和事件边界

公共库用户消息与完整员工回复沿用现有 `afterCommit`；租户消息沿用 Node 成功提交回执。
`GroupChatEventPublisher` 的公共库、租户、转发入口将完整 `MESSAGE_CREATED` 转为 `workgroup.message.created` v1。
转发消息在等待 Socket 投递前发布外部事实，Socket 失败不会取消已提交事实。历史读取、片段、思考和工具流不发布该事件。

新增 `HookPublisher.publishCommitted` 只适用于调用方已经观察到拥有者数据库提交的事实。
普通 `publish` 的事务/回滚行为不变；`afterCommit` 内事务标识仍可能为 true，不能再次注册提交回调。
所有订阅沿用现有有界 Hook 执行器、独立 HMAC 和有限重试，不在聊天请求线程发送 HTTP。
这仍是尽力事件：队列拒绝、成员读取失败、重启或网络故障可能丢失事件，没有新增 outbox 或通知任务表。

事件正文由 `config/examples/hacu-workgroup-events.yaml` 中 `hacu-workgroup-message` 映射：

```json
{
  "eventId": "uuid",
  "eventType": "workgroup.message.created",
  "version": 1,
  "occurredAtEpochSeconds": 1790000000,
  "enterpriseId": "7",
  "groupId": "30",
  "messageId": "9007199254740993",
  "senderId": "22",
  "senderType": "USER",
  "recipientIds": ["22", "23"]
}
```

事件包含真实 USER 成员的候选账号；HACU 按显式 USER 发件人排除本人，员工创建者不能冒充真人发件人。
所有业务 ID 为十进制字符串，不输出正文、附件、设备标识或令牌。重复投递可能存在，HACU 用消息/账号/安装实例摘要做短期去重。

## 独立服务查询

新增只读服务接口（运行上下文沿用实际部署前缀）：

- `GET /internal/v1/tenants/{enterpriseId}/workgroups/{groupId}/members/{accountId}` → `member`。
- `GET /internal/v1/tenants/{enterpriseId}/workgroups/{groupId}/messages/{messageId}/access/{accountId}` → `allowed/mentioned`。
- `GET /internal/v1/tenants/{enterpriseId}/accounts/{accountId}/workgroup-unread` → `count`（0–9999）。

均要求现有服务 HMAC、`workgroup:read` 和企业白名单；浏览器 Session 或自行指定 accountId 不构成服务身份。
公共库校验企业、未解散群、真人成员、完整且未撤回消息与已读游标；独立租户以接收人身份查询 Node。
Node 上下文新增明确 `complete` 字段，旧 Node 缺少字段时拒绝通知；不能把首屏未读冒充总量。

## 部署交接

1. 先停旧 ByClaw 手机发送/绑定写入。ByClaw V0.6.0 已移除推送建表和字段 SQL；已部署数据库的旧表及墓碑保留为迁移源。
2. 推送建表、索引、字段、注释和兼容数据迁移统一归 HACU 当前 D0.6.0 的 V0.6.0 DDL/DML。新库直接创建 HACU 表；旧表不存在时复制段跳过，旧表缺少 preferences 时默认空偏好，无须先升级 ByClaw 旧表。只执行尚未执行的新增部分。
3. 为 HACU 到 ByClaw 的既有服务身份增加 `workgroup:read`，保留原有业务 scope 和企业边界。
   `config/examples/workgroup-integration.yaml` 展示增量合并要求，不能覆盖原有权限配置。
4. 加载 hooks 示例，配置 `BYCLAW_HOOKS_ENABLED`、`HACU_WORKGROUP_EVENTS_ENABLED`、
   `HACU_WORKGROUP_EVENTS_URL`、`HACU_WORKGROUP_EVENT_CLIENT_ID`、`HACU_WORKGROUP_EVENT_SECRET`。
   URL 必须包含 HACU 实际上下文 `/hacuService/api/v1/integrations/byclaw/workgroup-events`；代理须保留验签路径。
5. 腾讯云 `MOBILE_PUSH_*` 只注入 HACU，App 通知接口迁到 HACU 安全通道后再开启发送。

详细设备迁移、限速、策略、监控和手机验收见 HACU BE `docs/mobile-push.md` 与 App `docs/mobile-push.md`。
当前 SDK/APNs 历史配置不代表本次链路已部署或验收。

## 本轮验证范围

已迁移权限/未读测试，并补充提交后 Hook、回滚保持、事件内容隔离、离线成员、服务 scope 与 Node 完整状态用例。
按用户要求未执行编译、构建、测试、数据库迁移或真实通知；源码格式整理和差异审阅不能替代这些验证。
