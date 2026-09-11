# 会话资源开放查询 API

适用版本：0.4.1（D0.4.1）。本文描述当前后端实际接口契约，供外部系统联调使用。

## 1. 接口用途

根据会话 ID 定位所属项目，按资源类型查询该项目下的资源。当前支持：

| resourceType | 查询内容 |
| --- | --- |
| `data_source` | 项目关联的数据源配置，本期支持 openGauss，可按需返回连接密码 |
| `project` | 会话所属项目的基本信息 |

数据源可关联多个项目，查询范围始终限定在指定会话所属项目。接口返回连接配置，不连接目标数据库、不执行 SQL、不查询业务表数据。

## 2. 地址与请求头

```http
POST /byaiService/open/api/v1/sessionResources/query
Content-Type: application/json
```

`/byaiService` 是当前服务上下文；经过网关时，以实际暴露地址为准。

推荐使用有效的用户登录令牌：

| 请求头 | 说明 |
| --- | --- |
| `Content-Type` | `application/json` |
| `beyond-token` | 有效的用户登录令牌 |
| `system-code` | 与该令牌对应的系统编码，使用当前登录请求中的值 |

也可使用平台已有的 `accessToken` 请求头进行认证；该凭据必须能解析为有效用户身份。选择一种认证方式即可。接口复用平台认证逻辑，已有 Cookie 会话也可能参与身份识别。

此开放查询的精确 POST 路径不要求门户的 `x-signature-*` 签名头，但仍执行登录认证和资源权限校验；未新增匿名访问或独立应用 API Key 机制。

## 3. 权限要求

调用身份必须同时满足：

1. 是指定会话的创建者或用户成员。
2. 是会话所属项目的创建者或项目成员。

`sessionId` 只是查询定位条件，不是访问凭据。会话不存在、未关联项目或调用用户无权访问时，不返回资源。

当前实现没有独立的“凭据读取”角色：具备上述权限的用户，可通过开放接口显式请求连接密码。调用方应将密码用于连接客户端，不写入日志或模型提示词。

## 4. 请求参数

请求体为 JSON 对象。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | 长整型或数字字符串 | 是 | — | 会话 ID，推荐数字字符串，避免长整数精度丢失 |
| `resourceType` | 字符串 | 是 | — | `data_source` 或 `project`，大小写不敏感；也接受引用中的 `DATA_SOURCE`，最多 32 字符 |
| `resourceId` | 长整型或数字字符串 | 否 | — | 指定资源 ID，精确匹配；数据源查询填写数据源 ID，项目查询填写项目 ID |
| `keyword` | 字符串 | 否 | — | 名称包含查询，大小写不敏感，最多 200 字符；`%`、`_` 等按普通字符匹配 |
| `datasourceType` | 字符串 | 否 | — | 仅数据源查询使用，本期填写 `opengauss` |
| `pageNum` | 整数 | 否 | `1` | 范围 1～1000000 |
| `pageSize` | 整数 | 否 | `50` | 范围 1～100 |
| `includeCredentials` | 布尔值 | 否 | `false` | 仅数据源查询可设为 `true`，请求返回明文连接密码 |

筛选条件同时生效。查询项目信息时，不传 `datasourceType`，且 `includeCredentials` 应为 `false` 或省略。

查询数据源示例：

```json
{
  "sessionId": "2001",
  "resourceType": "data_source",
  "resourceId": "3001",
  "keyword": "经营",
  "datasourceType": "opengauss",
  "pageNum": 1,
  "pageSize": 20,
  "includeCredentials": false
}
```

查询项目示例：

```json
{
  "sessionId": "2001",
  "resourceType": "project"
}
```

## 5. 返回结构

成功响应示例：

```json
{
  "code": "0",
  "msg": "Operation successful",
  "data": {
    "items": [
      {
        "resourceType": "data_source",
        "resourceId": "3001",
        "datasourceId": "3001",
        "datasourceName": "经营分析库",
        "description": "项目分析使用的数据源",
        "datasourceType": "opengauss",
        "connectionConfig": {
          "host": "database.example.com",
          "port": "5432",
          "database": "analytics",
          "username": "report_reader",
          "schema": "public",
          "sslMode": "require"
        },
        "hasPassword": true,
        "canEdit": false,
        "canManageBinding": false
      }
    ],
    "total": "1",
    "pageNum": "1",
    "pageSize": "20"
  }
}
```

平台当前 HTTP 转换器会将 Integer/Long 序列化为字符串，因此 `code`、`total`、`pageNum`、`pageSize`、`port` 等可能表现为字符串。调用方应兼容数值和数字字符串，ID 建议始终按字符串处理。

| 公共字段 | 说明 |
| --- | --- |
| `code` | `0` 或 `"0"` 表示业务成功；失败为非零值 |
| `msg` | 结果说明，不建议依赖该文本判断业务状态 |
| `data.items` | 当前页资源数组 |
| `data.total` | 符合条件的资源总数 |
| `data.pageNum` | 当前请求页码 |
| `data.pageSize` | 当前请求页大小 |

没有匹配资源时，`items` 为空数组，`total` 为 0。超过最后一页时，`items` 为空，`total` 仍为匹配总数。

### 5.1 数据源资源字段

