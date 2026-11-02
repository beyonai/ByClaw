# API 与现有脚本契约

本参考提供平台请求契约和随附脚本调用方式。实际返回与本文不符时，通过当前平台接口说明、工具元数据或只读查询核实；未知结构不按成功处理，不要求沙箱读取平台源码。

## 身份与路径

| 字段/变量 | 含义 |
|---|---|
| employee_id | 数字员工资源 ID；upload/list/check/resourceize/delete 的 resourceId |
| skill_id | 技能资源 ID；used-by/grant/members 的 resourceId |
| user_code | 用户编码，限定用户工作区；不是 userId |
| user_id | 授权对象 ID，grantToObjId；不是数字员工 ID |
| skillPath | API 返回的用户文件系统对象路径；不是当然可直接操作的容器绝对路径 |
| SKILL_ROOT | 当前加载的管理技能目录；不是待发布的源码目录 |

ID 可能以 JSON 字符串返回，保留原始值并按接口要求转换；不要经过 JavaScript 浮点数造成长整型精度丢失。

## 客户端初始化

从当前技能根下的 scripts 导入。平台 Token 来自当前身份的可信运行时注入：客户端默认读取 `BEYOND_TOKEN`，也接受由受支持解析机制取得的 `token` 参数；秘密仅在进程内传递，不写入示例或命令行。SDK 自动设置 `Beyond-Token`。

```python
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ['SKILL_ROOT']) / 'scripts'))
from byclaw_skill_api import ByClawSkillAPI
api = ByClawSkillAPI()  # 默认 Redis 发现 ByaiService
```

`SKILL_ROOT` 是 Agent 根据已加载文件设置的执行变量，不是平台保证注入的变量。已核实启动器注入的 `BYAI_SERVICE_BASE_URL` 时，可以显式传 `base_url`；客户端不会自动读取此变量。显式地址须验证来源和 `/byaiService` 前缀，不能让待发布 Skill 中的不可信 URL 接收认证 Header。这里的变量仅适用于已提供它的部署，不要求任何 harness 必须注入它。

### 服务发现的实际配置规则

| 变量 | 当前客户端行为 |
|---|---|
| REDIS_MODE | 显式模式优先；应核实为 standalone/cluster |
| REDIS_CLUSTER_HOST | 未显式设置模式且非空时用 cluster；逗号分隔 host:port |
| REDIS_HOST / REDIS_PORT | standalone；代码默认 localhost/6379，不代表部署地址 |
| REDIS_DATABASE / REDIS_DB | standalone，前者优先，最终默认 0 |
| REDIS_USERNAME / REDIS_PASSWORD | 按可信配置传入；用户名没有硬编码为 default |
| REDIS_KEY_SCHEMA_VERSION | v1/v2；未设置时按 REDIS_CLUSTER_HOST 是否非空选择 v2/v1，与模式判断独立 |

服务名为 ByaiService；v1 使用 `byai_gateway:sd:active:ByaiService` 和 `byai_gateway:sd:instances:ByaiService`，v2 使用 `byai_gateway:v2:sd:{ByaiService}:active` 和 `byai_gateway:v2:sd:{ByaiService}:instances`。脚本以 30 秒心跳阈值筛选、缓存 5 秒，不需要扫描全库。

默认发现分支会补全缺失的 `/byaiService` 前缀，显式 base_url 分支不会补全。当前 Redis 初始化没有 socket timeout，探测需由外层执行工具设置截止时间；不要将内部地址或凭据原样输出。一般环境发现见 [个人沙箱环境](container-environment.md)。

## 方法速查

