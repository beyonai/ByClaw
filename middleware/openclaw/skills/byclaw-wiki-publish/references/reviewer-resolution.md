# Reviewer Resolution

审核人应是平台能识别的人或角色，而不是钉钉机器人地址。

## 优先级

1. 命令行 `--reviewer`
2. 命令行 `--reviewer-ref` 指向的环境变量值
3. `WIKI_REVIEW_REPOSITORY_REVIEWERS` 中按仓库 URL 匹配
4. `WIKI_REVIEW_KB_REVIEWERS` 中按知识库 ID 匹配
5. `WIKI_REVIEW_DEFAULT_REVIEWER`

## reviewer 的可接受形式

具体由后端决定，通常可以是：

- 用户编码
- 工号
- 邮箱
- 平台用户 ID
- 审核角色编码

不要要求用户填写钉钉机器人 webhook。

## 映射配置

按仓库：

```bash
export WIKI_REVIEW_REPOSITORY_REVIEWERS='{
  "https://github.com/org/repo.git": "zhangsan"
}'
```

按知识库：

```bash
export WIKI_REVIEW_KB_REVIEWERS='{
  "kb-code-001": "wiki-admin"
}'
```

默认审核人：

```bash
export WIKI_REVIEW_DEFAULT_REVIEWER=wiki-admin
```

如果仍然解析不到审核人，向用户询问“审核人/管理员在平台里的用户编码或邮箱是什么”。
