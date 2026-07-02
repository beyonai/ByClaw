---
name: repo-code-analysis
description: >
  使用 byclaw-wiki 的 code_to_wiki 工具分析任意 Git 仓库代码，并在需要时用
  Zread 生成或读取 Wiki。触发词：分析代码仓库、code_to_wiki、生成 Wiki、
  Zread Wiki、代码架构分析、查看某个 git 项目。
metadata:
  openclaw:
    requires:
      tools: [code_to_wiki]
---

# 仓库代码分析与 Wiki 生成

当用户要求分析某个 Git 仓库、理解代码结构、生成代码 Wiki、读取 Zread Wiki
页面时，使用 `code_to_wiki`。

## 边界

- 本 skill 只负责指导 Agent 调用 `code_to_wiki`。
- `code_to_wiki` 负责拉取/缓存仓库、CodeGraph 索引分析、Zread Wiki 生成/读取。
- 不负责上传文件、通知管理员、审核流程、发布知识库。
- 审核发布链路使用 `wiki-review-publish` skill。

## 必读路由

按用户意图渐进式读取：

- 代码理解、架构分析、定位调用链：读 `references/codegraph-modes.md`。
- 生成或读取 Wiki：读 `references/zread-modes.md`。
- 私有仓库、鉴权失败、用户提供 token：读 `references/git-auth.md`。
- 不确定如何组织调用参数：读 `references/examples.md`。

## 默认工作流

1. 从用户话里提取 `repositoryUrl`，可选 `branch`。
2. 用户没有要求更新代码时，不设置 `refresh`，复用缓存。
3. 用户要求“重新拉取”“更新到最新”时，使用 `mode: "pull"` 或 `refresh: true`。
4. 私有仓库不要让用户把 token 直接贴进工具参数；让用户把 token 放进环境变量，然后传 `credentialRef`。
5. 优先用 `explore` 回答开放式代码问题。
6. 只有用户明确要求生成 Wiki 时，才调用 `wiki_generate`，并传 `yes: true`。

## 输出要求

- 回答用户时引用仓库、分支、关键文件或 Wiki 页面。
- 不要把本地缓存路径当成用户必须操作的东西；它只是必要时给工程师定位。
