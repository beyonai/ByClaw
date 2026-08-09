# 项目会话高级搜索接口

## `POST /byaiService/project/session/listByQo`

按当前选定项目分页查询会话。原有的项目、当前登录用户和运营会话过滤规则保持不变；新增 `searchMode` 后，可将关键词用于数字员工或完整聊天内容搜索。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | number | 是 | 当前项目 ID |
| `pageNum` | number | 否 | 页码，默认沿用分页组件配置 |
| `pageSize` | number | 否 | 每页条数，前端默认 30 |
| `keyword` | string | 否 | 搜索关键字；空值时返回项目全部会话 |
| `searchMode` | string | 否 | `DIGITAL_EMPLOYEE` 或 `CHAT_CONTENT`；未传时保持原有“会话标题、摘要”搜索 |

### `DIGITAL_EMPLOYEE`

关键字忽略大小写匹配数字员工的 `resource_name`、`resource_desc`。若会话的主对象是该员工，或会话成员表中存在该员工（`mem_obj_type=AGENT`），则返回该会话。不会返回员工列表。

会话项额外返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `matchType` | string | 固定为 `DIGITAL_EMPLOYEE` |
| `matchedEmployeeId` | string | 命中的数字员工 ID |
| `matchedEmployeeName` | string | 命中的数字员工名称 |
| `matchedEmployeeMatchField` | string | 实际命中的字段：`NAME`（名称）或 `DESCRIPTION`（描述） |
| `matchedEmployeeMatchText` | string | 实际命中的名称或描述片段；描述最多返回 160 个字符并围绕关键词截断，用于侧栏展示命中依据 |

### `CHAT_CONTENT`

关键字忽略大小写匹配会话中全部可见消息正文：`archived_at IS NULL`、`usage IN (1, 2)` 且 `message_content` 非空。会话摘要不参与该模式的匹配。

会话项额外返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `matchType` | string | 固定为 `CHAT_CONTENT` |
| `matchText` | string | 一条命中消息的截断片段，用于侧栏展示命中依据 |

新模式按字面量包含匹配；`%`、`_` 与 `\\` 不会被当作 SQL 通配符。结果排序保持 `COALESCE(update_time, create_time) DESC, create_time DESC`。

请求示例：

```json
{
  "projectId": 10001,
  "pageNum": 1,
  "pageSize": 30,
  "keyword": "合同",
  "searchMode": "CHAT_CONTENT"
}
```
