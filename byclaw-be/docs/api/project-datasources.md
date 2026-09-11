# 项目数据源配置与会话资源查询

## 功能与版本

数据库迁移位于 `deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql`。发布时先完成迁移再启用新版前后端；本次不合并 `deploy/middleware/initdb`。

项目详情右侧的数据源区域支持新增、查看、修改、删除、关联已有数据源和解除关联。会话右侧“当前会话 → 项目数据源”支持查看及双击引用。会话引用只包含名称、标识和 `DATA_SOURCE` 资源类型，不携带连接配置或密码。

数据源为独立实体，可被多个项目关联。项目创建者管理项目关联，项目成员可查看。数据源创建者可以修改、删除自己的数据源，并将其关联到自己管理的其他项目。修改共享配置会影响所有关联项目；解除关联只影响当前项目；删除会在同一事务中清除所有关联并物理删除数据源记录（含凭据）。

本期支持 openGauss 的配置管理及连接信息查询，不执行 SQL、不提供连接测试或数据库结构探查。系统内置共享默认项目不作为数据源授权容器。

## 数据模型

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `byai_datasource` | 独立的数据源名称、类型、配置和加密凭据 | 独立主键，创建者归属，物理删除 |
| `byai_project_datasource` | 项目与数据源多对多关联 | `(project_id, datasource_id)` 联合主键，不建外键，由业务代码维护关联 |

数据库列使用 `datasource_name`、`datasource_type`、`connection_config`，实体类为 `Datasource`，字段 `datasourceName`、`datasourceType`、`connectionConfig` 按下划线转驼峰约定自动对应数据库列，不使用 `@TableField`；服务层转换为接口 DTO 的 `datasourceName`、`datasourceType`、`connectionConfig`。`connection_config` 保存经过类型校验的非敏感 JSON。`password_cipher` 使用平台已有凭据加密工具保存密码。新增、修改、关联和删除在事务中完成；涉及已有数据源时锁定数据源行，串行化删除和关联操作。

## 管理接口

以下路径均加上服务上下文 `/byaiService`，请求方法均为 POST，沿用平台登录鉴权。

| 路径 | 请求字段 | 返回数据 |
| --- | --- | --- |
| `/api/v1/projectDataSources/list` | `projectId` | 当前项目的数据源数组 |
| `/api/v1/projectDataSources/available` | `projectId` | 本人创建且尚未关联的数据源数组 |
| `/api/v1/projectDataSources/create` | `projectId, datasourceName, datasourceType, connectionConfig, password`，可选 `description` | 新数据源 |
| `/api/v1/projectDataSources/update` | 上述字段及 `datasourceId`，密码可省略 | 更新后的数据源 |
| `/api/v1/projectDataSources/bind` | `projectId, datasourceId` | 空 |
| `/api/v1/projectDataSources/unbind` | `projectId, datasourceId` | 空 |
| `/api/v1/projectDataSources/delete` | `projectId, datasourceId` | 空 |

新增请求示例：

```json
{
  "projectId": "1001",
  "datasourceName": "经营分析库",
  "description": "项目分析使用的数据源",
  "datasourceType": "opengauss",
  "connectionConfig": {
    "host": "database.example.com",
    "port": 5432,
    "database": "analytics",
    "username": "report_reader",
    "schema": "public",
    "sslMode": "require"
  },
  "password": "<通过安全渠道填写实际密码>"
}
```

`datasourceName` 最长 128 字符，`description` 最长 2000 字符；密码最长 4096 字符。`host`、`database`、`username` 必填；端口为 1 至 65535 的整数，默认 5432。`schema` 可选；`sslMode` 可为 `disable`、`require`、`verify-ca`、`verify-full`，默认 `require`。未知配置字段会被拒绝。

更新时提交完整非敏感配置；省略密码或提交空字符串保留原密码。不支持修改已有数据源的类型。

所有响应沿用 `{code, msg, data}`。平台 HTTP 转换器会将 Integer/Long 序列化为字符串，因此端口、分页数量等数值字段的实际返回可能为字符串，调用方应做数值归一化。数据源响应包含字符串标识 `datasourceId`、`datasourceName`、`description`、`datasourceType`、`connectionConfig`、`hasPassword`、`canEdit`、`canManageBinding`；不包含密码或密文。

## 通用会话资源查询

