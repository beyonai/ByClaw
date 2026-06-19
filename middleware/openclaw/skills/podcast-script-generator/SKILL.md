---
name: podcast-script-generator
description: Generates natural two-person podcast dialogue scripts (host + guest) from any input — topic keywords, article/blog text, or pre-extracted URL content. Use this skill whenever the user wants to create a podcast script, generate two-person dialogue for audio, convert an article/topic into conversational format, or needs structured speaker turns for TTS synthesis. Trigger on phrases like: "播客脚本", "对话脚本", "做成播客", "生成播客对白", "podcast script", "generate dialogue", "two-person podcast", "双人播客", "把文章做成对话", "帮我写播客", "audio script", etc. Even if the user doesn't say "podcast" explicitly — if they want to transform content into a two-person conversational format for audio output, trigger this skill.
---

# Podcast Script Generator

You're generating a two-person podcast dialogue that will be fed into a TTS system to produce real audio. Think about the best podcast conversations you know — ones where the back-and-forth feels genuinely alive, where both speakers have real presence. That's the target quality.

## The Two Roles

- **host**: Leads the conversation. Sets the agenda, asks questions, guides transitions, keeps the listener oriented. The host gives the episode its shape.
- **guest**: Brings the depth. Provides analysis, examples, personal perspective, and occasional pushback. The guest gives the episode its substance.

Neither role is passive. The host shouldn't just read questions; the guest shouldn't just recite facts. A good podcast feels like two curious people genuinely thinking through something together.

## Understanding the Input

Before writing anything, figure out what you've been given:

- **Topic keyword(s) only** (e.g., "AI写作工具", "remote work culture"): You'll need to generate the substance yourself. Think: what are the key tensions, recent developments, counterintuitive angles, and concrete examples that would make this interesting?
- **Long article or text**: Extract the core insights and non-obvious points. Strip filler. Use the ideas as raw material, not as a script to read aloud.
- **URL**: If the user provides a URL without extracted text and you have web access, fetch it. If not, ask the user to paste the content.
- **Mixed input**: Use everything provided.

## Conversation Structure

Build the script as a natural four-part arc. These aren't rigid sections with headers — they flow into each other:

1. **Opening** (~10–15% of script): Host introduces the topic and why it matters *right now*. Guest gives a first take that immediately signals depth — something that makes the listener think "oh, I haven't heard it framed that way before."

2. **Core Discussion** (~50–60%): Go deep on each point before moving to the next. The worst podcast mistake is touching ten things shallowly. Pick 2–4 key ideas and actually explore them — with examples, analogies, surprising details.

3. **Interactive Segment** (~15–20%): The conversation gets more dynamic. Host challenges an assumption, guest pushes back or adds nuance, they disagree (respectfully) on something. This is where the dialogue becomes most alive. **The guest must have at least 2 substantive, non-trivial exchanges here** — not "great point" filler, but real engagement.

4. **Closing** (~10–15%): Crystallize the 1–2 things the listener should walk away thinking about. End memorably — a provocative question, a concrete call to action, or a surprising reframe.

## Language and Register

- Match the user's input language by default (Chinese in → Chinese out, English in → English out)
- If the user explicitly specifies a language, use that
- **Critical**: Write for the ear, not the eye. In Chinese, use 口语化 (conversational, spoken-word) register — avoid 书面语. In English, use natural speech rhythms, contractions, and sentence fragments where appropriate. Read each line aloud mentally — if it sounds like an essay, rewrite it.

## TTS Text Normalization

The `text` field in every script turn goes **directly into a TTS engine**. Many TTS models cannot reliably interpret punctuation symbols in non-sentence roles. Before writing any turn, mentally convert:

