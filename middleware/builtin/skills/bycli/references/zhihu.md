# 知乎：读取、草稿、发布与创作数据

适用于 `bycli zhihu`。先执行 `bycli list -f json`，再读取目标命令的 `--help -f json`。浏览器路径遵守主 Skill 的 DSH 所有权、桥接与 STOP 规则；登录域为 `www.zhihu.com`，文章编辑域为 `zhuanlan.zhihu.com`。以下仅列任务选择入口，实际安装帮助决定可用参数。

## 读取与互动

| 需求 | 命令 |
| --- | --- |
| 热榜、推荐、等你来答 | `hot`、`recommend`、`waiting` |
| 站内搜索 | `search <query> --type all/answer/article`，枚举以帮助为准 |
| 问题及回答 | `question <questionId>`、`answer-detail <target>`、`answer-comments <target>` |
| 收藏夹 | `collections`、`collection <collection_id>` |
| 导出文章 Markdown | `download --url <文章 URL> --output <授权目录>`；按需 `--download-images` |
| 关注、赞同、收藏、评论 | `follow`、`like`、`favorite`、`comment`；这些是账号写操作，仅在用户授权范围内执行 |

```bash
bycli zhihu search '检索词' --type answer --limit 20 -f json
bycli zhihu answer-detail 'https://www.zhihu.com/question/<问题ID>/answer/<回答ID>' -f json
bycli zhihu download --url 'https://zhuanlan.zhihu.com/p/<文章ID>' --output '<授权目录>' -f json
```

互动目标通常使用 `answer:<questionId>:<answerId>`，创作统计还接受 `answer:<answerId>`；不要将简写套用到未声明支持它的互动命令，按各命令帮助传递。所有 ID 保留为字符串。

## 平台草稿与发布

遵守主 Skill 的三平台发布流程：先执行准备，再展示并等待用户确认，提交命令不能和准备一起自动运行。

| 内容 | 准备命令 | 核对/提交命令 |
| --- | --- | --- |
| 文章 | `article-draft` | `article-publish --mode reopen/resume/repair-cover/submit` |
| 视频 | `video-draft <本地视频>` | `video-publish --mode reopen/submit` |
| 新回答 | `answer-submit <问题目标> --mode prepare` | `answer-submit --mode reopen/submit` |
| 仅新回答或已有回答的未发布编辑草稿 | `answer-waiting-draft` | 不发表；不能当作 `answer-submit` 的持久发布记录 |

文章正文、回答和视频介绍使用纯文本，`--text` 与 `--file` 二选一。文章 `--images` 是有序本地图片路径 JSON 数组，追加到正文末尾；`--cover` 为可选 PNG/JPEG。文章标题最多 100 字符，视频标题最多 80 字符。视频另须明确 `--original yes/no`、`--category <页面准确领域>`，用户处理协议；不能从文件来源推断原创。

以下路径替换为本任务授权路径，operation 的父目录须先创建：

```bash
# 准备并重开核对文章草稿；按真实内容设置 AI 声明
bycli zhihu article-draft --title '<标题>' --file '<正文.txt>' \
  --images '["/absolute/path/one.png","/absolute/path/two.png"]' \
  --cover '<封面.png>' --ai-generated yes \
  --operation '<绝对路径/article.json>' --execute --keep-tab true -f json

# 只有用户确认当前已核对草稿后，才单独执行
bycli zhihu article-publish --operation '<同一绝对路径/article.json>' \
  --mode submit --execute --user-confirmed -f json
```

视频准备使用 `video-draft '<视频.mp4>' --title '<标题>' --file '<介绍.txt>' --ai-generated yes --original no --category '<准确领域>' --operation '<video.json>' --execute --keep-tab true -f json`；回答准备使用 `answer-submit 'question:<问题ID>' --file '<回答.txt>' --ai-generated yes --operation '<answer.json>' --mode prepare --execute --keep-tab true -f json`。这些值均为示例，AI/原创选项须按实际修改。提交阶段分别改用对应发布命令并复用 operation。

`answer-submit` 保护已有回答、删除的回答及其他不同草稿，不自动覆盖。`answer-waiting-draft` 默认遇已有内容报错；只有用户明确要求合并/覆盖时才用其 `--existing append/prepend/replace`。旧 `answer` 直接发表入口已禁用，不把它当作绕过草稿确认的途径。

中断恢复以原 operation 为准：文章的 `resume`、`repair-cover`、`--repair-images` 会修改草稿，仅在需要且授权时选择；不自动重建。上传视频的真实平台类型可能是 `pin`，不能统一改成 `zvideo`。上传/草稿 ID 不代表正式作品 ID，提交未知时不重复发表。

## 状态与数据

```bash
# 本地快照，无需浏览器预检；不能证明远端状态
bycli zhihu content-status --operation '<原 operation.json>' -f json
# 精确远端核验，须走浏览器前置
bycli zhihu content-status --operation '<原 operation.json>' --target 'article:<真实作品ID>' -f json
bycli zhihu content-stats 'article:<真实作品ID>' --days 7 -f json
bycli zhihu content-stats '<裸作品ID>' --type pin \
  --start-date '<YYYY-MM-DD>' --end-date '<YYYY-MM-DD>' --aggregate period -f json
```

创作目标支持精确作品 URL、`article:<id>`、`answer:<id>`、`pin:<id>`、`zvideo:<id>`；裸 ID 必须带真实 `--type`。数据命令还支持后台数据 URL。远端核验分别观察 `creator_visible`、`public_visible`、`public_url` 与 `status`，不把后台存在当作公开可见。

`content-stats` 读取本人创作后台，默认最近 7 天，包含上海今日；`--days` 为 1–366，自定义起止日成对且最晚上海今日。`--aggregate cumulative` 是累计概览，`period` 是所选日趋势区间概览；保留 `aggregate_scope`、`overview`、`trend`、`content_mark` 与 `sampled_at`。浏览与播放按真实内容类型区分，缺失指标不能补零，也不能将别人的公开互动计数称为本人后台统计。