- 内部只读入口：`POST /byaiService/api/v1/sessionResources/query`
- 外部入口：`POST /byaiService/open/api/v1/sessionResources/query`

外部 POST 查询精确路径免除门户通用签名，仍执行全局登录鉴权和会话、项目权限校验。外部调用复用现有身份认证，可使用有效的 `beyond-token` 及所需 `system-code`，或平台既有的 `accessToken`。`sessionId` 仅用于定位，不是访问凭据。服务端验证调用用户是会话创建者或会话成员，同时也是项目创建者或项目成员。

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 必填，会话标识 |
| `resourceType` | 必填，当前支持 `data_source`、`project`；大小写不敏感，支持直接使用引用中的 `DATA_SOURCE` |
| `resourceId` | 可选，按资源标识精确匹配 |
| `keyword` | 可选，名称包含查询，大小写不敏感；最多 200 字符，按普通文本匹配 |
| `datasourceType` | 可选，仅数据源支持，当前为 `opengauss` |
| `pageNum` | 默认 1，范围 1 至 1000000 |
| `pageSize` | 默认 50，范围 1 至 100 |
| `includeCredentials` | 默认 false；仅外部数据源查询可设为 true |

外部查询示例：

```json
{
  "sessionId": "2001",
  "resourceType": "data_source",
  "resourceId": "3001",
  "datasourceType": "opengauss",
  "pageNum": 1,
  "pageSize": 20,
  "includeCredentials": true
}
```

响应示例：

```json
{
  "code": "0",
  "msg": "操作成功",
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
        "canManageBinding": false,
        "credentials": { "password": "<仅授权外部调用按需返回>" }
      }
    ],
    "total": "1",
    "pageNum": "1",
    "pageSize": "20"
  }
}
```

不请求凭据时不返回 `credentials` 字段。内部接口显式拒绝 `includeCredentials=true`。响应使用 `Cache-Control: no-store`，控制器不添加会记录请求或响应正文的管理日志注解。调用方应直接将凭据交给连接客户端，不写入模型提示词或日志。

查询不接受 SQL；筛选条件全部通过绑定参数传入数据库。没有匹配项时返回空数组和总数 0。未知资源类型、不支持的筛选条件、无权访问、会话未关联项目等情况返回非零业务错误码。

## 扩展方式

- 增加数据源类型：实现并注册 `DataSourceTypeProvider`，声明类型及配置字段校验规则，然后添加对应前端配置表单。
- 增加资源类型：实现并注册 `SessionResourceProvider`，复用统一会话、项目授权入口；类型处理器负责该类型的筛选条件及返回结构。
- 本次未修改 `/api/v1/resources/query` 的 Redis 运行时查询契约。

## 运行时 SQL 兼容

关联插入使用普通 INSERT；在读已提交事务内，先以主键自赋值 UPDATE 获取数据源行写锁，再查询关联是否存在，已关联时跳过插入。名称过滤使用参数化 LOWER/LIKE/ESCAPE，Java 转义 !、%、_ 后构造包含模式。分页使用平台已有 MyBatis-Plus 插件，业务 SQL 不写数据库专用分页子句。部署迁移脚本仍按目标环境执行，运行时 SQL 测试不能替代目标数据库实机验证。

## curl 联调

替换地址、登录请求中的令牌与系统编码，以及实际会话 ID：

```bash
curl --silent --show-error --include \
  --request POST 'http://<服务地址>:<端口>/byaiService/open/api/v1/sessionResources/query' \
  --header 'Content-Type: application/json' \
  --header 'beyond-token: <有效登录令牌>' \
  --header 'system-code: <当前登录请求中的系统编码>' \
  --data-raw '{"sessionId":"<实际会话ID>","resourceType":"data_source","pageNum":1,"pageSize":20,"includeCredentials":false}'
```

精确查询可增加 resourceId；按数据库类型过滤使用 datasourceType。显式设 includeCredentials 为 true 可验证授权后的密码返回。前后端需同时更新：本次字段统一不保留 dataSourceId、name、type、config 和 dataSourceType 旧字段别名。

## 已知验证边界

运行时 SQL 的通用化不代表迁移脚本可以直接在任意数据库执行。V0.4.1 迁移仍沿用当前环境的建表及注释语法；平台分页配置目前区分 PostgreSQL/MySQL。其他存储的迁移、分页适配与真实并发需针对目标环境验证。
