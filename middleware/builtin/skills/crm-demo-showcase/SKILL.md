---
name: crm-demo-showcase
description: CRM 离线演示材料与概念说明。可生成示例周报、会议纪要并解释流程；当前版本已停用对话中的对象、视图、本体和场景查询、挂载及执行，不提供在线 CRM 数据演示。
---

# CRM 演示材料

当前版本的对话入口已停用 `OBJECT`、`VIEW`、`ONTOLOGY_BASE`、`SCENE`。用户请求相关在线查询、建模、挂载或执行时，说明该能力已下线；不得读取旧 Redis 配置、旧资源 ID，调用旧脚本或换用 MCP、Agent、直接 HTTP 请求绕过停用规则。

## 保留的离线能力

可在用户需要示例材料时运行下列本地生成器，明确说明输出是演示数据，不是实时查询结果。脚本路径相对于本技能目录：

```sh
python3 scripts/weekly-report/generate_weekly_report.py --seed 42
python3 scripts/meeting-minutes/generate_meeting_minutes.py --seed 42
```

可基于用户提供的文本解释周报、会议纪要和 CRM 流程。普通知识库、工具、MCP 与 Agent 的其他能力仍按各自权限使用，不能用来包装已停用的四类资源调用。

## 历史材料

`demos/`、`scenarios/`、`references/` 和本体/资源脚本保留为历史资料，不是当前在线执行步骤。不要执行历史挂载、查询、写入、重试或“等待下一轮恢复调用”的流程，不把历史会话中的数据表述为新查询结果。无需为本技能静默准备或挂载任何旧能力。
