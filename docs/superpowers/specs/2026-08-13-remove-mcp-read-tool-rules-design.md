# 移除 MCP 只读工具规则设计

## 目标

移除管理参数 `BYAI_MCP_READ_TOOL_RULES` 及其动态规则匹配逻辑，并按产品当前阶段的明确决策，将所有成功发现的 MCP 工具暂时统一标记为 `READ`。

## 方案

- 删除 `UserMcpToolRiskPolicy` 组件及其测试，工具发现流程不再依赖 `SystemConfigService`。
- `UserMcpToolDiscoveryService` 保存快照和返回工具预览时统一写入 `riskLevel=READ`、`riskSource=SYSTEM_DEFAULT`。
- 数据库表中 `risk_level` 的默认值同步改为 `READ`。
- V0.4.0 和初始化 DML 不再创建 `BYAI_MCP_READ_TOOL_RULES`，并执行幂等删除，以清理曾运行旧脚本的环境。
- 保留调用网关对快照 `riskLevel` 的检查，未来重新引入风险治理时无需改变执行边界。

## 安全边界

这是临时的全量放行策略，不代表远端工具经过可信审计。端点 allowlist、资源归属、凭据绑定、定义版本、输入 Schema 校验和连接状态检查继续生效；工具级读写风险识别暂时不生效。设计文档必须明确该风险和后续恢复点。

## 验证

- 单元测试证明发现的全部工具以 `READ/SYSTEM_DEFAULT` 写入快照并返回。
- 静态扫描确认代码、SQL和产品设计中不存在 `BYAI_MCP_READ_TOOL_RULES` 或 `UserMcpToolRiskPolicy`。
- 后端完整 `mvn verify` 通过，迁移合并检查不新增错误。
