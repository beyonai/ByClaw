# 百家号：视频、图文、文章与数据

适用于 `bycli baijiahao`。先 `bycli list -f json`，再读取目标命令的 `--help -f json`。浏览器路径遵守主 Skill 的 DSH 所有权、桥接与 STOP 规则，复用 `baijiahao.baidu.com` 当前账号登录态；不适用微信 Runner。

## 选择命令

| 内容 | 准备/发布/状态 | 已发表作品数据 |
| --- | --- | --- |
| 视频 | `video-publish` | `video-stats <管理ID>` |
| 图文 | `image-text-publish` | `image-text-stats <管理ID>` |
| 文章 | `article-publish` | `article-stats <管理ID>` |

三个发布命令共用 `--mode prepare/resume/reopen/submit/status`，默认 `prepare`。准备、恢复、重开或提交需要 `--execute`；只读 `status` 不需要。图文与文章共用后台 `news` 驱动，保留操作记录最初的 `contentKind`。

## 草稿准备与单次提交

遵守主 Skill 的三平台发布流程。先完成准备、保存并重开核对草稿，向用户展示后等待明确确认；之后才能单独提交。

```bash
# operation 父目录须已存在；此步不公开提交
bycli baijiahao video-publish --operation '<绝对路径/video.json>' \
  --title '<标题>' --file '<视频.mp4>' \
  --cover '<横封面.jpg>' --vertical-cover '<竖封面.jpg>' \
  --ai-generated yes --execute --timeout 300 --keep-tab true -f json

# 仅在用户确认当前已核对草稿后执行
bycli baijiahao video-publish --operation '<同一绝对路径/video.json>' \
  --mode submit --execute --user-confirmed -f json

# 后续只查询，不再次点击发布
bycli baijiahao video-publish --operation '<同一绝对路径/video.json>' --mode status -f json
```

视频 `--file` 为本地视频，须提供 `--vertical-cover`，横封面 `--cover` 可选。标题 2–50 字。文章和图文标题 2–64 字，正文用 `--file <UTF-8文本>` 或 `--text`，不含标题，最多 50000 字符；不转换 Markdown/HTML。有序配图使用 `--images '["/absolute/path/one.png", "/absolute/path/two.png"]'`，最多 20 张，图文至少一张，追加到正文末尾。图文准备还关闭自动生成播客。`--ai-generated yes/no` 须按实际填写，不能复制示例值代替判断。

文章/图文准备示例：

```bash
bycli baijiahao image-text-publish --operation '<绝对路径/news.json>' \
  --title '<标题>' --file '<正文.txt>' \
  --images '["/absolute/path/one.png","/absolute/path/two.png"]' \
  --cover '<封面.png>' --ai-generated yes --execute --keep-tab true -f json
```

同一作品始终复用 operation，不重传或重建未知草稿。中断后由 `--mode resume --execute` 在原会话续办；`reopen` 按保存的精确 ID 核对草稿。保存回执未知时，先核对管理列表的精确草稿 ID，再按需 `--mode resume --draft-id '<精确ID>' --execute`；不能按标题猜测或盲目重按保存。

`prepared` 仅表示草稿已核对；`submitted: true` 表示记录了一次提交尝试。`submission_unknown`、`verification_required`、验证码或提交后连接中断时保留现场；用户完成人工验证后只用 `--mode status` 核对，不重复提交。`published` 对应管理列表正式 `publish` 状态，`analyze` 等处理状态原样保留；`publicUrl` 需按实际返回及公开页核验，不能将编辑/预览链接称为公开链接。

## 数据口径

```bash
bycli baijiahao video-stats '<精确管理ID>' -f json
bycli baijiahao image-text-stats '<精确管理ID>' -f json
bycli baijiahao article-stats '<精确管理ID>' \
  --start-date '<YYYY-MM-DD>' --end-date '<YYYY-MM-DD>' -f json
```

`id` 是管理列表的精确作品 ID，`nid` 是内部内容 ID，二者以字符串保留且不可互换。数据只读本人已发表且身份/类型匹配的作品，视频读取 `plays`，图文/文章读取 `reads`，另有点赞、评论、收藏、分享。默认按作品发表日检索，自定义日期成对，最晚上海今日。草稿、无匹配记录或接口错误不是成功的全零数据。

保留 `observation.startDate/endDate/publishedAt/sampledAt` 和 `counterScope=as_returned`，不能据检索窗口声称计数为当日新增或累计结算。真实 `0` 保留；缺失指标是 `null` 并附 `unavailableMetrics`。

## 公开视频下载

```bash
bycli baijiahao video-download '<正式公开视频 URL>' --output '<授权目录>' --timeout 60 -f json
```

支持百家号 `/s?id=...`、`mbd.baidu.com/newspage/data/videolanding?nid=sv_...` 和好看 `/v?vid=...`，不限定本人账号。页面须有唯一可播放视频和媒体元数据；不接受草稿预览、私密/付费受限内容或歧义视频源。

返回 `sourceUrl`、绝对 `path`、`bytes`、`durationSeconds`、分辨率和 `sha256`，下载的是平台转码版本。同名文件已存在时拒绝覆盖；以实际文件存在、非空和返回元数据为交付依据。Node 下载网络与浏览器连接分别判断，失败不能称为已下载，不为此改变系统代理。
