---
name: ima-skill
description: 通过 ima-openapi-cli 管理 IMA 笔记和知识库。
cli_version: "=0.1.3"
byclaw_managed: true
upstream_package: "ima-openapi-cli@0.1.3"
upstream_tarball: "https://registry.npmjs.org/ima-openapi-cli/-/ima-openapi-cli-0.1.3.tgz"
upstream_integrity: "sha512-ckur/WWHugygFu130u/Zmn2IU9w7Ghc2cmPPxS6lFWvETSz7Rl3lqQGjMLmhSbTY2eCIR8DvqOzozOf5rWRbHg=="
upstream_shasum: "dc86270926d634bbc713d67403d537741f5a10b1"
---

# IMA Skill（ByClaw Runtime）

## 最高优先级约束

- 除 `knowledge-collection` 获取指定知识库文章详情列表的只读例外外，所有 IMA 业务操作只能通过通用 `exec` 执行 `ima` CLI；禁止 `curl`、手写 HTTP 请求或 `ima_api` helper。
- 上述 IMA 列表例外仅允许 `bycli ima knowledge <knowledgeBase> -f json`；失败后可由 `knowledge-collection` 调用一次 `ima wiki search` 兜底。列表返回可信 `https://mp.weixin.qq.com/s...` 原文 URL 后，`knowledge-collection` 必须按来源路由交给 `bycli weixin download`，而不是按标题调用 `ima wiki search`；这是原文 URL 读取，不是 IMA 写操作或 IMA 认证绕过。
- 不得读取、检查或展示 IMA 凭据或对应环境变量。凭证缺失或连接未配置时提示用户前往连接器设置重新连接。
- 禁止执行 `ima auth config`、读取凭证文件、展示凭证，或在聊天中索取 Client ID / API Key。
- 支持 `--json` 的命令必须带上 `--json`；根据进程退出码和 JSON 结果判断成功或失败，不能只凭文本输出判断。
- 鉴权失败时立即停止业务操作；写操作不得自行重试，提示用户在连接器设置重新授权后再试。

## 使用范围

当用户要搜索、浏览、创建或追加 IMA 笔记，或管理 IMA 知识库（搜索、浏览、上传文件、导入网页、关联笔记）时使用本 Skill。

## 执行前检查

1. 通过 `exec` 调用 `ima auth check --test --json`，并确认返回的 `checks.token_fetch` 为 `true`。不要读取任何凭证文件，也不要检查环境变量。
2. 若工具返回 `IMA_CREDENTIALS_UNAVAILABLE`，告知用户：“IMA 连接尚未配置，请到连接器设置重新连接。”然后停止。
3. 仅通过 `exec` 调用 IMA CLI。所有调用必须带 `--json`，并根据退出码和 JSON 结果判断成功或失败。

## 命令路由

| 用户意图 | CLI 命令 |
| --- | --- |
| 搜索、读取、创建、追加笔记 | `exec` 的 `ima note … --json` |
| 获取指定知识库的文章详情列表（仅 `knowledge-collection`） | `exec` 的 `bycli ima knowledge <knowledgeBase> -f json`，失败后一次 `ima wiki search` 兜底 |
| `knowledge-collection` 已发现的微信公众号原文 URL | `exec` 的 `bycli weixin download --url <sourceUrl> ... -f json`；失败后不得切换到 `ima wiki search` |
| 搜索或浏览知识库（其他场景） | `exec` 的 `ima wiki … --json` |
| 上传文件、导入网页、关联笔记 | `exec` 的 `ima wiki … --json` |

可先运行以下只读命令确认连接状态：

```bash
ima auth check --test --json
```

如果该调用返回非零退出码，或 JSON 指示认证失败，停止后续业务操作并提示用户在连接器设置重新授权。

## 模块指引

- 笔记操作：阅读 `notes/SKILL.md`。
- 知识库操作：阅读 `knowledge-base/SKILL.md`。
- 上传文件前的本地类型/大小检查可运行：

```bash
node skills/ima-skill/preflight-check.cjs --file ./report.pdf
```

上传前确认文件不超过 **20 MiB**；实际上传使用 `exec` 调用 `ima wiki upload --json`。

## 安全与写入规则

- 创建笔记和上传等写操作前，确认用户的目标和内容；追加到已有笔记时必须有明确目标。
- 命令失败时保留 JSON 错误信息供判断，但不要暴露凭证、内部凭证路径或敏感令牌。
- 鉴权错误和其他写操作错误均不得自动重试；向用户说明下一步。

## 上游 API 参考

`notes/references/api.md` 和 `knowledge-base/references/api.md` 为随 npm 包保留的上游接口数据参考，**在 ByClaw Runtime 中不可执行**。不要据此构造 HTTP 请求；必须映射为对应的 `ima` CLI 调用。
