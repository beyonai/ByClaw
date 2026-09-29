# 个人技能上架企业审核

个人技能的“上架到企业”提交独立企业快照，状态为审核中（4）。申请进入资源中心审核中心，申请类型为“技能上架”。仅 adminvip 和平台管理角色可审核，资源管理授权、组织管理和平台运营角色不提供该审核权限。

审核通过后快照上架（2）；驳回后保持不可用（5）。重复提交待审核技能复用已有副本，不重复创建申请；驳回后再次提交按个人技能当前内容创建新快照及审核记录。个人源技能不变，历史记录保留审核人及时间。

`POST /byaiService/tool/publishSkillToEnterprise` 接收 `resourceId`，返回企业快照 `resource`、是否复用 `alreadyExists` 和 `personalDependencies`（资源 ID、名称、业务类型）。有效显式关联中的个人数字员工、知识和工具只触发提醒，不阻断提交；企业出向关联保留，沿用既有权限。不会解析技能文件正文中的非结构化资源引用。

上架申请复用 `au_privilege_grant`，以 `grant_type=SKILL_PUBLICATION` 区分使用权限申请，状态沿用 `P`（待审核）、`X`（通过）、`R`（驳回），申请人和审核人沿用现有字段。该类型不产生有效使用或管理授权。

通过、驳回复用现有 `approveUseApply` / `rejectUseApply` 接口，接收 `resourceId`、`applyUserId`，上架申请额外传 `auditType=SKILL_PUBLICATION`。不传类型保持原使用审核行为。服务端重新校验上架审核角色、当前企业及待审核状态，在同一事务内更新资源和申请记录；上架通过不执行使用授权逻辑。

审核中心原聚合查询返回 `auditType=SKILL_PUBLICATION`，申请 ID 沿用 `privilegeGrantId`，与使用权限申请区分。待审核数量沿用同一聚合查询。

本功能复用现有表和字段，不新增表、不需要数据库迁移。
