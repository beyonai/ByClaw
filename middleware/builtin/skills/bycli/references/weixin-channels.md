# 视频号：发布、状态与统计

适用于 `bycli weixin-channels`，先读 [weixin.md 的视频号执行与鉴权](./weixin.md#视频号执行与鉴权)。复用 `channels.weixin.qq.com` 视频号助手登录态，不能使用公众号 token、Cookie 环境变量或 `--auth-source`。初次执行先 `bycli list -f json` 并读取目标命令的 `--help -f json`；认证等待与 confirmed-rerun 按原 Gate 规则，不再发现命令、做桥接或页面预检。已有适配器管理 TAB，不预开 raw browser 会话。

## 执行入口

独立 browser-backed 命令一律经过本 Skill 的 `scripts/weixin-browser-runner.mjs`；Runner 支持下表八条命令，按命令核对 read/write、域和 browser 元数据。示例中 `BYCLI_SKILL_DIR` 指向当前加载的 Skill 真实目录，`--state-dir` 是当前任务内的绝对状态目录，不填凭据。

```bash
BYCLI_SKILL_DIR='<本 skill 的绝对目录>'
node "${BYCLI_SKILL_DIR}/scripts/weixin-browser-runner.mjs" \
  --state-dir '<当前任务绝对路径/gate>' -- \
  bycli weixin-channels video-stats '<精确数字或 export/... ID>' \
  --site-session persistent --keep-tab true -f json
```

`video-status` 不带 `--id`、`--management-id`、`--inspect-editor` 时只读本地 operation，直接调用，不做浏览器预检；带其中任一参数时经过 Runner，并在 Runner 的 `--` 前加 `--selected-mode browser`。其 conditional 元数据不能当作未知浏览器能力绕过 Runner。

| 命令 | 用途与日期口径 |
| --- | --- |
| `overview` | 账号概览，默认上海昨日 |
| `trend` | 账号逐日指标，默认最近 7 天，截至昨日 |
| `sources` | 来源汇总与播放占比，默认最近 7 天，截至昨日 |
| `posts` | 作品发布时间窗口，默认最近 30 天截至昨日、最多 20 条；返回累计指标 |
| `post-detail <数字objectId>` | 作品概览、趋势、来源、逐日来源明细和留存，默认最近 7 天截至昨日 |
| `video-stats <id>` | 单视频当前累计指标，含今日已发表作品；不依赖 operation |
| `video-publish` | 上传、保存并重开核对草稿；用户确认后单次提交，write |
| `video-status --operation <记录>` | 本地快照、原编辑页只读检查，或精确 ID 远端核验，read |

以上是已实现命令指引，不能代替实际安装能力发现。视频号没有在本 Skill 中提供视频下载能力。

## 发布与恢复

遵守主 Skill 的三平台发布流程；以下准备和提交是分开的调用，不能合并成无人确认的脚本。operation 父目录须存在，同一作品始终使用原记录。

```bash
# 上传、保存并按草稿回执重开核对；不发表
node "${BYCLI_SKILL_DIR}/scripts/weixin-browser-runner.mjs" \
  --state-dir '<当前任务绝对路径/gate>' -- \
  bycli weixin-channels video-publish '<视频.mp4>' \
  --description '<完整描述>' --ai-generated yes \
  --cover '<横封面.jpg>' --vertical-cover '<竖封面.jpg>' \
  --operation '<绝对路径/video.json>' --timeout 300 --execute \
  --site-session persistent --keep-tab true --window foreground -f json

# 向用户展示当前已核对草稿，得到明确发布确认后才单独执行
node "${BYCLI_SKILL_DIR}/scripts/weixin-browser-runner.mjs" \
  --state-dir '<同一任务绝对路径/gate>' -- \
  bycli weixin-channels video-publish --operation '<同一绝对路径/video.json>' \
  --mode submit --execute --user-confirmed --timeout 300 \
  --site-session persistent --keep-tab true -f json
```

`--description` 与 `--ai-generated yes/no` 为 prepare 必填，按实际素材填写。`--cover` 是分享卡片 4:3 横封面，`--vertical-cover` 是个人主页 3:4 竖封面，均接受 PNG/JPEG；未提供时保留平台默认。准备会选择视频、填写描述、设置 AI 标注、保存平台草稿并重开核对。协议、原创或验证码需要人工处理时停止。

`prepared` 表示草稿已保存、重开核对且可提交；`draft_saved` 表示已保存但还不能提交；`draft_save_unknown` 不允许盲目重存。`submitted` 只说明页面提示提交成功；`submit_unknown` 或 `submitted=true` 后不能再点击发表。`requires_user_action` 须结合 submitted 区分提交前后。只有精确远端匹配后才报告后台 `published`，公开 URL 是否可访问须另外核实。

恢复只在当前命令帮助支持的模式下执行：`resume` 恢复原记录或重开已保存草稿；`adopt-draft` 核验已有草稿，须提供精确 `--draft-id 'export/...'`、完整描述、AI 标注及已核对的 `--editor-page` / `--editor-session`；`recover` 核验重启后的预览；`retry-upload` 是显式重传，须原文件哈希匹配且页面为空，不自动触发。绑定页是这些命令的专用恢复入口，不允许用 raw browser 管理普通 Adapter TAB。遇锁、未知结果或状态不符先停止，不删记录/锁或换目录规避。

## 核验状态与即时数据

```bash
# 本地快照，直接执行，不启动浏览器；不是远端发表证明
bycli weixin-channels video-status --operation '<原 operation.json>' -f json

# 浏览器远端核验，用真实管理 ID；不接受日期参数
node "${BYCLI_SKILL_DIR}/scripts/weixin-browser-runner.mjs" \
  --state-dir '<当前任务绝对路径/gate>' --selected-mode browser -- \
  bycli weixin-channels video-status --operation '<原 operation.json>' \
  --management-id 'export/<真实管理ID>' --site-session persistent --keep-tab true -f json
```

`--id <数字统计ID>`、`--management-id <export/...>`、`--inspect-editor` 互斥；不按描述猜 ID，也不把两个 ID 域直接互转。`--inspect-editor` 只读原编辑页的文件、描述、预览、封面及 AI 标注，不上传或提交。原编辑页仍打开时，数字 ID 核验会拒绝导航去统计页，使用独立只读统计命令查询，不擅自关闭草稿页。

`video-stats` 按精确数字 ID 或已发表管理 ID 返回 `plays`、`recommendations`、`likes`、`comments`、`shares` 及 `sampled_at`。管理通道累计数据与截至昨日的日统计是两种口径，后者未结算不能推断今日发表失败。`collections=null`、`unavailable_metrics.collections=not_exposed_by_verified_backend` 表示没有已核实的独立收藏字段，不能把喜欢当收藏或补零。

## 原有统计口径与采集委派

前五条命令的自定义日期成对，最晚上海昨日，窗口最多 366 天，`--days` 与自定义日期互斥；`posts --limit` 为 1–1000。数字 objectId 原样保留为字符串，不经 JavaScript Number 转换。

`views` 是播放，`recommendations` 是推荐，`likes` 是喜欢；`shares` 是后台分享汇总，不能再叠加各分享渠道。每日统计可能含扣除取消行为后的负净值，保留原值；`posts` 的累计数不能直接与账号日统计对账。`completion_rate` 和留存百分数以实际输出为准，平均时长单位为秒。

`post-detail` 返回对象数组，完整保留 `overview`、`trend`、`sources`、`data_details` 和 `retention` 嵌套 JSON，留存的 second 是视频进度，不是日历时间。真实零与缺失 null 分开。

由 `knowledge-collection` 归档的原有统计采集使用其 `acquire-weixin-channels`，不要外套 Runner、扩大该编排入口的能力或重复采集成功前缀。新增发布、单视频累计指标和状态查询按本 reference 的独立入口执行，不能假设采集编排器已支持全部八条命令。登录暂停与确认重跑按 [weixin.md](./weixin.md)；发布确认 `--user-confirmed` 与人工验证完成 `--verification-confirmed true` 是不同授权，不能互相替代。
