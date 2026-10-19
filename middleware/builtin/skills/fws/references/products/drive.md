# 云空间 Drive

用于飞书云空间/云盘文件和文件夹：搜索、上传、下载、复制、移动、导入导出、评论、权限和元数据。

## 常用命令

```bash
# 搜索云空间资源
lark-cli drive +search --query "项目方案" --as user --format json

# 解析 URL/token，尤其是 wiki 链接
lark-cli drive +inspect --url "<url>" --as user --format json

# 上传文件
lark-cli drive +upload --file ./relative/path/file.pdf --folder-token <folder_token> --as user --format json

# 创建文件夹
lark-cli drive +create-folder --name "资料" --parent-token <folder_token> --as user --format json

# 查看原生 copy 参数
lark-cli schema drive.files.copy --format json
```

## 路由边界

- 正文编辑：`docs`。
- 表格单元格操作：`sheets`。
- Base 表内数据：`base`。
- Wiki 节点和空间成员：`wiki`。
- 文件资产、权限、评论、导入导出：`drive`。

## URL / token 规则

- `/docx/`、`/sheets/`、`/base/`、`/slides/` 通常能从 URL 直接提取对应资源 token。
- `/wiki/` 链接不是底层文件 token；先 `drive +inspect` 或 `wiki spaces get_node` 解包。
- 复制/移动/删除前先确认真实 file token、类型和目标 folder token。

## 导入导出分流

- `.docx` / `.md` / `.txt` / `.html` -> 在线文档：`drive +import --type docx`。
- `.xlsx` / `.csv` -> 电子表格：优先 `sheets +workbook-import`。
- `.xlsx` / `.csv` / `.base` -> 多维表格：`drive +import --type bitable`。
- `.pptx` -> 幻灯片：`drive +import --type slides`。

## 安全规则

- 删除、移动、覆盖、权限变更、owner 转移前确认。
- 文件路径只用当前工作目录下的相对路径；绝对路径可能被 CLI 拒绝。
- 不要把下载产物直接落到项目根目录；明确输出目录。
