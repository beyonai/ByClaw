# 创建工作组

`POST /group-chats` 使用 `GroupChatCreateRequest` 接收参数。

- `name` 必填，长度上限为 50 个字符；群设置的 `sessionName` 改名参数采用同一上限，成员校验规则保持不变。
- `goal` 为选填工作目标，可省略、传 `null`、空字符串或纯空白；有值时最多 500 字符。
- 默认空间和租户空间均将目标去除首尾空白，空目标按未设置项目描述处理。
- 租户 Node 创建命令在目标为空时发送 `sessionContent: ""`，不自动补入模板目标或占位文案。

回归用例：`GroupChatCreationAndInvitationTest` 覆盖入参校验、500/501 字符边界及默认空间创建；
`TenantGroupCreationGoalTest` 覆盖无目标时的租户项目创建和 Node 命令。
本次未运行测试、编译或构建。

工作组改名的业务层校验及租户 Node 创建、改名、名称可用性检查均执行 50 字符上限；
个人群昵称仍保留原有的 100 字符上限。中文普通字符与英文字母均按一个字符计算。
