# DataCloud 开放接口说明

本文档描述 ByClaw 面向 `byclaw-datacloud` 开放调用的接口。接口统一挂载在管理后台服务的开放路径下：

```text
{BASE_URL}/byaiService/open/api
```

示例：

```text
http://10.10.168.203:8086/byaiService/open/api
```

## 通用约定

### 鉴权

所有接口均通过 `Beyond-Token` 识别调用用户、企业和组织上下文，调用方不需要再额外传 `operatorUserId`。

```http
Beyond-Token: <登录态 token>
Content-Type: application/json
```

### 响应包络

接口统一返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | number | `0` 表示成功，`-1` 表示失败 |
| `msg` | string | 响应说明，成功默认 `Operation successful` |
| `data` | object / array / string / null | 业务数据 |

成功示例：

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {}
}
```

### 资源类型枚举

本体相关资源类型：

| 值 | 说明 |
| --- | --- |
| `ONTOLOGY_BASE` | 本体库 |
| `SCENE` | 场景 |
| `VIEW` | 视图 |
| `OBJECT` | 对象 |

其他常用资源类型：

| 值 | 说明 |
| --- | --- |
| `DIG_EMPLOYEE` | 数字员工 |

### systemCode

资源同步接口要求显式传入 `systemCode`，用于标识来源系统。datacloud 建议统一传：

```text
byclaw-datacloud
```

## 1. 新增本体资源

datacloud 创建本体库、场景、视图、对象后，主动调用该接口把资源同步到 ByClaw 的资源表和对应扩展表。

```text
POST /v1/ontology/resource/create
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `systemCode` | string | 是 | 来源系统编码，例如 `byclaw-datacloud` |
| `resourceBizType` | string | 是 | 资源类型：`ONTOLOGY_BASE` / `SCENE` / `VIEW` / `OBJECT` |
| `resourceCode` | string | 是 | 资源编码。本体库传 `baseId`，场景传 `sceneId`，视图传 `viewCode`，对象传 `objectCode` |
| `resourceName` | string | 是 | 资源名称 |
| `ontologyBaseCode` | string | 子资源必填 | 所属本体库编码。`SCENE` / `VIEW` / `OBJECT` 必填；`ONTOLOGY_BASE` 可不传，默认使用 `resourceCode` |
| `resourceDesc` | string | 否 | 资源描述 |
| `parentResourceBizType` | string | 否 | 父资源类型。默认 `ONTOLOGY_BASE`，用于同编码多路径时消歧 |
| `parentResourceCode` | string | 否 | 父资源编码。默认 `ontologyBaseCode`，用于同编码多路径时消歧 |
| `ownerType` | string | 否 | 归属类型：`personal` / `enterprise`。不传时默认 `personal`，有父资源时继承父资源 |
| `catalogId` | number | 否 | 资源目录 ID |


### 出参 data

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | string | 操作结果：`created` / `updated` |
| `resourceId` | number/string | ByClaw 资源 ID |
| `resourceBizType` | string | 资源类型 |
| `resourceCode` | string | 资源编码 |
| `ontologyBaseCode` | string | 所属本体库编码 |

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/ontology/resource/create' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "systemCode": "byclaw-datacloud",
    "resourceBizType": "OBJECT",
    "resourceCode": "p_contract_0027024630_b00c8f",
    "resourceName": "合同对象",
    "resourceDesc": "合同信息对象",
    "ontologyBaseCode": "67cb77c194400000"
  }'
```

## 2. 更新本体资源

datacloud 更新本体库、场景、视图、对象后，主动调用该接口刷新 ByClaw 资源和扩展表内容。

```text
POST /v1/ontology/resource/update
```

### 入参

与“新增本体资源”一致。接口会按 `systemCode + resourceBizType + resourceCode + ontologyBaseCode + parent` 定位资源；存在则更新，不存在则创建。

### 出参 data

与“新增本体资源”一致，`action` 通常为 `updated`；如果本地不存在且成功创建，则为 `created`。

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/ontology/resource/update' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "systemCode": "byclaw-datacloud",
    "resourceBizType": "OBJECT",
    "resourceCode": "p_contract_0027024630_b00c8f",
    "resourceName": "合同对象",
    "resourceDesc": "更新后的合同对象描述",
    "ontologyBaseCode": "67cb77c194400000"
  }'
```