| Python 方法 | 真实接口/关键语义 |
|---|---|
| upload_skill_zip(zip_path, resource_id=None, user_code=None) | POST /tool/uploadSkillZip，multipart file；当前后端会注册与绑定 |
| list_workspace_skills(resource_id, user_code=None, keyword=None) | POST /tool/qryWorkspaceSkillList，只查未绑定目录 |
| check_resourceize_conflicts(skill_path, resource_id, user_code=None) | POST /tool/checkWorkspaceSkillShareConflicts，data.items/updatedCount/failed |
| resourceize_skill(skill_path, resource_id, user_code=None, overwrite_confirmed=False) | POST /tool/resourceizeWorkspaceSkill，结果 ID 在 data.items |
| get_skill_used_by(skill_id) | POST /tool/querySkillUsedDigitalEmployees |
| delete_workspace_skill(skill_path, resource_id, user_code=None) | POST /tool/deleteSkill，只代表工作区目录删除 |
| grant_skill_to_users(resource_id, grant_users=None, revoke_users=None, org_id=None) | POST /auth/privilegeGrant/setResourceUsers，redList/blackList 差异 |
| query_skill_members(resource_id, page_no=1, page_size=20) | POST /auth/privilegeGrant/queryResourceMembers，pageNo |

## 平台资源发现与技能查重

`POST /auth/privilegeGrant/listResourceUseAuth`，相对于带 `/byaiService` 的 base_url。用于查找 SKILL、TOOL、TOOLKIT、MCP 等资源候选，不能用某员工的工作区文件列表替代。当前 ByClawSkillAPI 没有专用封装；直接复用已认证 Session，不依赖另一技能的私有脚本，也不改用数字员工 discover 接口。

| 请求字段 | 契约与用法 |
|---|---|
| resourceBizTypeList | 字符串数组，例如 `["SKILL"]`、`["TOOL", "TOOLKIT", "MCP"]`；按业务所需类型显式传入 |
| pageNum / pageSize | 页码与每页条数，后端默认 1/10；这里是 pageNum，不是成员查询的 pageNo |
| keyword | 单独查 SKILL 时匹配编码或名称；其他类型组合匹配名称或描述。SQL LIKE 模糊匹配，不是语义搜索；必要时换业务同义词或扩大候选范围 |
| ownerType | 可选 personal/enterprise；企业 SKILL 等类型可进入企业全量资源口径，不能据返回结果推定已有使用权限 |
| permission | CREATED_BY_ME、AUTHORIZED_TO_ME、PENDING_MY_APPROVAL、APPLIED_BY_ME；不筛选时省略，不将 ALL 当作正式枚举 |
| resourceStatus | 字符串；省略默认已上架，空字符串为全部状态，指定值按后端过滤；全部状态结果不能直接当可用候选 |
| systemCodes / catalogId | 可选来源系统数组、目录 ID；目录及子目录展开由后端完成 |
| belong / orgFilters | 企业归属筛选；只在明确需要对应范围且已核实组织标识时传入 |

用户、组织、岗位权限上下文和默认资源范围由后端填充；不要手填 `userId`、`platformManager`、`catalogIds` 或 `includeAllEnterpriseOwnerType` 等内部字段扩大范围。

单页查询示例（实际关键词与类型由当前需求确定）：

```python
response = api.session.post(
    api.base_url.rstrip('/') + '/auth/privilegeGrant/listResourceUseAuth',
    json={'resourceBizTypeList': ['SKILL'], 'keyword': keyword,
          'pageNum': 1, 'pageSize': 50},
    timeout=30,
)
response.raise_for_status()
result = api._handle_response(response)
page = result.get('data')
if not isinstance(page, dict) or not isinstance(page.get('list'), list):
    raise ValueError('资源发现返回结构不符合契约')
# page 包含 pageNum、pageSize、total、totalPages、list；不要打印完整响应。
```

查全时逐页读取至实际 totalPages/结束条件，保留分页信息并按 resourceId 去重。对缺少分页字段、重复页或异常空页报告结果不完整，不以默认零或首屏列表宣称全部查询完成。不要再用本地字面关键词过滤改变 SQL LIKE 返回语义；相似性由 Agent 根据候选用途判断。

条目包含 resourceId、resourceBizType、resourceCode、resourceName、resourceDesc 等，SKILL 还可能含版本、包路径与同步信息。只展示推荐所需字段，选定后通过资源详情与权限能力确认调用契约。当前查询链路未计算 hasPermission，该布尔字段可能只是默认 false；不能据它判无权，也不能反向承诺可挂载或可调用。

## 单个技能的员工绑定与解绑