| Pattern | Example | Chinese output | English output |
|---|---|---|---|
| Version numbers | `v1.1.1` | `v1点1点1` | `v1 dot 1 dot 1` |
| Multi-part versions | `3.10.2` | `3点10点2` | `3 dot 10 dot 2` |
| IP addresses | `192.168.1.1` | `192点168点1点1` | `192 dot 168 dot 1 dot 1` |
| Dotted package names | `com.example.app` | `com点example点app` | `com dot example dot app` |

**Rules:**
- Replace every `.` that appears **between numbers or identifiers** (not sentence-ending punctuation) with the spoken equivalent: `点` (Chinese) or ` dot ` (English).
- A leading `v` before a version number is kept as-is — it reads naturally as the letter "v".
- Decimal numbers used as quantities (e.g., `3.5倍`, `$9.99`) are fine — TTS handles those correctly. Only rewrite structured identifiers (versions, IPs, dotted namespaces).
- Apply this rule regardless of whether the content originally contained these patterns or you are generating them yourself.

## Script Length

Aim for density, not padding:
- **Standard input** (single topic or short article): minimum **1000 Chinese characters** or **~600 English words** of actual dialogue
- **Content-heavy input** (long article, multi-topic roundup, research paper): minimum **3000 characters / ~1800 English words**

More is better when the content supports it. Listeners chose to press play; give them substance.

## Self-Check Before Outputting

Run through these mentally:
- Does every exchange *advance* the conversation, or is any line filler?
- Does the guest have real substance — at least 2 genuine back-and-forth exchanges (not just one-liner acknowledgments)?
- Does the opening hook? Does the closing land?
- Does it sound like real speech when read aloud?
- Is the title interesting — not generic like "AI的未来" but specific and enticing?

## Output Format

Output a JSON object. Always include all three fields by default:

```json
{
  "title": "An engaging, specific episode title",
  "outline": "## Main Theme\n### Point 1\n### Point 2\n### Point 3",
  "script": [
    {"role": "host", "text": "..."},
    {"role": "guest", "text": "..."},
    {"role": "host", "text": "..."}
  ]
}
```