## 3. 删除本体资源

datacloud 删除本体库、场景、视图、对象后，主动调用该接口删除 ByClaw 本地资源、扩展表数据、授权/绑定关系，并同步受影响数字员工工作空间。

```text
POST /v1/ontology/resource/delete
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `systemCode` | string | 是 | 来源系统编码，例如 `byclaw-datacloud` |
| `resourceBizType` | string | 是 | 资源类型：`ONTOLOGY_BASE` / `SCENE` / `VIEW` / `OBJECT` |
| `resourceCode` | string | 是 | 资源编码。本体库传 `baseId`，场景传 `sceneId`，视图传 `viewCode`，对象传 `objectCode` |
| `ontologyBaseCode` | string | 子资源必填 | 所属本体库编码。`SCENE` / `VIEW` / `OBJECT` 必填；`ONTOLOGY_BASE` 可不传，默认使用 `resourceCode` |

### 出参 data

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | string | `deleted` / `not_found` |
| `resourceId` | number/string | 单个删除资源 ID |
| `resourceBizType` | string | 资源类型 |
| `resourceCode` | string | 资源编码 |
| `ontologyBaseCode` | string | 所属本体库编码 |

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/ontology/resource/delete' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "systemCode": "byclaw-datacloud",
    "resourceBizType": "OBJECT",
    "resourceCode": "p_contract_0027024630_b00c8f",
    "ontologyBaseCode": "67cb77c194400000"
  }'
```

## 4. 批量校验资源使用权限

校验当前 `Beyond-Token` 对指定资源是否有使用权限。

```text
POST /v1/checkResourceUsePermission
```

### 入参

支持两种模式，`resourceIds` 和编码模式不能同时传。

#### 按资源 ID 校验

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceIds` | array<number> | 是 | 资源 ID 列表 |

#### 按资源编码校验

方式一：逐项传资源定位。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resources` | array<object> | 是 | 资源编码定位列表 |
| `resources[].resourceBizType` | string | 是 | 资源类型 |
| `resources[].resourceCode` | string | 是 | 资源编码 |
| `resources[].ontologyBaseCode` | string | 条件必填 | `SCENE` / `VIEW` / `OBJECT` 必填 |

方式二：同一资源类型、同一本体库下批量传编码。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceBizType` | string | 是 | 资源类型 |
| `ontologyBaseCode` | string | 条件必填 | `SCENE` / `VIEW` / `OBJECT` 必填 |
| `resourceCodes` | array<string> | 是 | 资源编码列表 |

### 出参 data

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `allPermitted` | boolean | 是否全部通过 |
| `items` | array<object> | 单项校验结果 |
| `items[].resourceId` | number/string | 资源 ID，未资源化时为空 |
| `items[].resourceCode` | string | 资源编码 |
| `items[].resourceName` | string | 资源名称 |
| `items[].resourceBizType` | string | 资源类型 |
| `items[].ontologyBaseCode` | string | 所属本体库编码 |
| `items[].exists` | boolean | ByClaw 资源表是否已有资源 |
| `items[].hasPermission` | boolean | 当前用户是否有使用权限 |
| `items[].message` | string | 未通过原因 |

> 对于未资源化的 `SCENE` / `VIEW` / `OBJECT`，如果当前用户对所属本体库有使用或管理权限，则返回 `exists=false`、`hasPermission=true`。

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/checkResourceUsePermission' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "resources": [
      {
        "resourceBizType": "OBJECT",
        "resourceCode": "p_contract_0027024630_b00c8f",
        "ontologyBaseCode": "67cb77c194400000"
      }
    ]
  }'
```

## 5. 批量校验数字员工管理权限

校验当前 `Beyond-Token` 对指定数字员工是否有管理权限。

