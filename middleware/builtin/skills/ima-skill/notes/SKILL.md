# IMA 笔记（ByClaw Runtime）

先遵守根 `SKILL.md` 的最高优先级约束：仅使用通用 `exec` 执行 `ima` CLI；所有支持 `--json` 的命令带 `--json`。

## 常用命令

```bash
# 标题搜索
ima note search --title "会议纪要" --json

# 正文搜索
ima note search --content "项目排期" --json

# 列出笔记本和笔记
ima note list-folders --json
ima note list --json

# 读取笔记正文
ima note get <doc-id> --json

# 创建新笔记
ima note create "# 标题\n\n正文" --json

# 向已明确指定的笔记追加内容
ima note append <doc-id> "\n补充内容" --json
```

## 行为规则

- 用户明确说“新建/创建笔记”时使用 `ima note create --json`。
- 用户明确指定目标笔记且要求追加时，才使用 `ima note append --json`；目标不明确时先询问，不得猜测。
- 笔记内容属于用户隐私；群聊中仅展示标题和摘要，不展示正文。
- 每个命令均以退出码和 JSON 结果判断成功。认证失败或写操作失败时停止，不自动重试。

## 上游 API 参考（不可执行）

`references/api.md` 是随 npm 包保留的上游接口字段参考。ByClaw Runtime 中不得据此构造 HTTP 调用或使用 `ima_api`；仅使用本文件的 `ima note … --json` 命令。
