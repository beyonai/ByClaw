# Sheets / 电子表格

用于飞书电子表格：工作簿、子表、单元格、CSV、公式、样式、图表、筛选、透视表和图片。

## 先定位工作簿和子表

多数 `sheets` shortcut 需要两组定位：

1. 工作簿：`--url` 或 `--spreadsheet-token`。
2. 子表：`--sheet-id` 或 `--sheet-name`。

不确定 sheet 名时，先查结构，不要猜 `Sheet1`：

```bash
lark-cli sheets +workbook-info --url "<sheet_url>" --as user --format json
```

## 常用命令

```bash
# 读取单元格/CSV
lark-cli sheets +csv-get --url "<url>" --sheet-name "数据" --range "A1:F30" --as user --format json

# 写入 CSV 文本
lark-cli sheets +csv-put --url "<url>" --sheet-name "数据" --start-cell "A1" --csv "姓名,分数\n张三,95" --as user --format json

# 写入值、公式或样式
lark-cli sheets +cells-set --url "<url>" --sheet-name "数据" --range "A1:B2" --cells '[["姓名","分数"],["张三",95]]' --as user --format json

# 导入本地表格为飞书电子表格
lark-cli sheets +workbook-import --file ./data.xlsx --as user --format json
```

## 选型规则

- 只是表格数据、公式、样式、图表：`sheets`。
- 有记录、字段类型、视图、表单、自动化：`base`。
- 本地 Excel/CSV 导成普通电子表格：`sheets +workbook-import`。
- 本地 Excel/CSV 导成多维表格：`drive +import --type bitable`。

## 数据规则

- 金额、百分比、日期、数量等有数值语义的数据，不要先拼成字符串再写；优先用 typed 写入能力。
- 范围含 `!` 时注意 shell 转义；必要时使用 stdin 或临时文件传大 JSON。
- 删除 sheet、清空大范围、批量改样式/公式前确认。
