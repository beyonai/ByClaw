---
name: podcast-video
description: >
  把幻灯片和播客配音合成为一个带字幕的视频，幻灯片随着对话内容自动切换，字幕逐句出现，是播客视频的最后一步。
  只要用户说合成视频、生成视频、把幻灯片和音频合在一起、加字幕、做成视频、最后一步，好了合成吧，
  或者前面几步都做完了想收尾，就应该触发此技能——即使用户只说"合成"也要触发。
compatibility: Requires ffmpeg, LibreOffice, Python PyMuPDF (pip install pymupdf)
---

# 视频合成

将 PPTX + 音频 + 脚本合成为 1920×1080 MP4，是播客视频流水线的最后一步。

幻灯片切换的精度取决于上游两步的输出质量：`/podcast-script` 在每条对话上标注了幻灯片编号，`/podcast-voice` 以 `--sentence-mode` 生成了句子级时间戳——两者结合，才能让每张幻灯片在正确的时刻切换、每条字幕在正确的句子出现。

## 项目目录管理

所有产物统一存放在：
```
<当前工作空间>/podcast-projects/<项目名>/v<N>/final.mp4
```

`<当前工作空间>` 是调用此技能时所在的目录。播客视频流水线中的所有技能建议在同一个目录下调用，确保 `podcast-projects/` 始终在同一位置。

**确定项目：** 扫描 `podcast-projects/` 目录，找到含 `presentation.pptx` 和 `podcast.mp3` 的项目，向用户确认后继续。

**自动版本：** 读取 `<项目名>/current.txt`：
- `final.mp4` **已存在**于当前版本 → 创建 vN+1/ 目录，复制现有产物，再写入本次视频，更新 `current.txt`
- `final.mp4` **不存在** → 直接写入当前版本，成功后更新 `current.txt`

## 前置检查

这些依赖缺少任何一个都会导致合成失败，而合成过程可能耗时数分钟，提前验证能节省时间：

- [ ] `presentation.pptx` 存在于项目版本目录
- [ ] `podcast.mp3` 存在于项目版本目录
- [ ] `ffmpeg` 和 `ffprobe` 可用：`ffmpeg -version && ffprobe -version`
- [ ] `libreoffice` 可用：`libreoffice --version`（用于将 PPTX 转为图片）
- [ ] `pymupdf` 已安装：`python -c "import fitz"`

若 `podcast_durations.json` 不存在，不阻断合成，但要告知用户同步质量会降低（见下方同步质量对照表）。

**跨文件一致性校验**（三者任一不一致立即报警，不进入合成）：

用 `python -m markitdown presentation.pptx` 提取 PPTX 实际幻灯片数，与以下两个来源对比：
- `slide-outline.json` 中的 `meta.total_slides`
- `podcast-script.json` 中所有 `"slide"` 字段的最大值

三个数必须相等。不一致时说明上游某步生成有误，告知用户具体差异并指明需要重新运行哪个步骤（幻灯片数少 → 重跑 `/slide-deck`；脚本 slide 最大值偏小 → 重跑 `/podcast-script`）。

---

## 同步质量对照

上游文件的完整性直接决定视频质量：

| 脚本有幻灯片注解 | 时间戳文件 | 幻灯片时序 | 字幕精度 |
|---|---|---|---|
| ✅（sentence-mode）| ✅ 句子级 | **精确** | **逐句精确** |
| ✅ | ✅ 轮次级 | **精确** | 轮次内按字数比例 |
| ❌ | ✅ | 均分（不准） | 轮次精确 |
| ❌ | ❌ | 均分（不准） | 仅按字数估算 |

获得最佳效果的路径：`/podcast-script`（输出含幻灯片编号注解）+ `/podcast-voice --sentence-mode`（输出句子级时间戳）→ `/podcast-video`。

## 运行命令

`<skill-dir>` 是本 SKILL.md 所在的目录，运行前根据实际加载路径替换。

```bash
python <skill-dir>/scripts/assemble.py \
  --pptx    podcast-projects/<项目名>/v<N>/presentation.pptx \
  --audio   podcast-projects/<项目名>/v<N>/podcast.mp3 \
  --output  podcast-projects/<项目名>/v<N>/final.mp4 \
  --script  podcast-projects/<项目名>/v<N>/podcast-script.json \
  --timing  podcast-projects/<项目名>/v<N>/podcast_durations.json
```

`--script` 和 `--timing` 是可选参数——省略 `--script` 时不生成字幕；省略 `--timing` 时字幕按字数比例分配。

## 字幕规格

- 每段 ≤22 字，在自然句子边界断开
- 位置：底部居中，距底 55px
- 样式：白色文字，黑色描边（硬编码烧录到视频中）

## 依赖安装

| 工具 | Ubuntu/Debian | macOS |
|------|---------|---------|
| ffmpeg | `apt install ffmpeg` | `brew install ffmpeg` |
| libreoffice | `apt install libreoffice` | `brew install --cask libreoffice` |
| pymupdf | `pip install --break-system-packages pymupdf` | `pip install pymupdf` |

脚本在运行时会检测缺失的依赖并打印安装提示。

---

## 产物校验

合成完成后验证最终产物：

- [ ] `podcast-projects/<项目名>/v<N>/final.mp4` 存在
- [ ] 视频时长与 `podcast.mp3` 时长误差 < 2 秒：`ffprobe -i final.mp4 -show_entries format=duration`
- [ ] 分辨率为 1920×1080：`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv final.mp4`
- [ ] 若存在 `podcast_durations.json`，验证其所有 `duration` 之和与 MP3 实际时长误差 < 2 秒——差值过大说明时间戳文件与音频不匹配，视频字幕和幻灯片切换会整体漂移

## 反问清单

| 缺失情况 | 标准反问 |
|---|---|
| 无 `presentation.pptx` | "未找到幻灯片文件，请先运行 `/slide-deck`，或提供 PPTX 文件路径。" |
| 无 `podcast.mp3` | "未找到音频文件，请先运行 `/podcast-voice`，或提供 MP3 文件路径。" |
| 无时间戳文件 | "未找到时间戳文件，幻灯片将均分时长，字幕精度会降低。是否仍然继续合成？" |
| `libreoffice` 未安装 | "需要安装 LibreOffice（用于将幻灯片转为图片）：`apt install libreoffice`（Linux）或 `brew install --cask libreoffice`（macOS）。" |
| 用户未指定项目 | "请告诉我要合成哪个播客项目，或分别提供 PPTX 和 MP3 的完整路径。" |
