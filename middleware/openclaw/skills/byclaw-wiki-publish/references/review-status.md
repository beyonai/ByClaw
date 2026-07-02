# Review Status

查询审核状态：

```bash
python3 middleware/openclaw/skills/byclaw-wiki-publish/scripts/wiki_review_publish.py review-status \
  --review-id REVIEW_ID
```

输出 JSON 中常见字段：

- `status`
- `review`

如果后端返回的状态字段名称不同，脚本会尝试从常见字段中提取：

- `status`
- `reviewStatus`
- `auditStatus`
- `state`

Agent 给用户回复时只需要说明：

- 当前是否已通过
- 审核人是谁
- 下一步是否可以发布知识库