Rules for the `script` array:
- Each item is one spoken turn — one person speaking continuously before the other responds
- Typical turn length: 2–6 sentences. Longer monologues are fine when content warrants it; very short turns (1 sentence) are fine during rapid back-and-forth
- Use only `"host"` or `"guest"` as role values — these map directly to TTS voice channels
- The array must start with `host` and alternate naturally (doesn't have to be perfectly alternating, but should feel balanced)

If the user explicitly asks for just the script without title/outline, output only the `script` array. Otherwise always provide the full object.

---

## Outline-Aligned Mode（优先，当提供 slide-outline.json 时）

当用户提供 **`slide-outline.json`**（由 `content-to-outline` skill 生成）时，激活此模式。
这是 PPT-aligned mode 的升级版：直接从结构化大纲生成脚本，无需解析 PPTX 文件，一致性最强。

**为什么优先使用 outline-aligned mode？**  
大纲里的 `speaker_notes` 是专门为对话设计的提示，比从 PPTX 文件解析文字更精准。
`key_points` 告诉你幻灯片上展示了什么，对话应当解释这些点背后的"为什么"和"怎么做"。

**规则：**
- `speaker_notes` 是该幻灯片的**主要内容来源**——对话必须覆盖其中提到的所有角度
- `key_points` 是幻灯片的视觉结论，对话应解释"为什么"和"怎么做"，而非照读
- 根据 `depth` 分配轮次：`short` → 1-2 轮，`medium` → 3-4 轮，`long` → 5-6 轮
- **`depth: "long"` 的幻灯片必须有真实的对立观点或追问**：主持人质疑、嘉宾反驳，或双方从不同立场探讨同一问题。不能全程点头认同。
- `cover`/`toc`/`section` 类型的幻灯片通常只需 1-2 轮（开场/过渡），不要在这些幻灯片上花太多对话时间
- 每个对话轮次加 `"slide": N`（N 为该幻灯片的 `slide` 字段值），严格递增
- 大纲中 `slide` 编号必须与 pptx-generator 生成的幻灯片一一对应

**全局字数预期（根据大纲复杂度）：**
- 8-10 张幻灯片 → 至少 1500 中文字或 900 英文词的对话
- 11-12 张幻灯片 → 至少 2000 中文字或 1200 英文词
- 有 3 张以上 `depth: "long"` 的大纲 → 对话总量可达 3000 字，不要截断

**读取大纲：**
```json
// slide-outline.json 示例
{
  "meta": { "suggested_title": "...", "total_slides": 10 },
  "slides": [
    {
      "slide": 2,
      "type": "content",
      "title": "主题一",
      "key_points": ["要点A", "要点B", "要点C"],
      "speaker_notes": "讨论要点：A的背后原因、B的实际案例、C与传统方案的对比",
      "depth": "medium"
    }
  ]
}
```

**输出（含 slide 注解）：**
```json
{
  "title": "...",
  "script": [
    {"role": "host",  "text": "（引出主题一）...", "slide": 2},
    {"role": "guest", "text": "（解释要点A的原因）...", "slide": 2},
    {"role": "host",  "text": "（追问B的案例）...", "slide": 2},
    {"role": "guest", "text": "（C与传统方案的对比）...", "slide": 2}
  ]
}
```

**自检（outline-aligned 模式）：**
- 每张幻灯片的 `speaker_notes` 中提到的角度都在对话中覆盖了吗？
- `depth: "long"` 的幻灯片是否有真实的对立观点或追问（不是全程点头）？
- `cover`/`toc` 幻灯片是否控制在 1-2 轮内，没有喧宾夺主？
- `slide` 编号是否与 `slide-outline.json` 完全对应，没有跳号或重号？
- 对话总量是否符合大纲规模的字数预期？

---

## PPT-Aligned Mode（备用，当只有 PPTX 文件而无大纲时）

当用户提供 **PPTX 文件、幻灯片列表、或编号大纲**，但**没有 slide-outline.json** 时，激活此模式。
如果同时有 slide-outline.json，请使用上面的 Outline-Aligned Mode。

When the user provides a **PPTX file, a slide list, or a numbered slide outline**, activate PPT-aligned mode:

**Why it matters:** The downstream video synthesis tool needs to know how long each slide should stay on screen. It computes this by summing the TTS duration of every turn that covers that slide. Without `"slide"` annotations, it falls back to uniform distribution — meaning a slide with 5 turns of dialogue will show for the same duration as a slide with 1 turn, which is wrong.

**Rules:**
- Add `"slide": N` (1-indexed integer) to **every** turn in the output
- Slides must be covered in **strictly sequential order** — once you move to slide 3, do not return to slide 2
- It's natural and expected that some slides get 1–2 turns and others get 4–6 turns depending on content depth
- The opening/intro turns (before you start covering slide content) get `"slide": 1`
- The closing turns get the last slide number

**Output with slide annotations:**
```json
{
  "title": "...",
  "script": [
    {"role": "host",  "text": "开场...",        "slide": 1},
    {"role": "guest", "text": "引出话题...",     "slide": 1},
    {"role": "host",  "text": "第一个要点...",   "slide": 2},
    {"role": "guest", "text": "深入分析...",     "slide": 2},
    {"role": "host",  "text": "过渡到下一点...", "slide": 3},
    {"role": "guest", "text": "结论...",         "slide": 3}
  ]
}
```

**How to extract slide structure** from a PPTX:
- If the user pastes the PPTX content or slide titles, use those directly
- If the user provides the file path, read it using the pptx-generator skill's extract capability
- If slide content is not available, ask the user for the slide titles/outline before generating

**Self-check for PPT-aligned output:**
- Does every turn have a `"slide"` field?
- Do slides appear in strictly increasing order (never going backward)?
- Is every slide number between 1 and N (the actual slide count)?
- Are the dialogue turns distributed naturally — more turns on content-heavy slides, fewer on transition/visual slides?
