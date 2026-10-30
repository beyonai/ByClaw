# 知识库文档复制接口

## 地址与用途

`POST /byaiService/datasetController/copyKnowledgeFile`

以当前用户身份将一个知识库或项目云盘的原始文档复制到指定知识库目录，支持同库和跨库复制。HACU 转发项目云盘文档时先调用此接口，再使用响应里的目标资源 ID 与文件路径创建转发引用。

源、目标资源支持 `KG_DOC`、`KG_QA`、`KG_TERM`、`KG_CLOUD`，不支持 `KG_DB`、已注销资源、目录或 ZIP 文件。接口只复制原文并创建独立文档，不搬走或删除源文件，不复用源文档的创建人、索引、构建任务或元数据。当前不提交索引构建；需要检索时另走现有构建接口。

## 身份与权限

- 必须使用当前用户的有效登录态，请求头为 `Beyond-Token`；HACU 应沿用现有企业、租户上下文请求头。本接口正常执行企业与租户校验，不继承资源同步入口的校验例外。
- 源库要求读取权限；独立的资源介绍查看授权不能读取或复制文档。
- 目标普通知识库要求资源管理权限，只有查看或使用权限不能写入。
- 项目云盘的读取与新增按项目访问权限检查。成员可以复制其可读取的其他成员文档，不要求源文件的删除、改名权限。目标项目不允许访问时，即使具有普通资源管理员角色也拒绝复制。
- 目标文档创建账号取后端登录态，忽略客户端伪造的 `X-USER-CODE`。`X-CHAT-SESSION-ID` 可选，沿用现有知识服务上下文传递方式。

## 入参

Content-Type：`application/json`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sourceResourceId` | integer | 是 | 源知识库或项目云盘资源 ID，必须为正整数 |
| `sourceFilePath` | string | 是 | 源文件完整路径，不包含知识库名称，例如 `/项目资料/设计说明.pdf` |
| `targetResourceId` | integer | 是 | 目标知识库或项目云盘资源 ID，必须为正整数，可与源相同 |
| `targetDirectoryPath` | string | 否 | 目标库中已经存在的目录，缺省或空白为根目录 `/` |
| `targetFileName` | string | 否 | 新文件名，缺省沿用源文件名；不能包含目录分隔符或控制字符 |

请求不接收存储桶、对象地址、知识库编码、来源创建人或权限字段，后端按资源 ID 解析实际知识服务及资源编码。

路径会补齐开头 `/`、压缩连续分隔符并兼容反斜杠。拒绝点目录 `.`、`..`、控制字符及文件路径的末尾目录分隔符。目标目录不会自动创建；应先使用已有目录创建接口。

```json
{
  "sourceResourceId": 100,
  "sourceFilePath": "/项目资料/设计说明.pdf",
  "targetResourceId": 200,
  "targetDirectoryPath": "/转发资料",
  "targetFileName": "设计说明-副本.pdf"
}
```

## 出参

沿用后端统一响应：`code=0` 表示复制成功，`data` 为复制结果。

```json
{
  "code": 0,
  "msg": "文档复制成功",
  "data": {
    "sourceResourceId": 100,
    "sourceFilePath": "/项目资料/设计说明.pdf",
    "targetResourceId": 200,
    "targetFilePath": "/转发资料/设计说明-副本.pdf",
    "fileName": "设计说明-副本.pdf",
    "fileSize": 245760,
    "success": true,
    "postProcessErrors": []
  }
}
```

`fileSize` 是本次读取并提交给目标知识服务的原文字节数。知识服务若执行 Markdown 链接归一化，目标最终大小以目录查询结果为准。`postProcessErrors` 透传知识服务在文档落库后的附加处理告警，不表示原文复制失败。转发引用应保存 `targetResourceId` 与 `targetFilePath`，不继续引用源库文件。

知识服务不仅要返回外层成功，还必须明确返回该目标路径唯一一项 `success=true` 的文件结果。空响应、逐文件失败、错误路径或矛盾汇总不会包装成复制成功。

## 冲突与失败处理

- 目标同名文件或目录存在时拒绝复制，不覆盖、不删除旧文件，不自动改名；由调用方提供其他文件名或目标目录后重新发起。
- 同库且目标路径与源路径相同时直接拒绝；在原目录复制时必须指定不同文件名。
- 源文档不存在、目标目录不存在、任一端无权限、知识服务失败均返回失败。HACU 仅在明确成功后创建转发引用。
- 原文通过临时文件中转，并按 `spring.servlet.multipart.max-file-size` 检查大小，缺省 `2048MB`；同时检查目录元信息和实际下载字节数。正常返回和异常退出均在 `finally` 中尝试清理临时文件。
- 复制期间不会提交源文件修改、索引构建或资源关联变更。导入关闭 Markdown front matter 元数据解析，避免重新录入来源创建账号；知识服务仍沿用既有 Markdown 链接处理，文档引用的附件和其他文件不递归复制。
- 非覆盖导入接口负责拒绝并发产生的目标重名；后端不以“先删除再重传”实现复制。
- 没有额外的幂等请求号。网络超时或知识服务返回不明确结果时，目标文件可能已经建立；重试前应查询目标目录，不能反复盲目重试。

## curl

```bash
curl --request POST 'https://<百应域名>/byaiService/datasetController/copyKnowledgeFile' \
  --header 'Content-Type: application/json' \
  --header 'Beyond-Token: <当前用户登录Token>' \
  --data '{
    "sourceResourceId": 100,
    "sourceFilePath": "/项目资料/设计说明.pdf",
    "targetResourceId": 200,
    "targetDirectoryPath": "/转发资料",
    "targetFileName": "设计说明-副本.pdf"
  }'
```

## 实现与验证范围

后端复用现有知识服务的目录查询、原文下载与文件导入接口，并分别绑定源、目标资源上下文。无需新增数据库表、迁移脚本或 QA 接口，HACU 需自行接入调用和目标引用替换。

租户路由仅登记精确的 `POST /datasetController/copyKnowledgeFile`，携带租户头时仍调用上下文令牌验证。相邻知识库接口及其他 HTTP 方法未因此开放。

回归覆盖请求校验、跨库与同库复制、真实项目成员权限判定、目标权限不足、路径穿越及控制字符、源/目标注销、重名冲突、大小限制、知识服务外层及逐项失败、原文一致性、创建账号防伪、流关闭和临时文件清理。真实部署环境中的 QA 文件读写及 HACU 转发仍需联调验证。
