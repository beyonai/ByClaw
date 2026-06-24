---
name: podcast-voice
description: >
  用火山引擎（豆包）语音合成将播客对话脚本转成双声道音频，主持人和嘉宾各用一个声音，
  同时生成精确到每个句子的时间信息，供视频合成使用。
  只要用户想给脚本配音、生成播客音频、把对话变成声音、生成语音、脚本转音频，
  或者正在做播客视频需要录音，就应该触发此技能——即使用户只说"配音"或"生成音频"也要触发。
compatibility: Requires Python, ffmpeg, Volcengine/Doubao TTS API key (VOLCENGINE_TTS_API_KEY or DOUBAO_API_KEY)
---

# 播客配音生成

将播客脚本 JSON 转为双声道 MP3，同时生成句子级时间戳 JSON。时间戳是下游 `/podcast-video` 精确计算幻灯片切换和字幕出现时机的关键——没有它，幻灯片只能均分时长，字幕也会失去逐句同步的精度。

## 项目目录管理

所有产物统一存放在：
```
<当前工作空间>/podcast-projects/<项目名>/v<N>/
  podcast.mp3
  podcast_durations.json
```

`<当前工作空间>` 是调用此技能时所在的目录。播客视频流水线中的所有技能建议在同一个目录下调用，确保 `podcast-projects/` 始终在同一位置。

**确定项目：** 扫描 `podcast-projects/` 目录，找到含 `podcast-script.json` 的项目，向用户确认后继续。

**自动版本：** 读取 `<项目名>/current.txt`：
- `podcast.mp3` **已存在**于当前版本 → 创建 vN+1/ 目录，复制现有产物，再写入本次音频，更新 `current.txt`
- `podcast.mp3` **不存在** → 直接写入当前版本，成功后更新 `current.txt`

段落缓存存放在 `/tmp/volcengine-tts-cache/`（不纳入版本管理），重跑时自动复用已成功的片段。

## 前置检查

TTS 调用有成本，提前发现问题可以避免浪费 API 额度。在调用 API 之前，逐项确认：

- [ ] `VOLCENGINE_TTS_API_KEY` 或 `DOUBAO_API_KEY` 已设置（`echo $VOLCENGINE_TTS_API_KEY`）
- [ ] 项目版本目录下存在 `podcast-script.json` 且 `script` 数组非空
- [ ] `ffmpeg` 可用：`ffmpeg -version`
- [ ] `requests` 包已安装：`python -c "import requests"`（未安装则 `pip install requests`）

---

## 运行命令

`<skill-dir>` 是本 SKILL.md 所在的目录，运行前根据实际加载路径替换。

```bash
python <skill-dir>/scripts/generate_audio.py \
  --script  podcast-projects/<项目名>/v<N>/podcast-script.json \
  --output  podcast-projects/<项目名>/v<N>/podcast.mp3 \
  --sentence-mode \
  --concurrency 8 \
  --host-voice  zh_male_dayi_uranus_bigtts \
  --guest-voice zh_female_vv_uranus_bigtts \
  --cache-dir   /tmp/volcengine-tts-cache
```

`--sentence-mode` 是视频合成的必要条件——它把时间戳精度从"每个对话轮次"提升到"每个句子"，这样字幕才能逐句精确出现，幻灯片切换也能与说话内容完全对齐。

## API 配置

**新版控制台（推荐）：**
```
X-Api-Key: <api-key>
X-Api-Resource-Id: seed-tts-2.0
```
Endpoint: `https://openspeech.bytedance.com/api/v3/tts/unidirectional`

**旧版控制台：**
```
X-Api-App-Id: <app-id>
X-Api-Access-Key: <access-token>
X-Api-Resource-Id: <resource-id>
```

环境变量优先级：`VOLCENGINE_TTS_API_KEY` = `DOUBAO_API_KEY` > 旧版三件套。`VOLCENGINE_TTS_RESOURCE_ID` 默认 `seed-tts-2.0`，无需改动除非用户需要其他声音家族。

## 输出格式

`podcast_durations.json` 的结构（`/podcast-video` 依赖此格式）：

```json
[
  {
    "index": 0,
    "turn_index": 0,
    "sentence_index": 0,
    "role": "host",
    "slide": 1,
    "text": "欢迎收听今天的节目。",
    "duration": 2.18,
    "start": 0.0
  }
]
```

## 并发与限流策略

默认 8 并发，在以下情况适当降低：
- 账号返回 `quota exceeded for types: concurrency` → 依次降到 `4`、`2`、`1`，重试
- 段落合成失败 → 立即停止整个流程，不静默跳过（保证输出完整性）
- 已缓存的段落不消耗 API 并发，重跑速度快

## 常见错误

| 错误 | 原因 | 解决 |
|---|---|---|
| `quota exceeded for types: concurrency` | 并发限流 | 降低 `--concurrency` 后重试 |
| `speaker permission denied` | 声音未开通或 resource-id 不匹配 | 确认控制台已开通该声音，检查 `--resource-id` |
| `resource ID is mismatched` | 声音与 resource-id 不匹配 | 用 `seed-tts-2.0` 配合 2.0 系列声音 |
| `TTSExceededTextLimit` | 单段文本过长 | 已使用 `--sentence-mode`；若仍触发，加 `--max-chars 200` |

---

## 产物校验

合成完成后验证，确保下游 `/podcast-video` 能正常使用这些文件：

- [ ] `podcast.mp3` 存在且时长 > 0 秒：`ffprobe -i podcast.mp3 2>&1 | grep Duration`
- [ ] `podcast_durations.json` 存在
- [ ] `podcast_durations.json` 的条目数与 `podcast-script.json` 中的 script turns 总数一致
- [ ] 所有条目包含 `start`、`duration`、`slide`、`role`、`text` 字段
- [ ] 所有条目的 `duration > 0`——零值表示该片段 TTS 合成失败，会导致后续所有字幕时间戳整体漂移，必须重新生成该片段
- [ ] 时间戳连续性：对每对相邻条目检查 `entry[i+1].start ≈ entry[i].start + entry[i].duration`，误差超过 0.5 秒说明存在时间断层（通常是拼接逻辑 bug），列出具体位置后报警

## 反问清单

| 缺失情况 | 标准反问 |
|---|---|
| 无 API Key | "请设置环境变量 `VOLCENGINE_TTS_API_KEY`（从火山引擎控制台获取），或提供 `DOUBAO_API_KEY`。" |
| 无播客脚本 | "未找到播客脚本，请先运行 `/podcast-script`，或提供现有脚本文件的路径。" |
| `ffmpeg` 未安装 | "需要安装 ffmpeg：`apt install ffmpeg`（Ubuntu/Debian）或 `brew install ffmpeg`（macOS）。" |
| 用户未指定项目 | "请告诉我要继续哪个播客项目，或提供脚本文件的完整路径。" |
