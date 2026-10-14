# 授权流程

管理已发布技能对目标用户的使用权限，包括查询、授予和撤销。输入为真实技能资源 ID、目标用户 ID/名称和要求的权限变化。数字员工 ID 与用户 ID 不能混用。

授权是平台注册后、建立目标员工绑定所需的权限管理环节；已有权限按平台规则复用。授权本身不代替绑定，也不表示运行时已收到文件。绑定广播与自动加载的关系见 [生命周期契约](lifecycle.md)。

## 1. 核实资源与当前权限

确认资源已发布/资源化，查询当前成员和当前操作者的管理权限。缺少资源时先按用户目标转到 [发布流程](publishing.md)，不要伪造资源 ID。读取现有权限，已满足目标时只报告查询结果，不重复写入。

## 2. 提交目标差异

取得已经资源化的 skill_id 和真实目标 user_id，先读取当前成员，判断是否需要变化。默认 FORCE_USE；其他授权类型需用户明确要求且接口支持。授权给用户不意味着该用户的全部数字员工自动安装。

```python
api.grant_skill_to_users(
    skill_id,
    grant_users=[{'grantToObjId': user_id, 'grantToObjType': 'USER',
                  'grantToObjName': user_name, 'grantType': 'FORCE_USE'}],
)
```

撤销使用 `revoke_users=[{'grantToObjId': user_id, 'grantToObjType': 'USER'}]`，对应 blackList；只提交目标差异，保留其他用户。现有 revoke CLI 会构造自身要求的字段，优先复用。成员查询分页自动查至目标或完整范围；执行后回读确认，不能仅依赖 CLI 的 updatedMembers 默认值。

如服务端要求发布到门户或拒绝管理权限，报告真实业务响应；不要为让授权通过而自动改变发布状态、企业归属或提高权限。

## 3. 回读与交付

分页查询至目标用户或用户要求的完整范围，确认实际权限与目标一致。报告技能、目标用户、授予/撤销结果和未完成项。撤销某条显式授权后如仍存在组织等其他权限来源，不声称该用户完全失去访问能力，按平台有效权限结果说明。

授权成功后，仅在用户还要求安装时进入 [安装流程](installation.md)。参数与现有 grant/revoke/members 脚本见 [API 契约](api-contracts.md)；写入结果不明时按 [错误与恢复](error-codes.md) 先回读。
