# 恢复闭环指南

## 提交失败后的恢复

提交失败时，暂存数据不会被清除，可以直接重试：

1. 检查错误信息，修复问题（如补充缺失字段）
2. 再次调用 `create_object.py collect` 补充信息
3. 再次调用 `create_object.py submit` 重试提交

## 部分成功的处理

如果提交过程中某步骤失败（如建表成功但上传失败），暂存数据保留，可以重试。
重试时，建表操作使用 `IF NOT EXISTS`，不会因表已存在而失败。

## 暂存数据过期

暂存数据默认 TTL 为 3600 秒（1 小时）。过期后需要重新收集信息。
如需延长 TTL，可在环境变量中配置（暂不支持，后续版本添加）。

## 手动清理暂存

如需手动清理暂存数据（如放弃当前创建流程），可以：
- Redis 模式：`redis-cli del ontology_workspace:{entity_code}`
- 本地模式：删除 `$ONTOLOGY_WORKSPACE_DIR/{entity_code}.json`
