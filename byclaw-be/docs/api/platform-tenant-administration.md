# 平台运营租户服务桥

新增 `TenantAdministrationOperations`，由现有令牌认证的 `POST /internal/v1/platform-operations` 调用。资源 `tenant-admin` 提供 list/packages/create/provision/delete/organizations/organization-members/attach/add-member；资源 `tenant-datasource` 提供 tables/browse/execute。业务参数和业务实现复用主站 `/admin/tenants/*`、`/admin/tenant-datasource/*`，原浏览器端接口仍可使用。

执行账号由服务端 `hacu.operations.tenant-admin-user-code` 配置，默认 `adminvip`。先加载真实 LoginInfo 并检查平台角色和用户 ID；禁止请求参数指定执行账号。创建复用原服务的首位 OWNER 逻辑，即桥配置账号成为 OWNER；HACU 独立操作人在 HACU 请求意图和受理审计中保留。原租户创建策略和人数上限检查继续生效。

租户投影增加状态版本 revision，套餐 ID 使用字符串。写操作必须附带 reason/revision；新建版本固定 new，保留主站幂等 requestId。状态版本基于企业 ID、状态、阶段和开通时间，用于拒绝陈旧页面；它不是成员集合的事务版本。SQL 危险性由原服务的词法判断决定，伪造 confirmed=false 不会绕过审计字段要求。数据源服务在执行前拒绝行锁 SQL；连接仍由 ByClaw 内部持有，结果沿用原有分页上限。

按用户要求本轮只编写代码与回归用例，未运行编译、构建、测试、真实数据库 SQL 或服务联调。与 HACU 变更配套发布后验收；未部署、提交或推送。
