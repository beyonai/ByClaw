# 视频与播客

YouTube 首选 `yt-dlp` 提取字幕或媒体元数据；Bilibili 首选 `bili-cli`。两者首选执行器失败、结果无意义或不完整时，才允许一次对应 byCLI 兜底：`bycli youtube search` 或 `bycli bilibili search`。

打开或读取视频页面、评论、频道、详情页或 URL 时，加载并遵循 `bycli` skill；byCLI 失败即停止。

小宇宙音频转写使用 By-Reach：

```bash
by-reach transcribe "URL" -o /tmp/transcript.txt
```

配置由 `by-reach configure` 写入 `~/.by-reach/`；镜像中不得在任务时安装或升级 By-Reach。
