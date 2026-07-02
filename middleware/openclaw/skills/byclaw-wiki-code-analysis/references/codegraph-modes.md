# CodeGraph Modes

`code_to_wiki` 的 CodeGraph 模式用于快速分析仓库代码。

## 通用参数

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "mode": "explore",
  "question": "这个项目的认证流程怎么走？"
}
```

字段说明：

- `repositoryUrl` 必填。
- `branch` 可选；不填时使用远端默认分支。
- `gitDepth` 可选；默认 1。
- `refresh` 可选；只有用户要求更新代码时才设为 true。
- `credentialRef` 可选；用于私有 HTTPS 仓库。

## 模式选择

`explore`：
适合开放式问题，例如“帮我分析这个项目”“登录流程怎么走”“核心架构是什么”。

`query`：
适合找符号、类名、函数名、接口名。

`node`：
适合读某个文件或符号的上下文。

`files`：
适合先看目录结构；可配 `filter` 和 `maxDepth`。

`callers` / `callees` / `impact`：
适合追调用方、被调用方和改动影响。优先传 `symbol`，也可传 `target`。

`pull`：
用户明确要求重新拉代码或更新缓存时使用。它会 clone/fetch/pull 并同步 CodeGraph。

`status`：
检查仓库是否已经缓存、是否完成 CodeGraph 索引、是否已有 Zread Wiki。

## 注意

- 不需要提前问用户仓库是否已配置；仓库由本次请求参数决定。
- 不要因为“可能不是最新”就主动刷新；除非用户要求更新或 pull。
- CodeGraph 输出是分析依据，回答时要把结论转成用户能理解的结构化说明。
