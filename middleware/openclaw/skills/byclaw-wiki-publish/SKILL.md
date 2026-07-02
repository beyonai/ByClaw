---
name: wiki-review-publish
description: >
  对已生成的 Wiki Markdown 执行上传、提交审核、审核状态查询、通知管理员、
  发布到知识库。触发词：审核 Wiki、通知管理员、发布 Wiki、上传文档、
  文档审核、知识库发布。
metadata:
  openclaw:
    requires:
      bins: [python3]
---

# Wiki 审核与发布

本 skill 处理已经生成好的 Wiki Markdown。

## 边界

- 可以上传 Markdown 文件。
- 可以提交审核、查询审核状态、通知管理员、发布到知识库。
- 不拉代码。
- 不调用 `code_to_wiki`。
- 不生成 Wiki Markdown。
- 不预配置 repositories。

如果用户还没生成 Wiki，先使用 `repo-code-analysis` skill 让 Agent 调用
`code_to_wiki` 的 Zread 模式。

## 渐进式读取

- 首次使用或鉴权失败：读 `references/auth-and-discovery.md`。
- 需要决定管理员/审核人：读 `references/reviewer-resolution.md`。
- 用户要提交审核：读 `references/submit-review.md`。
- 用户问审核进度：读 `references/review-status.md`。
- 用户要发布知识库：读 `references/publish.md`。

## 脚本入口

统一使用：

```bash
python3 middleware/openclaw/skills/byclaw-wiki-publish/scripts/wiki_review_publish.py <command>
```

命令：

- `submit-review`
- `review-status`
- `publish`
- `notify`

所有请求默认通过服务发现调用后端服务，认证头从 `BEYOND_TOKEN` 读取并写入
`Beyond-Token`。

## 重要原则

- 审核人不要让用户填机器人 webhook。用户可以填人、工号、邮箱、用户编码或环境变量名。
- 钉钉通知不在 skill 中写死机器人地址；通过后端通知接口或部署环境变量适配。
- 发布前优先查询审核状态；未通过审核不要发布，除非用户明确要求强制发布并具备权限。
