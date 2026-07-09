---
name: wecomcli
description: Use when 用户需要通过 wecom-cli 操作企业微信或 WeCom，包括通讯录、消息、会议、日程、待办、企微文档、在线表格、智能表格、智能文档/智能主页；遇到 doc.weixin.qq.com 链接时也使用。
---

# 企业微信 CLI 技能路由

将这个父级 skill 作为企业微信 / WeCom 任务的入口，底层能力由 `wecom-cli` 提供。

执行任务前，先根据下表选择匹配的子 skill，并阅读对应子目录的 `SKILL.md`。不要只凭这个父级文件直接调用 `wecom-cli`；具体参数、安全规则、异步轮询规则和危险操作处理都在子 skill 中。

## MUST DO：授权初始化恢复

当 agent 执行任意 `wecom-cli` 命令后，如果返回 `Error` / `ERROR` / 非 0 退出，且错误信息包含或近似表达“请先运行 `wecom-cli init`”“需要先初始化”“未登录/未授权/请先授权”“未找到 MCP 配置缓存”等内容，必须按以下流程处理：

1. 记录刚才失败的原始 `wecom-cli` 命令及完整参数，然后立即运行：
   ```bash
   wecom-cli init --noninteractive --no-open
   ```
2. 该命令会在终端输出授权二维码或二维码相关内容。只需从输出中提取第一条二维码超链接或登录 URL，并把该超链接返回给用户；不要粘贴终端二维码图形、二维码文本块或 ANSI 二维码输出。
3. 告知用户使用企业微信打开该授权链接或扫码完成授权，并等待 `wecom-cli init --noninteractive --no-open` 返回成功。不要跳过等待步骤，不要改用交互式 `wecom-cli init`，不要尝试打开浏览器。
4. 如果初始化命令提示扫码超时，且用户仍要继续当前任务，则重新运行一次 `wecom-cli init --noninteractive --no-open`，返回新的授权链接并继续等待。
5. 授权成功后，重新执行第 1 步记录的原始 `wecom-cli` 命令。
6. 如果重试原始命令仍返回初始化/授权类错误，最多再执行一轮第 1-5 步；第二轮后仍失败时，停止重试，返回最新错误并说明授权未完成，不要伪造成功结果。

## 路由表

| 用户意图或 URL | 优先读取的子 skill |
|---|---|
| 查找人员、按姓名/别名解析 `userid`、查看当前可见通讯录 | `wecomcli-contact/SKILL.md` |
| 查看聊天、列会话、拉取聊天记录、下载消息附件、发送文本消息 | `wecomcli-msg/SKILL.md` |
| 创建/查询/取消企业微信会议、获取会议链接或会议号、更新受邀成员 | `wecomcli-meeting/SKILL.md` |
| 创建/查询/修改/取消日历日程、添加/移除参与人、查询闲忙或共同空闲时间 | `wecomcli-schedule/SKILL.md` |
| 创建/更新/删除待办、查询待办列表或详情、修改参与人在待办中的状态 | `wecomcli-todo/SKILL.md` |
| `https://doc.weixin.qq.com/doc/*`，普通企微文档，新建/读取/覆写 Markdown 正文 | `wecomcli-doc/SKILL.md` |
| `https://doc.weixin.qq.com/sheet/*`，在线表格，行列区域、追加行、子工作表管理 | `wecomcli-sheet/SKILL.md` |
| `https://doc.weixin.qq.com/smartsheet/*`，智能表格，记录、字段、类型列、附件字段 | `wecomcli-smartsheet/SKILL.md` |
| `https://doc.weixin.qq.com/smartpage/*`，智能文档/智能主页，创建或导出 Markdown | `wecomcli-smartpage/SKILL.md` |

## 核心规则

- 按所选子 skill 的说明调用 `wecom-cli`，不要自行发明参数。
- 涉及人员时，通过 `wecomcli-contact` 或子 skill 规定的查询流程解析；不要猜测 `userid`。
- 以 `doc.weixin.qq.com` 的路径片段作为文档品类路由依据：`/doc/`、`/sheet/`、`/smartsheet/`、`/smartpage/` 对应不同子 skill。
- 发送消息、覆写内容、取消/删除对象、全量替换成员列表等操作，必须遵守子 skill 中的确认和安全规则。
- 子 skill 带有 `references/` 时，只在该子 skill 的路由表要求时读取相关 reference 文件。

## 常见区分

- 会议链接、会议号、会议安全设置、会议受邀人：使用 `wecomcli-meeting`。
- 日历事件、提醒、日程参与人、闲忙分析：使用 `wecomcli-schedule`。
- 按行列区域操作的传统在线表格：使用 `wecomcli-sheet`。
- 带字段、记录、类型值和记录 ID 的结构化智能表格：使用 `wecomcli-smartsheet`。
