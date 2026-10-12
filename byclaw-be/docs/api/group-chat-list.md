# 工作组列表查询

`GET /group-chats` 的本地 Java 路径由 `GroupChatReadService.listMyGroups` 调用
`ByaiGroupChatMentionMapper.selectMyGroupsScoped`，通过 PageHelper 返回列表和总数。
租户路由在开发环境中复用此 Java 查询，其他环境直接请求 Node 群列表。
本次优化覆盖 Java 查询，保持路由规则与 Node 内部查询不变。

## 查询范围

列表、最新消息窗口和分页总数共用 `VisibleGroupConditions`：

- 只返回当前用户以 `USER` 身份加入的 `hs_as` 工作组。
- `enterpriseId` 缺失或为默认值 `1` 时不按企业过滤；其他非空值按工作组所属企业精确过滤。
- 已解散工作组不再对群主显示；非群主成员确认解散后也不再显示。

最新消息窗口先限定到完整的可见工作组集合，再按工作组计算最新消息。
不能先分页工作组 ID 再补最新消息，因为列表顺序依赖最新消息时间。
PageHelper 使用 `selectMyGroupsScoped_COUNT` 单独统计成员和工作组关联行，
总数查询不读取消息或提及历史。

## 保持的返回语义

- 最新消息只排除已归档消息，按 `create_time DESC, message_id DESC` 选择。
- 撤回消息仍决定最新消息位置；内容及附件的撤回投影由应用层处理。
- 无消息或仅有归档消息的工作组仍计入总数，最新消息字段为空。
- 列表按最新消息时间、工作组更新时间、创建时间依次回退，最后按工作组 ID 降序。
- 未读消息、未读提及和成员摘要保持原有规则。已读状态接口的 SQL 不作变更。

## 验证

`ByaiGroupChatMentionMapperPaginationTest` 使用真实 MyBatis、SQLite 和 PageHelper，
覆盖企业范围、解散确认、分页总数、无消息、归档及撤回消息。
额外用数据库函数观察消息投影和排序访问，防止窗口重新处理不可见工作组，
或总数查询重新读取消息历史；测试不依赖耗时阈值。

```bash
mvn -B -f byclaw-be/pom.xml -Dtest=ByaiGroupChatMentionMapperPaginationTest,GroupChatReadServiceTest,TenantGroupChatRoutingAspectTest test
mvn -B -f byclaw-be/pom.xml verify
```

SQLite 测试验证返回契约及访问范围；生产数据库的执行计划和耗时需另用只读
`EXPLAIN ANALYZE` 对照确认。
