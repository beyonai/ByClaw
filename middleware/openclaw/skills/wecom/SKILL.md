---
name: wecomcli
description: Use when 用户需要通过 wecom-cli 操作企业微信或 WeCom，包括通讯录、消息、会议、日程、待办、企微文档、在线表格、智能表格、智能文档/智能主页；遇到 doc.weixin.qq.com 链接时也使用。
---

# 企业微信 CLI 技能路由

将这个父级 skill 作为企业微信 / WeCom 任务的入口，底层能力由 `wecom-cli` 提供。

执行任务前，先根据下表选择匹配的子 skill，并阅读对应子目录的 `SKILL.md`。不要只凭这个父级文件直接调用 `wecom-cli`；具体参数、安全规则、异步轮询规则和危险操作处理都在子 skill 中。

## MUST DO：授权初始化恢复

### 必须遵守的错误判断

仅当 `wecom-cli` 命令返回 `Error` / `ERROR` / 非 0 退出，且错误信息包含或近似表达以下内容时，才进入本流程：

- 请先运行 `wecom-cli init`
- 需要先初始化
- 未登录 / 未授权 / 请先授权
- 未找到 MCP 配置缓存

其他业务错误不得套用本流程。

### 授权恢复流程

1. 记录刚才失败的原始 `wecom-cli` 命令及完整参数。
   禁止丢失、改写或猜测原命令。

2. 运行：
   ```bash
   wecom-cli init --noninteractive --no-open
   ```
   必须使用后台/长运行会话方式执行，并保留进程会话用于后续轮询，避免前台等待超时导致进程被终止。禁止改用交互式 `wecom-cli init`，禁止尝试打开浏览器。

3. 从初始化命令输出中提取第一条 `http` 或 `https` 授权 URL，并且只以 Markdown 超链接形式返回给用户：
   ```md
   [打开企业微信授权链接](URL)
   ```
   禁止返回原始终端输出、图形块、文本块或 ANSI 输出。

4. 告知用户使用企业微信打开该 Markdown 授权链接完成授权，然后继续轮询第 2 步保留的初始化进程，直到 `wecom-cli init --noninteractive --no-open` 返回成功、提示授权超时，或进程异常退出。
   禁止把“已返回授权链接”当作“授权成功”，禁止跳过轮询等待步骤，禁止用任何自动化方式代替用户授权。

5. 如果无法提取授权 URL，停止自动流程，告知用户手动运行：
   ```bash
   wecom-cli init --noninteractive --no-open
   ```
   并让用户提供命令输出中的授权 URL。

6. 如果初始化进程被 `SIGTERM`、中断或异常退出，不要立即判定授权失败；先重新执行第 1 步记录的原始 `wecom-cli` 命令验证授权是否已经生效。若原始命令成功，直接继续业务流程；若原始命令仍返回初始化/授权类错误，再进入下一轮授权恢复。

7. 如果初始化命令提示授权超时，且用户仍要继续当前任务，则重新运行一次 `wecom-cli init --noninteractive --no-open`，返回新的 Markdown 授权链接并继续轮询等待。

8. 初始化进程明确返回成功后，重新执行第 1 步记录的原始 `wecom-cli` 命令。

9. 如果重试原始命令仍返回初始化/授权类错误，最多再执行一轮完整的 Step 1-8；第二轮后仍失败时，停止重试，返回最新错误并说明授权未完成。禁止伪造成功结果。

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
