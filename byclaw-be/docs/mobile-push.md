# 工作组手机推送（独立 TIMPush）

2026-11-09 用户授权新增 App 通知所需后端能力，沿用现有聊天和登录协议。
本次使用新产品 Push／TIMPush，不使用已停止新应用接入的 TPNS；免费版由用户在腾讯云 IM
控制台手动开通，代码不购买或升级套餐。

## 配置和版本

本地 `config/application.properties` 与容器的 `deploy/config/application.properties` 均已映射
`MOBILE_PUSH_*` 环境变量，无须另外加载 `config/examples/mobile-push.yaml`；默认关闭。
本机已开通 SDKAppID `1600171664` 的免费版，真实密钥保存于被 Git 忽略、权限 `0600` 的
`byclaw-be/.env`，当前 `MOBILE_PUSH_ENABLED=false`，等待迁移和原生配置。
启动器通过 `-Denv.file` 或从工作目录逐级查找加载 `.env`，系统属性和进程环境优先于文件。
standalone Compose 读取仓库根目录 `.env`，上线需将相同变量提供到真实部署环境，不能只修改本机。
`client-app-key` 为可下发给 App 的 Push 客户端密钥；`secret-key` 只用于服务器签发管理员
UserSig，不返回客户端，也不写日志。App 的环境必须与 `environment-id` 匹配。
管理员默认 `administrator`；启用前核对控制台管理员。iOS APNs 仍未配置，客户端还缺
控制台分配的 `businessID`；普通通知不要求消息模板，但必须完成 APNs 和匹配的签名描述文件。

实际 Git 分支为 `D0.6.0`，仅设备绑定表 `byai_mobile_push_device` 追加于
`deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql`，推送无需新增 DML 初始化记录。
已执行过该版本的环境只按发布流程应用新增 `MOBILE PUSH` 部分，不整份重跑；未执行迁移前保持关闭。
不修改生成的 initdb 或 `.applied`，不使用 `IF NOT EXISTS` 或查询行锁。

## 新接口

沿用 `/byaiService` 上下文及原认证／签名拦截器：

- `GET /mobile-push/config`：未开通返回 `{enabled:false}`；已开通返回
  `enabled/sdkAppId/appKey/environmentId`，不返回服务器密钥或管理员 UserSig。
- `POST /mobile-push/devices/bind`：安装实例、递增版本、RegistrationID、平台及语言。
  当前账号只取 `CurrentUserHolder`，不会使用客户端指定的 accountId。
- `POST /mobile-push/devices/unbind`：安装实例和递增版本；只解绑当前账号拥有的绑定。

安装实例版本 CAS 使旧账号解绑和迟到注册不能覆盖新绑定；解绑保留墓碑。
一个账号可绑定多台设备，一台安装实例同时只属于一个账号。

## 消息路径

`GroupChatEventPublisher` 的公共库、租户和转发发布入口连接到 `MobilePushService`。
只消费 `MESSAGE_CREATED`，不消费历史、思考、工具流或消息 token。接收人来自已有的真人成员集合，
人工发送者不通知自己，数字员工不按 creatorId 被误判为真人。

当前按用户要求采用一张设备绑定表，不创建投递任务表、限速表或推送初始化 DML。
`notifyMembers` 只复制企业、群、消息和接收账号 ID，再交给专用 `mobilePushExecutor`。
该执行器为一个工作线程、最多等待 64 个消息通知任务；满载直接拒绝，不回退到聊天线程。
等待中的通知执行前检查一分钟时效；进程退出或重启不会恢复这些内存任务。

异步执行时查询当前有效设备；发送前复核成员、撤回状态和设备版本，公共库还检查已读位置。
所有实例复用现有 `StringRedisTemplate`，通过 `byclaw:mobile-push:rate:{SDKAppID}`
单键 `SET NX` 加 100ms TTL 限速。同一应用跨环境共享额度，必须使用同一 Redis。
限速忙碌时最多进行十个 100ms 间隔的短等；Redis 异常或结果不确定时跳过本次提醒。
只用单键操作，沿用客户端处理单机和 Cluster 路由，不使用 Lua、手动选库或扫描。

同一消息、接收账号及安装实例使用摘要身份，通过
`byclaw:mobile-push:dedup:{SDKAppID}:<摘要>` 单键 `SET NX` 加十分钟 TTL 做短期去重。
去重标记不保存消息正文、设备 token 或待发任务。每条通知只调用厂商一次，失败后不自动重试；
网络结果不确定也不补发。Redis 去重标记过期或丢失后，重复广播仍可能造成重复通知。

线程池满载、时效超限、限速冲突、Redis／数据库／云端故障及重启都可能漏提醒，不影响原有聊天消息。
无投递状态表、租约、轮询任务或持久重试；云端返回零仅表示受理，不能证明手机显示或用户已读。
日志仅保留通知摘要和安全错误码，不能用数据库投递状态排查结果。

通知文案只含品牌和本地化的“工作组有新消息”，不存储、打印或发送聊天正文。
Ext 仅携带 `version=1/kind=group-message/environmentId/accountId/enterpriseId/sessionId/messageId`；
所有业务 ID 为字符串，App 点击后重新验证权限并读取业务数据。

完整的 Donut、APNs、Android 厂商、免费版配置及真机验收指引位于 App 仓库的
`docs/mobile-push.md`。现有预编译宿主需要重新生成及导入，不能把 npm 依赖安装等同于原生接入完成。

## 验证

已编写客户端对应接口的认证／密钥隔离、消息筛选、异步执行拒绝／故障隔离、权限复核和云端部分失败用例，
以及需显式本机专用 PostgreSQL 的 设备绑定 CAS／换号／解绑集成用例。未运行 Maven 编译或测试，未发送真实推送。
Redis 限速已补充原子 TTL、跨实例／跨环境共享、失败暂停及恢复用例；真实单机与 Cluster
集成用例分别由 `BYCLAW_TEST_REDIS_PORT`、`BYCLAW_TEST_REDIS_CLUSTER_PORT` 显式启用，
须指向本机专用测试实例。本次未执行这些测试，未验证真实 Redis Cluster 行为。
数据库集成用例只允许 `MOBILE_PUSH_TEST_JDBC=jdbc:postgresql://127.0.0.1:<端口>/byclaw_push_test`，
预先准备空的 `byai` schema，禁止指向共享开发库或线上数据库。

官方资料：[TPNS 停售](https://cloud.tencent.com/document/product/548/103030)、
[新版迁移方案](https://cloud.tencent.com/document/product/269/129588)、
[Donut](https://cloud.tencent.com/document/product/269/111208)、
[单发接口](https://cloud.tencent.com/document/product/269/108906)。
