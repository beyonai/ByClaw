# 执行说明

所有示例从 Skill 根目录执行。依赖安装：

```bash
python -m pip install -r scripts/requirements.txt
```

## 只读发现

```bash
python scripts/cron_schedule.py list --keyword 晨报
python scripts/cron_schedule.py list --source-id 123456
python scripts/cron_schedule.py runs --status failed --keyword 晨报
python scripts/cron_schedule.py employees --keyword 运营
python scripts/cron_schedule.py projects --keyword 默认项目
```

`list` 始终提交 `onlyMine=true` 并过滤 `sourceType=chat`。`employees` 只返回当前身份可发现且已上架的数字员工。

## 写操作

将请求保存到当前工作区的临时 JSON 文件。请求文件不包含 Token。

```bash
python scripts/cron_schedule.py plan --request /path/request.json
python scripts/cron_schedule.py apply --request /path/request.json --accept-plan <planHash>
```

不要手工修改 plan 输出后继续使用旧 hash。请求或远端目标状态变化时重新 plan。

### 创建

```json
{
  "action": "create",
  "name": "工作日晨报",
  "prompt": "汇总昨日重点并给出今日建议",
  "employeeId": "20001",
  "employeeName": "运营助手",
  "projectId": "10001",
  "schedule": {
    "mode": "periodic",
    "periodType": "weekly",
    "time": "09:00",
    "weekdays": [1, 2, 3, 4, 5]
  }
}
```

`projectId` 和 `employeeName` 可省略，`employeeId` 不可省略。提示词不需要手工添加 `@员工名`；员工身份由 `resourceList` 承载。若希望文本中也可读，可自行包含 `@名称`，但不能用文本替代 employeeId。

`projectId=-1` 是页面侧的“无项目”占位值，不是 API 接受的项目 ID。脚本会把它视为未指定并从请求 payload 中移除；新请求应优先直接省略 `projectId`。

`prompt` 只描述数字员工每次被触发时要完成的业务动作，执行频率只放在 `schedule`。例如应写“统计并汇报 open、closed issue 数量及摘要”，不要追加“每间隔 60 分钟执行一次”；后者可能被数字员工理解为创建新定时任务。脚本会拦截明显的调度指令。只有业务目标本身确实是管理定时任务时，才可在用户明确确认后增加：

```json
{"allowScheduleDirectiveInPrompt": true}
```

脚本默认阻止创建当前用户已有的同名 chat 任务。用户明确要求重名时，可增加 `"allowDuplicateName": true`；计划会列出当前同名任务 ID。

### 写操作确认门

`create`、`update`、`pause`、`resume`、`delete` 和 `run` 均执行同一确认流程。`plan` 只做只读发现，并返回 `confirmation.summary`、`confirmation.constraints` 和 `planHash`。

必须完整展示摘要、操作约束和 hash。创建/修改摘要包含提示词、员工、项目、schedule 与 Cron；其他操作包含目标任务、目标状态或即时执行/删除语义。

展示后结束当前轮次，不得自动继续。只有用户在后续消息中明确确认当前计划，才执行：

```bash
python scripts/cron_schedule.py apply --request /path/request.json --accept-plan <planHash> --confirmed-by-user
```

`--confirmed-by-user` 是所有写操作的强制门禁，只能在收到确认后使用。若 `planHash` 失效，先重新 plan、重新展示并再次确认；先前确认不适用于新计划。只读查询不需要确认。

### 修改

```json
{
  "action": "update",
  "sourceId": "123456",
  "name": "晨报与风险提醒",
  "prompt": "汇总昨日重点，突出风险",
  "schedule": {
    "mode": "periodic",
    "periodType": "daily",
    "time": "08:30"
  }
}
```

只填写需要修改的字段。`employeeId` 与 `employeeName` 必须一起按目标员工重新解析；脚本会保留原 `resourceList` 中其他引用，只替换承接数字员工。

修改已有任务时同样检查最终提示词。若旧提示词包含调度指令，先通过 `prompt` 清理，再执行更新；不要用覆盖开关绕过历史问题。

### 暂停、恢复、删除和立即运行

```json
{"action":"pause","sourceId":"123456"}
```

```json
{"action":"resume","sourceId":"123456"}
```

```json
{"action":"delete","sourceId":"123456"}
```

```json
{"action":"run","sourceId":"123456"}
```

## schedule 格式

### 周期

```json
{"mode":"periodic","periodType":"daily","time":"09:00"}
```

```json
{"mode":"periodic","periodType":"weekly","time":"09:00","weekdays":[1,3,5]}
```

```json
{"mode":"periodic","periodType":"biweekly","time":"09:00","weekdays":[1,3,5]}
```

```json
{"mode":"periodic","periodType":"monthly","time":"09:00","monthDays":[1,15,31]}
```

```json
{"mode":"periodic","periodType":"yearly","time":"09:00","month":10,"monthDay":1}
```

### 间隔

```json
{"mode":"interval","intervalValue":1.5,"intervalUnit":"hour","intervalWeekdays":[1,2,3,4,5]}
```

```json
{"mode":"interval","intervalValue":90,"intervalUnit":"minute","intervalWeekdays":[1,2,3,4,5,6,7]}
```

### 单次

```json
{"mode":"once","onceTime":"2026-10-01 09:00:00"}
```

时间按 BE 进程系统时区解释。当前页面任务没有独立时区字段。

## 结果处理

- `plan`：只读，输出规范化目标和 `planHash`。
- `apply` 的 `status=verified`：API 写入后回读一致。
- `status=dispatched`：立即运行接口成功，并返回匹配的最新运行记录；记录仍可能只代表会话下发。
- `status=unknown`：写入结果无法唯一证明，不要重复 apply；先按返回的 reconciliation 信息人工核对。
- `status=blocked`：输入、权限、身份或当前状态不满足，未执行写入。
