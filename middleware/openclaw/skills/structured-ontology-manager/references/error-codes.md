# 错误码和调试流程

## 常见错误

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `BE_DOMAINNAME 环境变量未配置` | 服务发现配置缺失 | 检查环境变量 `BE_DOMAINNAME` |
| `暂存状态不存在，请先收集对象信息` | 未先调用 collect | 先调用 `create_object.py collect` |
| `entity_name 不能为空` | 必填字段缺失 | 补充 `entity_name` |
| `fields 不能为空` | 必填字段缺失 | 补充至少一个字段 |
| `property_code 重复` | 字段编码冲突 | 修改重复的 `property_code` |
| `非法 data_type` | 数据类型不合法 | 使用 STRING/INTEGER/FLOAT/BOOLEAN/DATE |
| `term_type_code 与 term_values 互斥` | 两个术语绑定方式同时填写 | 只填其中一个 |
| `未找到本体: xxx` | 删除时本体不存在 | 确认 `entity_code` 是否正确 |

## 调试流程

1. 检查环境变量是否正确配置
2. 使用 `ONTOLOGY_STORE=local` 切换到本地文件存储，排除 Redis 连接问题
3. 查看 stderr 输出获取详细错误信息
4. 确认 `session_id` 在多轮对话中保持一致
