---
name: agent-reach
description: Use when the user asks to research, search, read, or look up anything on the internet; mentions or shares a webpage, GitHub, YouTube, Bilibili, V2EX, Twitter/X, Reddit, Xiaohongshu, LinkedIn, podcasts, RSS, jobs, code, or social-platform content.
---

# Agent Reach — 互联网能力路由器

本文件以 Agent Reach `v1.5.0` 官方 Skill 为主体，并在前方增加 ByClaw 运行时覆盖规则。官方来源固定为提交
`f65526cbaaad3879473acc1ba6dbefd195caf2be`，随附 references 和许可证保持上游原文。

## ByClaw 覆盖规则（最高优先级）

官方主体及其 references 与覆盖规则冲突时，以本节为准。

角色名称固定如下：路由器：`agent-reach`；网站执行器：`bycli`；采集编排器：`knowledge-collection`；
直接查询所有者：根 Agent。以下规则始终使用这些名称确定结果与交互的所有权。

1. 使用 `byclaw-capability-doctor` 进行初始化、选后端和故障后的被动检查。读取
   `providers.agentReach.channels.<channel>` 时，`diagnosticBackend` 是 Agent Reach 上游探测值，`effectiveBackend` 是应用 ByClaw
   覆盖规则后的实际执行后端，`activeBackend` 是 `effectiveBackend` 的兼容别名。只执行 `effectiveBackend`；不得直接执行 `diagnosticBackend`。
   其中 Jina Reader 和 OpenCLI 均映射为 `bycli`；当上游未给出 `active_backend`，但候选 `backends` 包含 Jina Reader 或 OpenCLI 时，
   `effectiveBackend` 仍为 `bycli`。此时渠道 `status` 只表示上游诊断状态，以 `providers.bycli.status` 判断执行就绪度。
2. 不得用 `bycli doctor` 替代聚合被动检查；被动检查不得调用 `/v1/browser/recover` 或任何浏览器启动命令。daemon 运行但 Extension
   未连接是正常冷状态，`available_on_demand` 不得启动 Chrome。
3. 本项目只提供 byCLI，不提供 OpenCLI。官方主体或 references 中的任何 `opencli` 路径均视为不可用：不得安装
   OpenCLI、不得创建 `opencli` 别名，也不得执行 Agent Reach 的 OpenCLI 安装路径。
   Do not install OpenCLI. Do not create an `opencli` alias.
4. 当 `effectiveBackend` 为 `bycli`，或官方路由要求 OpenCLI、登录态或浏览器后端时，路由器加载并遵循 `bycli` skill；网站执行器用
   `bycli list -f json` 发现 Adapter，遵守其浏览器生命周期、授权、执行与验证规则，并把结果返回当前任务所有者。直接查询时由根 Agent
   负责最终回复；委派采集时由采集编排器负责统一持久化、产物协议、后处理与入库或知识整理。
5. 禁止使用 Jina Reader 或访问 `r.jina.ai`。所有官方 Jina 路径，包括官方 `references/web.md` 的通用网页读取和
   `references/career.md` 的 LinkedIn fallback，均加载并遵循 `bycli` skill：先执行 `bycli list -f json` 动态发现 Adapter；
   通用网页存在 `web/read` 时执行 `bycli web read --url <URL>`，站点专用 Adapter 存在时优先使用专用 Adapter，缺失时按 byCLI
   Browser 降级规则处理。不得回退到 Jina Reader、Web Reader MCP、`curl`、`wget`、`requests` 或原站直连。
6. 只有用户的实际任务需要浏览器时，才执行 `bycli` skill 规定的主动桥接检查和恢复流程。
7. Agent Reach 已由镜像固定安装，不在运行时执行 `agent-reach install`、`uninstall` 或自动更新；可以报告
   `check-update` 结果，但不得自行升级。
8. 当采集编排器 `knowledge-collection` 发起委派时，路由器 `agent-reach` 只负责渠道与后端选择、按需委派网站执行器 `bycli`，
   并将采集结果返回采集编排器。采集编排器负责统一持久化、产物协议、后处理、入库或知识整理。此时本覆盖规则取代官方 `/tmp/` 工作区规则；
   路由器与网站执行器不得询问 `入库 / 知识整理 / 跳过`，不得执行通用落盘、入库或知识整理，
   不得规定统一产物目录、文件名或保留策略，也不得反向加载 `knowledge-collection`。
9. 聚合诊断对企业 CLI 只做被动检查：WeCom 仅检查 `wecom-cli --version`，授权状态保持
   `not_checked`；Lark 额外检查 `lark-cli auth status`；DWS 检查 `dws auth status --format json`。不得输出企业身份原始内容。
   三者均不参与 `overallStatus`，实际业务仍使用各自专用能力。
