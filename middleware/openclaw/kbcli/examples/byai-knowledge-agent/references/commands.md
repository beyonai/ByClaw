# kbcli 命令与请求体

所有命令均需 `--session-id <runtime-session-id>`。

例外：静态契约查询不访问服务，不需要 `session_id`：

```bash
kbcli describe base get --format json
kbcli describe --all --format json
```

每条契约包含输入属性、HTTP 映射、`output.dataType`、统一输出 envelope、备注和错误码。

## 知识库

```bash
kbcli base create --session-id "$session_id" --input '{
  "resourceName":"人事制度","resourceDesc":"人事知识库","resourceBizType":"KG_DOC",
  "resourceType":"ATOM","ownerType":"personal","type":"dataset",
  "implType":"","workerAgentType":""
}'
kbcli base update --session-id "$session_id" --input '{"resourceId":"2001","resourceName":"新名称"}'
kbcli base delete --session-id "$session_id" --resource-id 2001
kbcli base get --session-id "$session_id" --resource-id 2001
```

## 目录和路径

```bash
kbcli folder create --session-id "$session_id" --input \
  '{"resourceId":"2001","directoryPath":"/制度","directoryName":"人事","directoryDescription":""}'
kbcli folder rename --session-id "$session_id" --input \
  '{"resourceId":"2001","directoryPath":"/制度/人事","directoryName":"人力资源"}'
kbcli folder delete --session-id "$session_id" --resource-id 2001 --path /制度/旧目录
kbcli item list --session-id "$session_id" --resource-id 2001 --directory /制度
kbcli item list --session-id "$session_id" --resource-id 2001 \
  --directory /制度 --keyword "人事"
kbcli item glob --session-id "$session_id" --resource-id 2001 \
  --path-rule "/制度/*/*.md"
```

目录浏览使用 `item list`。`item glob` 的 `--path-rule` 是字符串，`*` 只匹配单层目录，不支持
`**`；不要通过批量猜测请求字段或通配符来探测接口。

移动请求中 `targetDirectoryPath` 与 `targetFilePath` 二选一：

```json
{"resourceId":"2001","sourcePath":["/旧/a.md","/旧/b.md"],"targetDirectoryPath":"/新","overwrite":false}
```

## 文件

```bash
kbcli file conflicts --session-id "$session_id" --input \
  '{"resourceId":"2001","directoryPath":"/制度","fileNames":["考勤.md"]}'
kbcli file upload --session-id "$session_id" --resource-id 2001 \
  --directory /制度 --file ./考勤.md --file ./休假.md
kbcli file update --session-id "$session_id" --resource-id 2001 \
  --path /制度/考勤.md --file ./考勤.md
kbcli file delete --session-id "$session_id" --resource-id 2001 --path /制度/考勤.md
kbcli file download --session-id "$session_id" --resource-id 2001 \
  --path /制度/考勤.md --output ./考勤.md
kbcli file read --session-id "$session_id" --resource-id 2001 \
  --path /制度/考勤.md --start-line 1 --end-line 100
```

`file read` 不传 `--start-line` 和 `--end-line` 时读取完整文件；大文件按行分页，并检查返回值中的
`reachedEof`。不要传 `--input`，不要猜测后端 DTO 字段名。

上传选项：`--description`、`--process-front-matter`、`--overwrite`、`--skip-existing`。
`--overwrite` 与 `--skip-existing` 互斥。更新内容不会自动触发知识构建。

## 构建与转换

```bash
# 对已入库文件触发构建
kbcli build start --session-id "$session_id" --resource-id 2001 --path /制度/考勤.md

# 原始文件转为本地 Markdown；不入库、不构建
kbcli build convert --session-id "$session_id" --file ./考勤.pdf --output ./考勤.md

# 将 Markdown 文件写入指定目录并立即触发构建
kbcli build from-doc --session-id "$session_id" --resource-id 2001 \
  --directory /制度 --doc-name 考勤.md --doc-file ./考勤.md

# 查询构建状态和完整构建结果
kbcli build status --session-id "$session_id" --resource-id 2001 --path /制度/考勤.md
kbcli build result --session-id "$session_id" --resource-id 2001 --path /制度/考勤.md \
  --chunk-page 1 --chunk-page-size 20
```

`build from-doc` 的 `--doc` 与 `--doc-file` 必须且只能提供一个，生成内容较长时优先使用
`--doc-file`。`build result --no-markdown` 可省略 Markdown 正文。`build start` 和
`build from-doc` 是写操作，只执行一次；`status` 与 `result` 是只读查询。

## 检索

```bash
kbcli search chunks --session-id "$session_id" \
  --resource-id 2001 --query "年假天数" --top-k 5 --mode mixedRecall
kbcli search files --session-id "$session_id" \
  --resource-id 2001 --query "员工休假制度" --top-k 10 --mode mixedRecall
```

Chunk 搜索还支持重复的 `--file-type`、`--metadata-field`，以及 JSON `--where`。

元数据检索使用 `--input`：

```json
{
  "resourceIdList":["2001"],
  "where":{"op":"eq","field":"department","value":"HR"},
  "metadataFieldList":["department","author"],
  "topK":10,"pageNum":1,"pageSize":20
}
```
