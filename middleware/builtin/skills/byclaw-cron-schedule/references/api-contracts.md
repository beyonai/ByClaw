# API 契约

## 连接与认证

- `BYAI_SERVICE_BASE_URL`：完整 ByClaw 服务前缀，例如 `https://host/byaiService`。脚本保留现有路径前缀，不自行拼接第二个 `/byaiService`。
- `BEYOND_TOKEN`：当前执行 Agent 的受信认证，由运行时注入。
- 请求 Header：`Beyond-Token`。
- 不把 Token 写入请求文件、日志、计划或错误信息。

统一响应：

```json
{"code":0,"msg":"Operation successful","data":{}}
```

HTTP 非 2xx、业务 `code!=0`、重定向、非 JSON 或结构不完整均视为失败。写请求出现传输/JSON 失败时，结果可能未知。

## 业务接口

| 目的 | 方法与路径 | 请求关键字段 |
|---|---|---|
| 列任务 | `POST /devloop/source/list` | `onlyMine=true,pageNum,pageSize,keyword?,projectId?` |
| 创建 | `POST /devloop/source/create` | `sourceName,sourceType=chat,config,cronExpr,projectId?` |
| 修改 | `POST /devloop/source/update` | `sourceId,sourceName,config,cronExpr` |
| 删除 | `POST /devloop/source/delete` | `sourceId` |
| 启停 | `POST /devloop/source/toggle` | `sourceId,enabled=0/1` |
| 立即运行 | `POST /devloop/source/scan` | `sourceId` |
| 运行记录 | `POST /devloop/automation/run/list` | `status?,keyword?,pageNum,pageSize` |
| 项目发现 | `POST /project/list` | `keyword?,pageNum,pageSize` |
| 员工发现 | `POST /api/v2/digitEmploy/discover` | `resourceStatus=2,pageNum,pageSize` |

所有路径相对于 `BYAI_SERVICE_BASE_URL`。

`projectId` 仅在选定真实项目时发送。`-1` 是前端“无项目”占位值，后端不接受；脚本将整数或字符串 `-1` 规范化为字段缺省。

## config

创建和修改的 `config` 是 JSON 字符串：

```json
{
  "chatContent": "任务提示词",
  "resourceList": [
    {
      "id": "DIG_EMPLOYEE_20001",
      "resourceId": "20001",
      "resourceName": "运营助手",
      "resourceType": "DIG_EMPLOYEE"
    }
  ],
  "schedule": {
    "mode": "periodic",
    "periodType": "daily",
    "time": "09:00"
  }
}
```

BE 从 `resourceList` 末尾向前取第一个 `resourceType=DIG_EMPLOYEE` 且 `resourceId` 为整数的对象作为承接员工。

`chatContent` 是每次触发后交给数字员工执行的提示词，不是调度配置。周期、时间和频率只能由 `schedule` 与 `cronExpr` 表达；把调度语句写入 `chatContent` 可能使员工再次创建定时任务。脚本默认拦截明显的调度指令，显式覆盖仅适用于业务本身需要管理日程的场景。

## 权限和副作用

- 创建、修改、启停、删除和立即运行都是外部写操作。调用前必须展示脚本生成的确认摘要、约束和 `planHash`，并获得用户对该计划的明确确认；计划变化后重新确认。
- 列表与运行记录按当前登录身份查询；脚本额外限制为当前用户的 chat 任务。
- 更新、删除在 BE 校验创建者。
- 当前 BE 的启停和立即运行接口未见同等创建者校验；脚本必须先从 `onlyMine=true` 列表证明目标归属，不能直接对任意 ID 写入。
- 立即运行绕过启用状态、Cron 到期判断和调度锁。
- 删除为软删除，但没有面向该页面的恢复接口。
- `source/scan` 对 chat 返回 `createdCount=0` 是正常结果。
- 运行记录 `success` 表示已创建会话并提交异步聊天，不表示模型完成。

## 回读

- 创建：按返回 `sourceId` 在 `onlyMine=true` 列表中定位并比较名称、Cron、config、enabled。
- 修改/启停：同上。
- 删除：确认该 ID 不再出现在列表。
- 立即运行：记录调用前时间；调用后查询当前用户运行记录并寻找同一 `sourceId` 的最新记录。未找到时只报告 API 已接受，不推断模型状态。

接口没有幂等键。创建或立即运行发生结果未知时不得自动重试，否则可能生成重复任务或重复会话。
