# DataCloud 数字员工资源权限与绑定开放接口

本文档描述百应侧提供给下游系统 `byclaw-datacloud` 调用的数字员工资源权限校验与资源绑定接口。

## 1. 接口概览

| 序号 | 接口名称 | Method | Path | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 校验数字员工管理权限 | POST | `/open/api/v1/checkDigEmployeeManagePermission` | 批量查询当前登录用户是否拥有指定数字员工的管理权限 |
| 2 | 校验资源使用权限 | POST | `/open/api/v1/checkResourceUsePermission` | 批量查询当前登录用户是否拥有指定资源的使用权限 |
| 3 | 绑定资源到数字员工 | POST | `/open/api/v1/mountDigEmployeeResource` | 给指定数字员工绑定指定资源，并同步数字员工配置 |

## 2. 公共约定

### 2.1 认证方式

接口沿用百应开放接口的统一鉴权机制。下游调用时需携带有效登录态或网关认可的认证凭证，例如：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

权限判断均基于当前登录用户。

### 2.2 公共响应结构

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | integer | 是 | 响应码。`0` 表示成功，非 `0` 表示失败 |
| `msg` | string | 是 | 响应消息 |
| `data` | object/null | 否 | 业务数据。不同接口结构不同 |

### 2.3 资源标识说明

| 字段 | 说明 |
| --- | --- |
| `agentId` | 数字员工资源 ID，对应 `ss_resource.resource_id`，且资源业务类型应为 `DIG_EMPLOYEE` |
| `resourceId` / `relResourceId` | 被校验或被绑定资源的资源 ID，对应 `ss_resource.resource_id` |
| `resourceCode` / `relResourceCode` | 被校验或被绑定资源的资源编码，对应 `ss_resource.resource_code` |

## 3. 校验数字员工管理权限

### 3.1 接口信息

```http
POST /open/api/v1/checkDigEmployeeManagePermission
```

用于批量查询当前登录用户是否拥有指定数字员工的管理权限。

### 3.2 请求参数

```json
{
  "agentIds": [123456789, 987654321]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agentIds` | array<long> | 是 | 数字员工资源 ID 列表 |

### 3.3 响应参数

`data` 结构如下：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `allPermitted` | boolean | 是 | 是否全部拥有管理权限 |
| `items` | array<object> | 是 | 单个数字员工的权限校验结果 |

`items` 对象结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | long | 否 | 资源 ID |
| `resourceCode` | string | 否 | 资源编码 |
| `resourceName` | string | 否 | 资源名称 |
| `resourceBizType` | string | 否 | 资源业务类型 |
| `exists` | boolean | 是 | 资源是否存在 |
| `hasPermission` | boolean | 是 | 当前用户是否拥有管理权限 |
| `message` | string | 否 | 无权限或异常原因 |

### 3.4 响应示例

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {
    "allPermitted": false,
    "items": [
      {
        "resourceId": 123456789,
        "resourceCode": "agent_xiaodi",
        "resourceName": "小迪助手",
        "resourceBizType": "DIG_EMPLOYEE",
        "exists": true,
        "hasPermission": true,
        "message": null
      },
      {
        "resourceId": 987654321,
        "resourceCode": "agent_test",
        "resourceName": "测试员工",
        "resourceBizType": "DIG_EMPLOYEE",
        "exists": true,
        "hasPermission": false,
        "message": "当前用户非平台管理员或者组织管理员"
      }
    ]
  }
}
```

### 3.5 curl 示例

```bash
curl -X POST "$BASE_URL/open/api/v1/checkDigEmployeeManagePermission" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "agentIds": [123456789, 987654321]
  }'
