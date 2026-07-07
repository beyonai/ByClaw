# 幻灯片 Slides

用于飞书幻灯片：创建演示文稿、读取页面、替换页面、截图和素材管理。

## 身份选择

幻灯片通常是用户资源，默认 `--as user`。bot 身份只在用户明确要求应用创建/持有资源时使用。

## 常用命令

```bash
# 查看 slides 命令
lark-cli slides --help

# 创建或编辑前查看具体 shortcut 参数
lark-cli slides +create --help
lark-cli slides +replace-slide --help

# 读取原生 schema
lark-cli schema slides.xml_presentation.get --format json
```

## 路由边界

- 普通云文档正文：`docs`。
- 上传/导入 PPTX、下载普通文件：`drive`。
- 表格或 Base 数据：`sheets` / `base`。
- 幻灯片页面内容、页面替换、截图：`slides`。

## 执行规则

- 创建正式 PPT 前先规划页数、每页主题、视觉元素和素材来源。
- 用户给模板时，应先导入/读取模板，再沿用版式修改内容。
- 写 XML 或复杂页面结构前必须查 `slides --help` / `schema`，不要凭记忆猜。
- 创建或大幅修改后，回读结果确认页数、标题、关键元素和明显溢出。

## 危险操作

删除页面、整页替换、多页覆盖、删除演示文稿前确认。
