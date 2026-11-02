# HACU 企业工作组云盘汇总

2026-11-02：平台 Operations 服务桥增加只读 `resource=enterprise-storage`、`operation=summary`；仅接受现有服务 Token，可信 actor 为用户 ID，payload 仅接受已授权的 enterpriseId。独立调用前再次校验用户启用状态和该企业的有效成员关系（兼容 adminvip）。浏览器不得直接调用服务桥。

工作组项目及 `cloudResourceId` 保存在平台库，包含租户 Node 中工作组所绑定的 HACU 项目；兼容历史共享库 hs_as 会话关联的项目。按本企业未删除项目查出知识库编码，不按当前用户的入组列表过滤，已解散但保留的云盘继续累计；同一资源被多个项目关联时仅累计一次；不同资源使用相同知识库编码会导致既有路由产生歧义，明确返回不可用。

通过既有 FeignPythonBuildService 调用知识库团队待上线接口 `POST /api/v1/knowledgeBases/status`，请求正文仅含 `knCodeList`，内部用于路由的首个 knCode 不序列化。批量调用不携带 `X-Byclaw-Resource-Id`，避免首个资源的单库上下文误代表整批；继续沿用已有服务发现或直连通道。按知识服务端点和 path 分批；第三方知识服务配置需声明 status operation，不绕过既有路由或另建地址配置。

仅接受完整成功结果：按 knCode 对齐响应，检查缺项、重复项、负值和无效统计；空企业直接返回零，不发空列表。未初始化或损坏的云盘关联、HTTP 404/422/503/500 与网络故障均沿用桥接失败响应，不能生成部分汇总或零用量。

结果为 `usedKb`（BigDecimal 求和后十进制文本，1 KB = 1024 字节）、`fileCount`、`sampledAt` 和按云盘去重的 `groups`（projectId/name/usedKb/fileCount）。QA 的两位小数舍入误差保留，展示非精确容量扣量账本；写入准入另取保守上界，见 [HACU 云盘限额](hacu-storage-quota.md)。ByClaw 不读取 HACU 套餐表或自行计算商业容量，而消费 HACU 发布的专用容量投影；HACU 通过独立契约适配器校验结果，再组合自己的容量及展示权限。HACU 面向普通成员返回总量时以 `groups=null` 隐藏明细，区别于有权限但无云盘时的空数组。

对应服务汇总与知识库 HTTP 契约测试已补充，但按用户要求未执行编译、构建、测试或服务启动。上线需要同时包含本服务桥扩展与 HACU 接入，并等待 QA status 接口可用；无 DDL/DML 迁移。

## 平台管理员读取（2026-11-02）

新增固定 `resource=platform-storage`、`operation=summary`，沿用同一个受服务 Token 保护的 `/internal/v1/platform-operations`。HACU 必须先校验 `platform:enterprises:read` 和平台登录，确认企业存在后才能调用；actor 是真实平台主体，不转换成企业成员 ID。此内部入口复用 `EnterpriseStorageService.usage`，不按企业成员关系过滤；原 `enterprise-storage/summary` 继续二次检查企业成员或 adminvip 身份。

新入口只读，其他 operation 拒绝；结果字段、完整性校验、知识服务批量统计和未知状态语义保持一致。HACU 仅向平台页面返回汇总用量，商业额度和有效增配由 HACU 的已生效快照提供。补充了平台/成员分流与非法动作测试，未执行测试、编译或部署。