| 字段 | 说明 |
| --- | --- |
| `resourceType` | 固定为 `data_source` |
| `resourceId` | 通用资源 ID，与 `datasourceId` 相同 |
| `datasourceId` | 数据源 ID |
| `datasourceName` | 数据源名称 |
| `description` | 数据源说明 |
| `datasourceType` | 数据源类型，本期为 `opengauss` |
| `connectionConfig` | 经过类型校验的非敏感连接配置 |
| `hasPassword` | 是否已保存密码，不代表已测试连接成功 |
| `canEdit` | 当前用户是否为数据源创建者 |
| `canManageBinding` | 当前用户是否为项目创建者 |
| `credentials` | 仅显式请求凭据时返回，见下文 |

openGauss 的 `connectionConfig`：

| 字段 | 说明 |
| --- | --- |
| `host` | 主机名或 IP 地址 |
| `port` | 端口，未指定时默认 5432 |
| `database` | 数据库名称 |
| `username` | 数据库用户名 |
| `schema` | 可选模式名称，未配置时可以不返回 |
| `sslMode` | `disable`、`require`、`verify-ca`、`verify-full`，默认 `require` |

当 `includeCredentials=true` 且授权通过时，每个数据源项额外返回：

```json
{
  "credentials": {
    "password": "<实际连接密码>"
  }
}
```

密码不会放入 `connectionConfig`，也不会返回数据库内保存的 `passwordCipher`。未请求凭据时，整个 `credentials` 字段省略。响应设置 `Cache-Control: no-store`。

### 5.2 项目资源字段

| 字段 | 说明 |
| --- | --- |
| `resourceType` | 固定为 `project` |
| `resourceId` | 通用资源 ID，与 `projectId` 相同 |
| `projectId` | 项目 ID |
| `name` | 项目名称，属于项目资源结构，不是旧的数据源字段 |
| `description` | 项目说明 |
| `projectType` | 项目类型 |

一个会话只关联一个项目，因此项目查询最多匹配一条资源；请求第二页及以后时返回空数组，匹配时总数仍为 1。

## 6. curl 测试

替换服务地址、端口、令牌、系统编码和实际会话 ID 后执行：

```bash
curl --silent --show-error --include \
  --request POST 'http://<服务地址>:<端口>/byaiService/open/api/v1/sessionResources/query' \
  --header 'Content-Type: application/json' \
  --header 'beyond-token: <有效登录令牌>' \
  --header 'system-code: <当前登录请求中的系统编码>' \
  --data-raw '{
    "sessionId": "<实际会话ID>",
    "resourceType": "data_source",
    "pageNum": 1,
    "pageSize": 20,
    "includeCredentials": false
  }'
```

按需要调整请求体：

- 精确查一个数据源：增加 `"resourceId": "<数据源ID>"`。
- 按数据源类型筛选：增加 `"datasourceType": "opengauss"`。
- 验证凭据返回：将 `includeCredentials` 改为 `true`。
- 查询项目信息：将 `resourceType` 改为 `project`，不传 `datasourceType`，不请求凭据。

测试凭据返回时，终端输出将包含实际密码，反馈结果前请脱敏。

## 7. 错误处理与排查

调用方同时检查 HTTP 状态和响应 `code`，不要将 HTTP 200 一律视为业务成功。身份认证、参数校验和业务异常由平台不同层处理，不保证使用完全相同的错误状态或编码。

| 情况 | 排查方式 |
| --- | --- |
| 令牌缺失、无效或过期 | 使用有效登录令牌及对应系统编码 |
| 用户无会话或项目权限 | 确认令牌身份同时满足两层权限 |
| 会话不存在 | 检查 sessionId 是否正确 |
| 会话未关联项目 | 使用已关联项目的会话 |
| 项目或指定资源不可用 | 检查项目是否存在、数据源是否仍关联该项目 |
| 不支持的资源或数据源类型 | 使用 `data_source` / `project`，数据源类型使用 `opengauss` |
| 分页越界或必填参数缺失 | 按参数表修正；未知资源类型不会自动回退 |
| 项目查询携带数据源专属参数 | 移除 datasourceType，将 includeCredentials 设为 false |
| 返回仍是旧数据源字段 | 更新并重启后端，确保前后端版本一致 |
| 提示缺少门户签名头 | 确认后端已包含开放查询精确 POST 路径的签名适配，核对请求方法和路径 |

数据源 ID 存在但不属于会话项目，按无匹配项处理，不越过项目范围查询。

## 8. 字段兼容与调用边界

数据源请求及响应统一采用 `datasourceId`、`datasourceName`、`datasourceType`、`connectionConfig`；筛选参数使用 `datasourceType`。不保留旧 `dataSourceId`、`dataSourceType`、`name`、`type`、`config` 的数据源字段别名，调用方需同步更新。

`resourceType` 的值 `data_source`、通用字段 `resourceId` 和分页容器 `items` 保持不变。

内部会话页面使用 `/byaiService/api/v1/sessionResources/query`，该内部接口拒绝 `includeCredentials=true`；外部系统获取凭据应调用本文的开放地址。

新增资源类别由后端注册对应 `SessionResourceProvider`；新增数据库类型由 `DataSourceTypeProvider` 实现配置校验。调用方仍使用统一查询入口，并按 resourceType 解析资源项。