```text
POST /v1/checkDigEmployeeManagePermission
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agentIds` | array<number> | 是 | 数字员工资源 ID 列表 |

### 出参 data

与“批量校验资源使用权限”一致。其中 `items[].hasPermission=true` 表示当前用户可管理该数字员工。

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/checkDigEmployeeManagePermission' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "agentIds": [10026037]
  }'
```

## 6. 挂载资源到数字员工

将本体库、场景、视图、对象等资源绑定到指定数字员工。绑定成功后会同步数字员工 OpenClaw 工作空间。

```text
POST /v1/mountDigEmployeeResource
```

### 权限规则

当前 `Beyond-Token` 用户必须同时满足：

| 权限 | 说明 |
| --- | --- |
| 数字员工管理权限 | 必须能管理 `agentId` 对应数字员工 |
| 资源使用权限 | 必须能使用待挂载资源 |

### 入参

`relResourceId` 和 `relResourceCode` 二选一，不能同时传。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agentId` | number | 是 | 数字员工资源 ID |
| `relResourceId` | number | 二选一 | 待挂载资源 ID |
| `relResourceCode` | string | 二选一 | 待挂载资源编码 |
| `relResourceBizType` | string | 按编码挂载时必填 | 待挂载资源类型 |
| `ontologyBaseCode` | string | 条件必填 | 挂载 `SCENE` / `VIEW` / `OBJECT` 时必填 |

> 如果按编码挂载未资源化的 `SCENE` / `VIEW` / `OBJECT`，且所属本体库可访问，接口会先按需创建本地资源，再执行绑定。

### 出参 data

成功时 `data` 为空：

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": null
}
```

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/mountDigEmployeeResource' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "agentId": 10026037,
    "relResourceCode": "p_contract_0027024630_b00c8f",
    "relResourceBizType": "OBJECT",
    "ontologyBaseCode": "67cb77c194400000"
  }'
```

## 7. 取消挂载数字员工资源

从指定数字员工解绑资源。解绑成功后会同步数字员工 OpenClaw 工作空间。

```text
POST /v1/unMountDigEmployeeResource
```

### 权限规则

当前 `Beyond-Token` 用户必须有 `agentId` 对应数字员工的管理权限。

### 入参

与“挂载资源到数字员工”一致。

### 出参 data

成功时 `data` 为空。

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/unMountDigEmployeeResource' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "agentId": 10026037,
    "relResourceCode": "p_contract_0027024630_b00c8f",
    "relResourceBizType": "OBJECT",
    "ontologyBaseCode": "67cb77c194400000"
  }'
```

## 8. 查询资源目录树

查询资源目录树。当前接口会强制查询领域目录，后端会把 `catalogType` 固定为 `6`。

```text
POST /v1/queryCatalogTree
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 否 | 目录关键字 |
| `containsParent` | boolean | 否 | 是否包含父目录 |
| `catalogIds` | array<number> | 否 | 指定目录 ID 列表 |

### 出参 data

`data` 为目录数组，常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `catalogId` | number/string | 目录 ID |
| `catalogName` | string | 目录名称 |
| `catalogDesc` | string | 目录描述 |
| `pCatalogId` | number/string | 父目录 ID |
| `catalogType` | number | 目录类型 |
| `catalogPath` | string | 目录路径 |
| `orderIndex` | number | 排序 |
| `resourceId` | number/string | 关联资源 ID |

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/v1/queryCatalogTree' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "keyword": "",
    "containsParent": true,
    "catalogIds": []
  }'
```

## 9. 保存对象动作信息

保存对象动作和动作属性。该接口是历史开放接口，用于保存对象动作相关内容。

```text
POST /createOrUpdateOntology
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | number | 条件必填 | 对象资源 ID。更新已有对象时传 |
| `name` | string | 否 | 对象名称 |
| `desc` | string | 否 | 对象描述 |
| `catalogId` | number | 否 | 目录 ID |
| `sourceType` | number | 否 | 数据来源类型：`1` API，`2` DOCUMENT，`3` DB_TABLE |
| `type` | string | 否 | 对象类型，默认 `OBJECT`，也支持 `VIEW` |
| `docId` | number | 否 | 文档库 ID |
| `pid` | string | 否 | 父级 ID |
| `attributes` | array<object> | 否 | 对象属性列表 |
| `actions` | array<object> | 是 | 动作列表 |