```

## 4. 校验资源使用权限

### 4.1 接口信息

```http
POST /open/api/v1/checkResourceUsePermission
```

用于批量查询当前登录用户是否拥有指定资源的使用权限。

### 4.2 请求参数

```json
{
  "resourceIds": [111111, 222222],
  "resourceCodes": ["resource_code_a", "resource_code_b"]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceIds` | array<long> | 条件必填 | 资源 ID 列表。与 `resourceCodes` 至少传一个 |
| `resourceCodes` | array<string> | 条件必填 | 资源编码列表。与 `resourceIds` 至少传一个 |

说明：

- 仅传 `resourceIds` 时，按资源 ID 批量校验。
- 仅传 `resourceCodes` 时，按资源编码批量校验。
- 同时传 `resourceIds` 和 `resourceCodes` 时，会分别按两组标识进行校验，并合并返回结果。
- 如果同一资源同时出现在 `resourceIds` 和 `resourceCodes` 中，当前接口不做去重，下游可按需去重展示。

### 4.3 响应参数

`data` 结构如下：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `allPermitted` | boolean | 是 | 是否全部拥有使用权限 |
| `items` | array<object> | 是 | 单个资源的权限校验结果 |

`items` 对象结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | long | 否 | 资源 ID |
| `resourceCode` | string | 否 | 资源编码 |
| `resourceName` | string | 否 | 资源名称 |
| `resourceBizType` | string | 否 | 资源业务类型 |
| `exists` | boolean | 是 | 资源是否存在 |
| `hasPermission` | boolean | 是 | 当前用户是否拥有使用权限 |
| `message` | string | 否 | 无权限或异常原因 |

### 4.4 响应示例

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {
    "allPermitted": false,
    "items": [
      {
        "resourceId": 111111,
        "resourceCode": "resource_code_a",
        "resourceName": "企业本体库",
        "resourceBizType": "ONTOLOGY_BASE",
        "exists": true,
        "hasPermission": true,
        "message": null
      },
      {
        "resourceId": 222222,
        "resourceCode": "resource_code_b",
        "resourceName": "客户信息表",
        "resourceBizType": "OBJECT",
        "exists": true,
        "hasPermission": false,
        "message": "当前用户无资源使用权限"
      },
      {
        "resourceId": null,
        "resourceCode": "not_exist_code",
        "resourceName": null,
        "resourceBizType": null,
        "exists": false,
        "hasPermission": false,
        "message": "资源不存在"
      }
    ]
  }
}
```

### 4.5 curl 示例

```bash
curl -X POST "$BASE_URL/open/api/v1/checkResourceUsePermission" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "resourceIds": [111111, 222222],
    "resourceCodes": ["resource_code_a", "resource_code_b"]
  }'
```

## 5. 绑定资源到数字员工

### 5.1 接口信息

```http
POST /open/api/v1/mountDigEmployeeResource
```

用于给指定数字员工绑定指定资源。

该接口会同时进行权限校验：

- 当前用户必须拥有该数字员工的管理权限。
- 当前用户必须拥有待绑定资源的使用权限。

绑定成功后，会触发数字员工配置同步。

### 5.2 请求参数

按资源 ID 绑定：

```json
{
  "agentId": 123456789,
  "relResourceId": 111111
}
```

按资源编码绑定：

```json
{
  "agentId": 123456789,
  "relResourceCode": "resource_code_a"
}
```

同时传资源 ID 与资源编码：

```json
{
  "agentId": 123456789,
  "relResourceId": 111111,
  "relResourceCode": "resource_code_a"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agentId` | long | 是 | 数字员工资源 ID |
| `relResourceId` | long | 条件必填 | 待绑定资源 ID。与 `relResourceCode` 至少传一个 |
| `relResourceCode` | string | 条件必填 | 待绑定资源编码。与 `relResourceId` 至少传一个 |

说明：

- `relResourceId` 与 `relResourceCode` 可以任选其一。
- 如果同时传 `relResourceId` 与 `relResourceCode`，二者必须指向同一个资源，否则会被视为资源不存在。
- 如果资源已经绑定到该数字员工，接口按幂等成功处理。

### 5.3 业务校验规则

| 校验项 | 规则 |
| --- | --- |
| 数字员工存在性 | `agentId` 必须存在 |
| 数字员工类型 | `agentId` 对应资源业务类型必须为 `DIG_EMPLOYEE` |
| 数字员工管理权限 | 当前用户必须有该数字员工的管理权限 |
| 待绑定资源存在性 | `relResourceId` 或 `relResourceCode` 必须能定位到一个有效资源 |
| 待绑定资源使用权限 | 当前用户必须有该资源的使用权限 |

### 5.4 成功响应示例

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": null
}
```

### 5.5 失败响应示例

数字员工不存在：

```json
{
  "code": -1,
  "msg": "数字员工资源不存在",
  "data": null
}
```

当前用户无数字员工管理权限：

```json
{
  "code": -1,
  "msg": "当前用户无数字员工管理权限",
  "data": null
}
```

待绑定资源不存在：

```json
{
  "code": -1,
  "msg": "待绑定资源不存在",
  "data": null
}
```

当前用户无资源使用权限：

```json
{
  "code": -1,
  "msg": "当前用户无资源使用权限",
  "data": null
}
```

### 5.6 绑定后的同步行为

绑定成功后，服务端会执行以下动作：

| 动作 | 说明 |
| --- | --- |
| 写入资源挂载关系 | 写入数字员工与资源的挂载关系 |
| 更新数字员工扩展信息 | 更新数字员工扩展表中的 `targetContent` |
| 同步数字员工 JSON | 生成并同步数字员工标准 JSON |
| 同步 Redis | 在 Redis 同步开关开启时，同步数字员工及相关资源 JSON 到 Redis |

### 5.7 curl 示例

按资源 ID 绑定：

```bash
curl -X POST "$BASE_URL/open/api/v1/mountDigEmployeeResource" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "agentId": 123456789,
    "relResourceId": 111111
  }'
```

按资源编码绑定：

```bash
curl -X POST "$BASE_URL/open/api/v1/mountDigEmployeeResource" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "agentId": 123456789,
    "relResourceCode": "resource_code_a"
  }'
```

## 6. 错误处理建议

### 6.1 权限校验类接口

`checkDigEmployeeManagePermission` 与 `checkResourceUsePermission` 是批量查询接口。建议下游按 `items` 逐条处理结果：

- `exists=false`：资源不存在，不允许继续操作。
- `exists=true` 且 `hasPermission=false`：资源存在，但当前用户无权限。
- `hasPermission=true`：当前用户拥有对应权限。
- `allPermitted=false`：至少有一条资源不存在或无权限。

### 6.2 资源绑定接口

`mountDigEmployeeResource` 是写接口，只要任一核心校验失败，接口整体失败，不会创建绑定关系。

建议下游在调用绑定接口前，先调用：

1. `/open/api/v1/checkDigEmployeeManagePermission`
2. `/open/api/v1/checkResourceUsePermission`

提前确认当前用户是否具备操作条件，从而减少写接口失败。

