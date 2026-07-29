# Adapter 保存覆盖确认设计

## 目标

当录制工作台保存 CLI adapter 收到 `adapter_exists` 响应时，不进入全局“请求失败”状态。改为让用户确认是否用当前已验证的源码覆盖已有 adapter。

## 交互与数据流

1. 首次保存始终请求 `overwrite: false`。
2. 响应错误码为 `adapter_exists` 时，展示确认弹窗，说明同名 CLI adapter 已存在，并展示响应中的 `details.adapterPath`（如有）。
3. 用户选择“覆盖保存”后，以同一草稿和源码再次请求 `overwrite: true`。
4. 用户选择“取消”后，保留在测试与保存页面，不标记保存成功，也不展示请求失败。
5. 覆盖重试仍失败时，沿用普通错误处理。

## 实现边界

仅修改 `byclaw-fe/src/pages/adapterRecorder/` 中保存请求的错误识别、确认弹窗和相关单元测试。后端既有 `adapter_exists` / `overwrite` 协议不变。

## 测试

- `adapter_exists` 触发确认而不是错误态；
- 确认后仅以 `overwrite: true` 重试同一保存请求；
- 取消后不重试、不标记成功、不进入错误态；
- 弹窗展示服务端返回的 adapter 路径；
- 非 `adapter_exists` 错误保持原行为。
