# Publish

发布前默认会查询审核状态。只有状态在已通过集合里才发布。

默认已通过状态：

```text
approved,audit_pass,pass,passed
```

可用环境变量覆盖：

```bash
export WIKI_REVIEW_APPROVED_STATUSES=approved,audit_pass
```

## 命令

```bash
python3 middleware/openclaw/skills/byclaw-wiki-publish/scripts/wiki_review_publish.py publish \
  --review-id REVIEW_ID \
  --knowledge-base-id kb-code-001
```

如果用户明确要求强制发布，并且确认有权限：

```bash
python3 middleware/openclaw/skills/byclaw-wiki-publish/scripts/wiki_review_publish.py publish \
  --review-id REVIEW_ID \
  --knowledge-base-id kb-code-001 \
  --force
```

## 注意

- 不要绕过审核状态直接发布，除非用户明确说强制发布。
- 如果没有 `WIKI_REVIEW_STATUS_PATH`，脚本无法预检状态；此时不要强行发布，除非用户确认。
- 发布成功后把知识库 ID、reviewId 和后端返回结果摘要告诉用户。
