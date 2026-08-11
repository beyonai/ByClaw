---
name: knowledge-organizer-init
description: 初始化新的知识整理任务并获取授权对象范围。适用于登记文件、发现文档对象或丰富对象知识之前的新任务初始化。
allowed-tools: read, exec
---

# 初始化知识整理任务

## 准备

- 必须从当前上下文取得会话 ID。
- 选择一个能体现用户业务目标的新任务目录路径，目录交给 CLI 创建。
- 只根据**当前用户输入是否标识为后台任务**选择权限范围：
  - 当前输入明确描述为后台、定时、异步或运营任务，或包含除会话 ID 外的任务 ID 时，使用会话共享范围，不传 `--digital-employee-resource-id`。
  - 普通交互请求使用数字员工权限范围，传入 `--digital-employee-resource-id`。
- 上下文中是否存在数字员工资源 ID 不能用来判断任务类型。后台任务即使能够取得该 ID 也不要传入；普通交互请求缺少该 ID 时，把它作为初始化所需的关键输入向用户确认。
- 后台任务的会话共享范围初始化失败时，停止并汇报；不得改传 `--digital-employee-resource-id`，也不得切换到数字员工权限范围重试。
- 后台任务初始化失败时，使用 `knowledge-organizer-update-task-status` 将状态设置为 `failed`。初始化成功时不要更新任务状态，继续执行本轮已授权的目标操作。

## 执行

后台任务使用会话共享范围：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py init \
  --task-dir "<任务目录>" \
  --session-id "<会话ID>"
```

普通交互任务使用数字员工权限范围：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py init \
  --task-dir "<任务目录>" \
  --session-id "<会话ID>" \
  --digital-employee-resource-id "<数字员工资源ID>"
```

## 完成标准

只有命令执行成功并返回至少一个授权对象时，才算初始化完成。随后分别读取 `objects/ods/` 和 `objects/ads/` 下生成的对象定义，保留任务目录供后续操作使用，并按 ODS、ADS 汇总可用对象名称和编码。

如果目录已经初始化，直接沿用，不要再次执行 `init`。