`attributes[]` 常用字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `extAttributeId` | number | 否 | 属性 ID；为空新增，不为空更新 |
| `attributeType` | string | 是 | 属性类型：`in_param` / `out_param` / `script` / `basic` / `promt` |
| `attributeCode` | string | 是 | 属性编码 |
| `attributeValue` | string | 否 | 属性值 |
| `type` | string | 是 | 数据类型：`String` / `Integer` / `Number` / `Array` / `Object` / `Enum` |
| `isRequired` | number | 否 | 是否必填：`0` 否，`1` 是 |
| `attributeDesc` | string | 否 | 属性描述 |
| `sort` | number | 否 | 排序 |

`actions[]` 常用字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | number | 否 | 动作资源 ID；为空新增，不为空更新 |
| `toolId` | number | 否 | 动作资源 ID / 函数 ID |
| `pluginId` | number | 否 | 工具集 ID |
| `name` | string | 是 | 动作名称 |
| `desc` | string | 否 | 动作描述 |
| `code` | string | 否 | 动作编码 |
| `attributes` | array<object> | 否 | 动作属性列表，字段结构同对象属性，额外支持 `relToolResourceId`、`relToolParamXpath`、`relObjId`、`actionXpath` 等 |

### 出参 data

`data` 为保存结果 Map，具体字段由本体保存服务返回。

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/createOrUpdateOntology' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "resourceId": 100401348,
    "name": "合同对象",
    "desc": "合同信息对象",
    "attributes": [
      {
        "attributeType": "basic",
        "attributeCode": "contract_no",
        "type": "String",
        "isRequired": 1,
        "attributeDesc": "合同编号",
        "sort": 1
      }
    ],
    "actions": [
      {
        "name": "查询合同",
        "code": "queryContract",
        "desc": "按合同编号查询合同",
        "attributes": [
          {
            "attributeType": "in_param",
            "attributeCode": "contract_no",
            "type": "String",
            "isRequired": 1,
            "attributeDesc": "合同编号"
          }
        ]
      }
    ]
  }'
```

## 10. 创建通知

创建业务通知。该接口不是资源同步主链路，如 datacloud 需要向门户用户发送业务通知时可调用。

```text
POST /notice/create
```

### 入参

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `noticeDetails` | array<object> | 是 | 通知列表，最多 100 条 |
| `noticeDetails[].title` | string | 是 | 通知标题，最长 200 |
| `noticeDetails[].content` | string | 是 | 通知内容，最长 2000 |
| `noticeDetails[].priority` | number | 是 | 优先级：`1` 低，`2` 中，`3` 高，`4` 紧急 |
| `noticeDetails[].senderId` | number | 条件必填 | 发送者用户 ID；和 `sendUserCode` 二选一 |
| `noticeDetails[].sendUserCode` | string | 条件必填 | 发送者用户编码；和 `senderId` 二选一 |
| `noticeDetails[].targetId` | number | 条件必填 | 接收者用户 ID；和 `targetUserCode` 二选一 |
| `noticeDetails[].targetUserCode` | string | 条件必填 | 接收者用户编码；和 `targetId` 二选一 |

### 出参 data

成功时 `data` 为：

```text
Operation successful
```

### curl

```bash
curl -s '{BASE_URL}/byaiService/open/api/notice/create' \
  -H 'Content-Type: application/json' \
  -H 'Beyond-Token: <Beyond-Token>' \
  -d '{
    "noticeDetails": [
      {
        "title": "本体资源同步完成",
        "content": "合同对象已同步到 ByClaw。",
        "priority": 2,
        "senderId": 10000009,
        "targetId": 10000022
      }
    ]
  }'
```

