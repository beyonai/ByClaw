# Submit Review

提交审核前必须已经有 Markdown 文件。

## 命令

```bash
python3 middleware/openclaw/skills/byclaw-wiki-publish/scripts/wiki_review_publish.py submit-review \
  --document-title "项目 Wiki" \
  --markdown-file /absolute/path/to/wiki.md \
  --repository-url https://github.com/org/repo.git \
  --knowledge-base-id kb-code-001 \
  --reviewer wiki-admin \
  --notify
```

## 参数

- `--document-title` 必填。
- `--markdown-file` 和 `--markdown-text` 二选一；优先用文件。
- `--repository-url` 建议传，便于 reviewer 映射和审计。
- `--knowledge-base-id` 发布到知识库时建议传。
- `--reviewer` 可选；未传时按 reviewer 解析规则。
- `--notify` 可选；提交后通过通知接口提醒审核人。

## 输出

脚本输出 JSON：

```json
{
  "ok": true,
  "reviewId": "...",
  "reviewer": "...",
  "documentRef": "...",
  "upload": {},
  "submit": {},
  "notify": {}
}
```

把 `reviewId` 返回给用户，后续查询和发布会用到。
