# 对话记录搜索技能

技能目录：`middleware/openclaw/skills/conversation-search/`。随 OpenClaw 镜像的技能目录发布，也可将该目录打成技能包，按已有技能安装流程绑定数字员工。运行环境需要已安装的 `callcli` Python 包、`by_framework` 服务发现及平台注入的当前用户 `Beyond-Token` / `BEYOND_TOKEN`。服务名称沿用 `CALLCLI_RESOURCE_SERVICE`，缺省使用 `BE_DOMAINNAME`。

## 配置使用人员

在系统参数配置表 `byai_system_config` 中维护唯一一条参数：

| 字段 | 值 |
| --- | --- |
| `param_code` | `CONVERSATION_SEARCH_ALLOWED_USER_CODES` |
| `param_name` | 对话记录搜索技能允许使用的用户编码 |
| `param_type` | `json` |
| `param_value` | `["user001","user002"]`（替换为实际用户编码） |

值必须是 JSON 字符串数组，精确匹配用户编码、区分大小写，成员首尾空白会被去除。不支持角色、数字员工、通配符或逗号分隔文本。缺失、空数组、错误格式、非字符串成员、空成员、`*` 或重复参数记录均拒绝访问。每页查询直接读取数据库，删除用户或清空配置后下一次调用立即生效，数据库不可用时也不会放行。

无需新增表或预置数据迁移；由管理员在参数配置界面维护该条记录。本改动不修改初始化 SQL。

## API

`POST /byaiService/skills/conversation-search/query`

必须提供当前用户的 `Beyond-Token`，不接受 Cookie、请求体 `userCode`、`X-User-Id` 或数字员工所有者作为调用身份。该精确 POST 路径仅豁免门户通用签名，仍强制令牌认证，且校验早于可配置的匿名 URL 规则。白名单检查在查询服务入口执行，平台管理员、员工管理人或拥有员工使用授权的其他人也没有豁免。

```json
{
  "userCode": "user001",
  "digitalEmployeeId": 12345,
  "startTime": "2026-09-01 00:00:00",
  "endTime": "2026-09-29 23:59:59",
  "keyword": "预算",
  "pageNum": 1,
  "pageSize": 20
}
```

全部筛选参数可省略，组合时使用 AND；`{}` 搜索全量记录的第一页。`userCode` 筛选提问人为该编码的记录（包含停用用户的历史记录），编码不存在返回空页，不会去掉过滤条件扩大范围。`digitalEmployeeId` 精确匹配回复对象为 `AGENT` 的数字员工 ID。

时间依据 `ask_time`，格式 `yyyy-MM-dd HH:mm:ss`，采用平台保存的本地时间语义；起止均为包含边界，可只给开始或结束。起止倒置返回 400。`keyword` 在提问或回复内容中做区分大小写的字面子串匹配，SQL 通配字符 `%`、`_`、`\` 被转义。空白字符串不视为无条件搜索，返回 400。用户编码最多 128 字符，关键字最多 1000 字符。

页码从 1 开始，默认每页 20 条，上限 100 条；按提问时间倒序，同时间按记录 ID 倒序。正常返回 `{ "code": 0, "data": { "list": [], "total": 0, "pageNum": 1, "pageSize": 20, "totalPages": 0 } }`，记录含问答正文、提问/回复对象类型和 ID、时间、会话 ID、消息 ID 等。身份认证失败返回 401，白名单拒绝返回 403。

查询复用后台对话记录的数据源 `byai_message_relobj`，范围不受当前数字员工授权限制；不包含尚未写入该表的流式临时消息或外部聊天文件。翻页是实时查询，新增或删除记录时总数可能变化。

## 验证

```bash
mvn -B -f byclaw-be/pom.xml verify
python3 -m unittest discover -s middleware/openclaw/skills/conversation-search/tests -v
```

部署联调时用两个真实用户：名单内用户能跨用户/员工搜索；同一数字员工授权给名单外用户后仍返回 403。再删除名单内用户的配置，下一页请求也应拒绝。技能仅在当前用户的沙箱运行，凭据不得配置为数字员工所有者的固定令牌。
