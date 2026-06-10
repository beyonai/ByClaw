---
name: pptx-generator
description: "Generate, edit, and read PowerPoint presentations. Create from scratch with PptxGenJS (cover, TOC, content, section divider, summary slides), edit existing PPTX via XML workflows, or extract text with markitdown. Triggers: PPT, PPTX, PowerPoint, presentation, slide, deck, slides."
license: MIT
metadata:
  version: "1.0"
  category: productivity
  sources:
    - https://gitbrent.github.io/PptxGenJS/
    - https://github.com/microsoft/markitdown
---

# PPTX Generator & Editor

## Overview

This skill handles all PowerPoint tasks: reading/analyzing existing presentations, editing template-based decks via XML manipulation, and creating presentations from scratch using PptxGenJS. It includes a complete design system (color palettes, fonts, style recipes) and detailed guidance for every slide type.

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | `python -m markitdown presentation.pptx` |
| Edit or create from template | See [Editing Presentations](references/editing.md) |
| Create from scratch | See [Creating from Scratch](#creating-from-scratch-workflow) below |

| Item | Value |
|------|-------|
| **Dimensions** | 10" x 5.625" (LAYOUT_16x9) |
| **Colors** | 6-char hex without # (e.g., `"FF0000"`) |
| **English font** | Arial (Windows/Mac) or Liberation Sans (Linux, bundled in `fonts/`) |
| **Chinese font** | Microsoft YaHei (Windows/Mac) or WenQuanYi Micro Hei (Linux, bundled in `fonts/`) |
| **Page badge position** | x: 9.3", y: 5.1" |
| **Theme keys** | `primary`, `secondary`, `accent`, `light`, `bg` |
| **Shapes** | RECTANGLE, OVAL, LINE, ROUNDED_RECTANGLE |
| **Charts** | BAR, LINE, PIE, DOUGHNUT, SCATTER, BUBBLE, RADAR |

## Reference Files

| File | Contents |
|------|----------|
| [slide-types.md](references/slide-types.md) | 5 slide page types (Cover, TOC, Section Divider, Content, Summary) + additional layout patterns |
| [design-system.md](references/design-system.md) | Color palettes, font reference, style recipes (Sharp/Soft/Rounded/Pill), typography & spacing |
| [editing.md](references/editing.md) | Template-based editing workflow, XML manipulation, formatting rules, common pitfalls |
| [pitfalls.md](references/pitfalls.md) | QA process, common mistakes, critical PptxGenJS pitfalls |
| [pptxgenjs.md](references/pptxgenjs.md) | Complete PptxGenJS API reference |

---

## Reading Content

```bash
# Text extraction
python -m markitdown presentation.pptx
```

---

## Creating from Scratch — Workflow

**Use when no template or reference presentation is available.**

> **如果用户提供了 `slide-outline.json`（来自 `content-to-outline` skill），请跳过 Step 1 和 Step 4，直接使用大纲中的内容。详见下方 [Generating from Outline](#generating-from-outline)。**

### Step 1: Research & Requirements

Search to understand user requirements — topic, audience, purpose, tone, content depth.

### Step 2: Select Color Palette & Fonts

Use the [Color Palette Reference](references/design-system.md#color-palette-reference) to select a palette matching the topic and audience. Use the [Font Reference](references/design-system.md#font-reference) to choose a font pairing.

### Step 3: Select Design Style

Use the [Style Recipes](references/design-system.md#style-recipes) to choose a visual style (Sharp, Soft, Rounded, or Pill) matching the presentation tone.

### Step 4: Plan Slide Outline

Classify **every slide** as exactly one of the [5 page types](references/slide-types.md). Plan the content and layout for each slide. Ensure visual variety — do NOT repeat the same layout across slides.

### Step 5: Generate Slide JS Files

Create one JS file per slide in `slides/` directory. Each file must export a synchronous `createSlide(pres, theme)` function. Follow the [Slide Output Format](#slide-output-format) and the type-specific guidance in [slide-types.md](references/slide-types.md). Generate up to 5 slides concurrently using subagents if available.

**Tell each subagent:**
1. File naming: `slides/slide-01.js`, `slides/slide-02.js`, etc.
2. Images go in: `slides/imgs/`
3. Final PPTX goes in: `slides/output/`
4. Dimensions: 10" x 5.625" (LAYOUT_16x9)
5. Fonts: Chinese = Microsoft YaHei (Windows) / WenQuanYi Micro Hei (Linux, bundled at `fonts/wqy-microhei.ttc`), English = Arial (Windows) / Liberation Sans (Linux, bundled at `fonts/LiberationSans-Regular.ttf`)
6. Colors: 6-char hex without # (e.g. `"FF0000"`)
7. Must use the theme object contract (see [Theme Object Contract](#theme-object-contract))
8. Must follow the [PptxGenJS API reference](references/pptxgenjs.md)

### Step 6: Compile into Final PPTX

Create `slides/compile.js` to combine all slide modules:

```javascript
// slides/compile.js
const pptxgen = require('pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';

const theme = {
  primary: "22223b",    // dark color for backgrounds/text
  secondary: "4a4e69",  // secondary accent
  accent: "9a8c98",     // highlight color
  light: "c9ada7",      // light accent
  bg: "f2e9e4"          // background color
};

for (let i = 1; i <= 12; i++) {  // adjust count as needed
  const num = String(i).padStart(2, '0');
  const slideModule = require(`./slide-${num}.js`);
  slideModule.createSlide(pres, theme);
}

pres.writeFile({ fileName: './output/presentation.pptx' });
```

Run with: `cd slides && node compile.js`

### Step 7: QA (Required)

See [QA Process](references/pitfalls.md#qa-process).

### Output Structure

```
slides/
├── slide-01.js          # Slide modules
├── slide-02.js
├── ...
├── imgs/                # Images used in slides
└── output/              # Final artifacts
    └── presentation.pptx
```

---

## Generating from Outline

**当用户提供 `slide-outline.json`（来自 `content-to-outline` skill）时使用此路径。**

跳过 Step 1（Research）和 Step 4（Plan Outline），直接从大纲中读取幻灯片结构。

### 读取大纲

```json
// slide-outline.json 关键字段
{
  "slides": [
    {
      "slide": 1,        // 幻灯片编号（JS 文件编号必须与此一致）
      "type": "cover",   // 决定使用哪种幻灯片布局
      "title": "...",    // 幻灯片标题
      "subtitle": "...", // 副标题（cover/toc 类型）
      "key_points": []   // 幻灯片正文内容（bullet points）
    }
  ]
}
```

### 映射规则

| outline `type` | 幻灯片布局 | key_points 处理 |
|---|---|---|
| `cover` | Cover Page（封面） | 忽略（空数组）；用 `title` 作主标题，`subtitle` 作副标题 |
| `toc` | Table of Contents | 忽略（空数组）；自动从 outline 的所有 `content`/`section` 幻灯片标题中提取目录条目 |
| `section` | Section Divider | 忽略或最多显示 1 条；`title` 作大字分节标题 |
| `content` | Content Slide | 每条 `key_points` 作为一个 bullet point |
| `summary` | Summary Slide | 每条 `key_points` 作为结论 bullet |

**关键规则：**
- 幻灯片 JS 文件编号严格对应 `slide` 字段：`slide: 3` → `slide-03.js`（不要按数组下标，要按 `slide` 值）
- `subtitle` 字段：`cover` 和 `toc` 类型将其渲染为副标题文字；其他类型忽略
- compile.js 的循环次数必须等于 `meta.total_slides`，不能手动猜测
- `toc` 幻灯片的目录条目：从 slides 数组中筛选 `type: "content"` 和 `type: "section"` 的条目，取其 `title` 字段列出，最多显示 6 条
- 不要改动幻灯片顺序——`podcast-script-generator` 的 `"slide": N` 注解依赖这个顺序

### 一致性自检

生成完成后，确认：
- 幻灯片数量 = `slide-outline.json` 中 `meta.total_slides`
- 每张幻灯片的标题与大纲中 `title` 完全一致
- `key_points` 中的要点全部出现在对应幻灯片上

---

## Slide Output Format

Each slide is a **complete, runnable JS file**:

```javascript
// slide-01.js
const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'cover',
  index: 1,
  title: 'Presentation Title'
};

// MUST be synchronous (not async)
function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  slide.addText(slideConfig.title, {
    x: 0.5, y: 2, w: 9, h: 1.2,
    fontSize: 48, fontFace: "Arial",
    color: theme.primary, bold: true, align: "center"
  });

  return slide;
}

// Standalone preview - use slide-specific filename
if (require.main === module) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  const theme = {
    primary: "22223b",
    secondary: "4a4e69",
    accent: "9a8c98",
    light: "c9ada7",
    bg: "f2e9e4"
  };
  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-01-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
```

---

## Theme Object Contract (MANDATORY)

The compile script passes a theme object with these **exact keys**:

| Key | Purpose | Example |
|-----|---------|---------|
| `theme.primary` | Darkest color, titles | `"22223b"` |
| `theme.secondary` | Dark accent, body text | `"4a4e69"` |
| `theme.accent` | Mid-tone accent | `"9a8c98"` |
| `theme.light` | Light accent | `"c9ada7"` |
| `theme.bg` | Background color | `"f2e9e4"` |

**NEVER use other key names** like `background`, `text`, `muted`, `darkest`, `lightest`.

---

## Page Number Badge (REQUIRED)

All slides **except Cover Page** MUST include a page number badge in the bottom-right corner.

- **Position**: x: 9.3", y: 5.1"
- Show current number only (e.g. `3` or `03`), NOT "3/12"
- Use palette colors, keep subtle

### Circle Badge (Default)

```javascript
slide.addShape(pres.shapes.OVAL, {
  x: 9.3, y: 5.1, w: 0.4, h: 0.4,
  fill: { color: theme.accent }
});
slide.addText("3", {
  x: 9.3, y: 5.1, w: 0.4, h: 0.4,
  fontSize: 12, fontFace: "Arial",
  color: "FFFFFF", bold: true,
  align: "center", valign: "middle"
});
```

### Pill Badge

```javascript
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 9.1, y: 5.15, w: 0.6, h: 0.35,
  fill: { color: theme.accent },
  rectRadius: 0.15
});
slide.addText("03", {
  x: 9.1, y: 5.15, w: 0.6, h: 0.35,
  fontSize: 11, fontFace: "Arial",
  color: "FFFFFF", bold: true,
  align: "center", valign: "middle"
});
```

---

## Dependencies

- `pip install "markitdown[pptx]"` — text extraction
- `npm install -g pptxgenjs` — creating from scratch
- `npm install -g react-icons react react-dom sharp` — icons (optional)