平台提供以下已核实接口，均相对于带 `/byaiService` 的 base_url：

- `POST /digitalEmployeeController/installRelResources`
- `POST /digitalEmployeeController/uninstallRelResources`

请求体为 `{"digitalEmployeeId": 实际员工ID, "relIds": [实际技能资源ID]}`。本技能仅向 relIds 提交用户指定的技能资源；不混入其他关联资源。返回为员工详情，不能按自造的 installed/removed 计数读取。写后使用技能使用者查询等方式核对实际关系。

现有 Python 类没有这两个端点的专用方法。使用已初始化 API 的 Session 按下列方式调用已核实的单技能接口；不得调用全量员工更新接口重建关系来替代增量绑定。

```python
response = api.session.post(
    api.base_url.rstrip('/') + '/digitalEmployeeController/installRelResources',
    json={'digitalEmployeeId': employee_id, 'relIds': [skill_id]}, timeout=30,
)
response.raise_for_status()
result = api._handle_response(response)
```

卸载时使用对应 uninstallRelResources 路径及同样的身份字段，先按 [卸载流程](uninstallation.md) 核实影响和授权。该接口可能保留其他有效来源的关联；不能把请求成功当成目标关系必定消失。平台未开放或权限不足时报告实际限制，不编造 SDK 方法或其他写入路径。

## 员工工作区完整文件列表：受控补充

现有 API 类没有完整列表方法。可复用该类已认证 Session 和统一响应处理调用已核实的只读端点；这不同于建立另一套认证客户端。下面 employee_id 必须是已核实的目标，按需增加经过确认的 userCode。

```python
response = api.session.post(
    api.base_url.rstrip('/') + '/tool/qrySkillListByUserCode',
    json={'resourceId': employee_id}, timeout=30,
)
response.raise_for_status()
result = api._handle_response(response)
# 检查 data 的类型，再按真实 skillName/skillPath 精确匹配。
```

此接口当前实现仅支持 MinIO 模式。无法使用时报告限制，并使用平台已有的受支持查询入口，不直接查库补 ID。其他 SDK 未覆盖的接口也须先核实契约再调用，不从名称猜测端点。

## 可用 CLI

路径均相对于 `SKILL_ROOT/scripts/`；实际参数值替换尖括号说明。

```text
skill_package.py <skill-dir> [output.zip]
skill_grant.py <skill-id> <user-id> <user-name> [--org-id <id>]
skill_revoke.py <skill-id> <user-id>
skill_members.py <skill-id> [--page <n>] [--size <n>]
skill_used_by.py <skill-id>
skill_delete.py <skill-path> <employee-id> [--user-code <code>]
```

删除脚本有 stdin 确认，非交互 Agent 可在同一目标与范围已经获准后调用 API 方法；不得用 `yes | ...` 自动批准未知范围。旧 `skill_publish.py` 的限制见发布参考。

## 响应与重试

客户端要求 code 为字符串 "0" 或整数 0，HTTP 层先 raise_for_status；业务错误封装为 ByClawSkillAPIError。requests 的连接、超时和 HTTP 异常不会自动变成该错误类型。不要从 code 或异常推测整个操作已回滚。

查询分页遵循实际结构和 total/结束条件；用户要求查全时自动翻页、去重，记录已查范围。缺失 total/list 或计数字段时不要用默认 0 宣称“没有记录”。写请求没有统一幂等键保障，结果不明先回读。

## 现有脚本的执行限制

- 旧发布脚本的组合流程和覆盖时机不适合作为当前后端默认入口，按 [发布流程](publishing.md) 分步执行。
- 打包脚本未拒绝源内输出或文件符号链接；调用前须按发布参考核实输出在源码外、链接内容未越界，不能把脚本返回成功当作包安全检查。
- 部分 CLI 在异常时打印原始响应/异常文本，成员和使用者 CLI 还会把部分缺失字段视为空。需要脱敏输出或严格判断时，用受控 Session/API 调用并检查真实结构，避免原始响应进入对话；CLI 汇总不能代替回读证据。这些是实现待修项，不是已由文档修复的能力。