10. 企业协作业务必须交给专用 Skill：飞书/Lark 的消息、通讯录、日历、文档、任务、授权等请求，加载并遵循 `fws` skill；
   企业微信/WeCom 的对应请求，加载并遵循 `wecomcli` skill，再由其选择具体业务能力；钉钉/DingTalk 的对应请求，
   加载并遵循 `dws` skill。`byclaw-capability-doctor` 中已有的 provider 状态仅用于被动诊断，
   不能替代业务 Skill 的意图路由、授权与调用流程。
11. 企业来源的采集、归档、批量搜索或入库请求交给采集编排器 `knowledge-collection`；其按来源加载 WeCom 或 Feishu
    采集桥接，再委派 `wecomcli` 或 `fws`。路由器只完成该交接与被动诊断，不得作为公共互联网任务交给 `bycli`，
    不得自行执行企业 CLI、管理采集产物、凭据或后处理。

## Agent Reach 官方主体（v1.5.0）

13 平台、多后端。**本 skill 存在时必须用它访问这些平台，不要自己发明方案。**

## 常驻规则（全程适用）

1. **动手前先体检**：多后端平台（小红书/Reddit/B站/Twitter）先跑
   `agent-reach doctor --json`，按各平台 `active_backend` 字段选命令组。
2. **声明你在用什么**：开始干活前说一句「使用 agent-reach 的 X 平台 / Y 后端」。
3. **失败按 references 里的重试链处理**，不要瞎猜命令。
4. **全网调研类任务**：组合多平台（Exa 搜索 + Twitter/Reddit 看讨论 + 小红书/B站看中文场景），并行收集再汇总。
5. **替用户盯版本**：完成一次较大的调研/多平台任务后，顺手跑
   `agent-reach check-update`（很快，一个 API 调用）。有新版就在收尾汇报里附一句：
   「Agent Reach 有新版 vX.Y.Z，复制这句话给我即可更新：帮我更新 Agent Reach：
   https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md」。
   不要中断当前任务去更新，也不要重复提醒同一个版本。

## 路由表

| 用户意图 | 分类 | 详细文档 |
|---------|------|---------|
| 网页搜索/代码搜索 | search | [references/search.md](references/search.md) |
| 小红书/推特/B站/V2EX/Reddit | social | [references/social.md](references/social.md) |
| 招聘/职位/LinkedIn | career | [references/career.md](references/career.md) |
| GitHub/代码 | dev | [references/dev.md](references/dev.md) |
| 网页/文章/RSS | web | [references/web.md](references/web.md) |
| YouTube/B站/播客字幕 | video | [references/video.md](references/video.md) |

## 零配置快速命令

```bash
# Exa 网页搜索
mcporter call 'exa.web_search_exa(query: "query", numResults: 5)'

# 通用网页阅读
curl -s "https://r.jina.ai/URL"

# GitHub 搜索
gh search repos "query" --sort stars --limit 10

# YouTube 字幕（注意：B站不要用 yt-dlp，见 video.md）
yt-dlp --write-sub --skip-download -o "/tmp/%(id)s" "URL"

# V2EX 热门
curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"

# B站搜索（bili-cli，无需登录）
bili search "query" --type video -n 5
```

## 需登录态的平台（按 doctor 的 active_backend 选命令）

```bash
# Twitter 搜索（twitter-cli 首选；失败重试链见 social.md）
twitter search "query" -n 10

# Reddit（无零配置路径：OpenCLI 或 rdt-cli，必须登录态）
opencli reddit search "query" -f yaml   # 桌面
rdt search "query" --limit 10            # 存量/服务器

# 小红书（桌面首选 OpenCLI）
opencli xiaohongshu search "query" -f yaml
```

## 环境检查

```bash
# 检查可用 channel 与每个平台当前激活的后端
agent-reach doctor --json
```

## 工作区规则

**不要在 agent workspace 创建文件。** 使用 `/tmp/` 存放临时输出，`~/.agent-reach/` 存放持久数据。

## 详细文档

根据用户需求，阅读对应的详细文档：

- [搜索工具](references/search.md) — Exa AI 搜索
- [社交媒体](references/social.md) — 小红书, Twitter, B站, V2EX, Reddit（多后端命令组）
- [职场招聘](references/career.md) — LinkedIn
- [开发工具](references/dev.md) — GitHub CLI
- [网页阅读](references/web.md) — Jina Reader, RSS
- [视频播客](references/video.md) — YouTube, B站, 小宇宙

## 配置渠道

如果某个 channel 需要配置，获取安装指南：
https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md

用户只需提供 cookies，其他配置由 agent 完成。
