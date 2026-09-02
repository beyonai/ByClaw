# IMA 知识库（ByClaw Runtime）

先遵守根 `SKILL.md` 的最高优先级约束：仅使用通用 `exec` 执行 `ima` CLI；所有支持 `--json` 的命令带 `--json`。

## 常用命令

```bash
# 搜索或列出知识库
ima wiki search-base "产品文档" --json
ima wiki search-base --json

# 浏览、搜索指定知识库
ima wiki list --kb <knowledge-base-id> --json
ima wiki search "排期" --kb <knowledge-base-id> --json

# 查看可写入的知识库
ima wiki list-addable --json

# 导入网页或文章
ima wiki import-urls --kb <knowledge-base-id> https://example.com/article --json

# 将已有笔记关联到知识库
ima wiki add-note --kb <knowledge-base-id> --doc <doc-id> --title "会议纪要" --json

# 上传本地文件
ima wiki upload --kb <knowledge-base-id> --file ./report.pdf --json
```

## 上传与写入规则

- ByClaw Runtime 单个上传文件上限为 **20 MiB**；超过限制时停止上传，并提示用户缩小或拆分文件。
- 上传前可运行本地预检；预检只校验文件，不发送 IMA 请求：

```bash
node skills/ima-skill/preflight-check.cjs --file ./report.pdf
```

- 上传、导入 URL 或关联笔记前，先明确目标知识库；用户未指定时用 `ima wiki list-addable --json` 获取候选项并请用户选择。
- 保持上传文件原样，不转换文件编码或内容。
- 命令必须通过退出码和 JSON 结果判定；认证失败或任一写操作失败时停止，不自动重试。
- 不向用户展示内部 ID、临时凭证、COS 凭证或其他敏感数据。

## 上游 API 参考（不可执行）

`references/api.md` 是随 npm 包保留的上游接口字段参考。ByClaw Runtime 中不得据此构造 HTTP 调用或使用 `ima_api`；仅使用本文件的 `ima wiki … --json` 命令。`scripts/cos-upload.cjs` 仅作为上游随附文件保留，不应由 ByClaw 对话工作流直接执行。
