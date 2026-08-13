# 视频/播客

YouTube、B站、小宇宙播客的字幕和转录。

## YouTube

视频搜索、元数据、评论、频道和具体页面读取必须加载 `bycli` skill，使用 YouTube Adapter；缺失时使用 `bycli browser`。
只有不打开或读取网页正文的字幕/媒体转录任务可以使用下列媒体工具。

### 下载字幕

```bash
# 下载字幕 (不下载视频)
yt-dlp --write-sub --write-auto-sub --sub-lang "zh-Hans,zh,en" --skip-download -o "/tmp/%(id)s" "URL"

# 然后读取 .vtt 文件
cat /tmp/VIDEO_ID.*.vtt
```

> **字幕注意**: 手动上传的字幕提取可靠；自动生成字幕可能存在行间重复，需后处理。

### 无字幕兜底：Whisper 音频转写

```bash
# 视频没有字幕时的兜底：下载音频并用 Whisper 转写（Groq 免费 key 即可）
agent-reach transcribe "https://www.youtube.com/watch?v=VIDEO_ID"
agent-reach transcribe ./local_audio.mp3 -o /tmp/transcript.txt
```

> 需要先配置 key：`agent-reach configure groq-key gsk_xxx`（免费，console.groq.com）
> 或 `agent-reach configure openai-key sk-xxx`。默认 auto 模式：groq 失败自动降级 openai。

## B站 / Bilibili

> ⚠️ **不要用 yt-dlp 读 B站**：B站风控已全面 412 拦截 yt-dlp（实测最新版、直连/代理/带 Cookie 全部无效）。yt-dlp 只用于 YouTube。

### 字幕和媒体转录

视频详情、搜索、热门、排行、评论和具体页面读取使用 byCLI。只有不读取网页正文的音频提取可以使用 bili-cli：

```bash
# 下载音频并切分为 ASR-ready WAV（无字幕时配合 agent-reach transcribe 转写）
bili audio BVxxx
```

### 字幕（byCLI，需要浏览器时复用登录态）

```bash
bycli list -f json
# 根据发现结果使用 Bilibili Adapter；涉及具体页面且 Adapter 缺失时遵循 bycli browser 流程
```

### Adapter 缺失

加载并遵循 `bycli` skill，使用 `bycli browser`；不得以搜索 API 直连、`web_fetch` 或直接 HTTP 作为兜底。

> 不在任务中自动安装或升级 bili-cli；不可用时停止媒体提取并报告。

## 小宇宙播客 / Xiaoyuzhou Podcast

### 转录单集播客（可选 --polish 增强标点）

```bash
# 输出 Markdown 文件到 /tmp/。--polish 让 Llama 3.3 70B 给文稿补中文标点+合理分段
~/.agent-reach/tools/xiaoyuzhou/transcribe.sh --polish "https://www.xiaoyuzhoufm.com/episode/EPISODE_ID"
```

> 转写 prompt 已要求 Whisper 输出中文标点；若标点效果仍不理想，可加 `--polish` 用 Groq 上免费的 Llama 3.3 70B 补标点+合理分段（9 分钟播客约多 ~7 秒）。每次转写多一轮 LLM 调用，按需使用。

### 前置要求

1. **ffmpeg**: `brew install ffmpeg`
2. **Groq API Key** (免费): https://console.groq.com/keys
3. **配置 Key**: `agent-reach configure groq-key YOUR_KEY`
4. Agent Reach 由镜像固定安装，不在任务中执行安装或更新。

### 检查状态

```bash
byclaw-capability-doctor
```

> 输出 Markdown 文件默认保存到 `/tmp/`。

## 选择指南

| 场景 | 推荐工具 |
|-----|---------|
| YouTube 字幕 | yt-dlp |
| YouTube/B站视频详情、搜索、评论或页面 | byCLI Adapter；缺失时使用 `bycli browser` |
| B站字幕 | byCLI Bilibili Adapter；缺失时使用 `bycli browser` |
| 播客转录 | 小宇宙 transcribe.sh |
| 无字幕音视频 | agent-reach transcribe（B站音频先 `bili audio`） |
