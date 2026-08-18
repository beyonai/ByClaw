# 社交媒体与社区

按 By-Reach 路由表选择一次首选执行器。只有失败、空结果、挑战页、畸形结果或无意义结果时，才允许一次列出的 byCLI 兜底；其后停止。

| 平台 | 首选 | 仅允许的兜底 |
| --- | --- | --- |
| Twitter/X | `twitter-cli` | `bycli twitter search` |
| Reddit | `rdt-cli` | `bycli reddit search` |
| Bilibili | `bili-cli` | `bycli bilibili search` |
| V2EX | 打包 API channel | `bycli v2ex hot` |
| Xueqiu | 打包 API channel | `bycli xueqiu search` |
| Facebook、Instagram、LinkedIn、小红书 | byCLI | 无 |

对具体 URL、页面、帖子或主页的读取，一律加载 `bycli` skill。不要替换为另一种 CLI、API 或网页读取工具。
