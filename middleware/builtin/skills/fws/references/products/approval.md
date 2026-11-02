# 审批

用于飞书审批：审批定义、审批实例、待办/已办、同意、拒绝、转交、退回、撤回、加签、催办、抄送。

## 路由优先级

只要核心对象是审批单据、审批实例或审批待办，就走 `approval`，不要走 `task`。

## 身份选择

审批是人的动作，默认 `--as user`。

## 常用命令

```bash
# 搜索可发起审批定义
lark-cli approval approvals search --data '{"keyword":"请假"}' --as user --format json

# 查看审批定义
lark-cli approval approvals get --params '{"approval_code":"<approval_code>"}' --as user --format json

# 查询待办；topic 具体取值以 schema/help 为准
lark-cli approval tasks query --params '{"topic":"1"}' --as user --format json

# 同意审批
lark-cli approval tasks approve --data '{"instance_code":"<instance_code>","task_id":"<task_id>","comment":"同意"}' --as user --format json
```

## 工作流

发起审批：
1. `approvals search` 找审批定义。
2. `approvals get` 查看表单和流程。
3. 构造表单 JSON 后 `instances create`。

处理审批：
1. `tasks query` 获取 `instance_code` + `task_id`。
2. 如需要再 `instances get` 查看详情。
3. 用户确认后执行 approve/reject/transfer/rollback/cancel 等动作。

## 危险操作

同意、拒绝、转交、退回、撤回、加签、催办都会改变流程状态。执行前向用户确认，尤其是拒绝和撤回。

写操作失败后不要盲目重试；任务可能已被他人处理或状态变化。最多补查一次状态。
