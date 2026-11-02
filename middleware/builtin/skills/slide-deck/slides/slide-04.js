"use strict";
const pptxgen = require("pptxgenjs");

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: "000814" };

  // ── Left accent bar ─────────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 },
  });

  // ── Header ──────────────────────────────────────────────────────────────────
  slide.addText("现有方案为什么都不够", {
    x: 0.3, y: 0.2, w: 9.3, h: 0.55,
    fontSize: 28,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei",
    bold: true,
  });

  // ── Three comparison columns ────────────────────────────────────────────────
  const columns = [
    {
      x: 0.3,
      header: "Git",
      subLabel: "开源免费",
      bullets: ["• 为代码设计", "• 二进制文件无法 diff", "• 大仓库极度缓慢"],
      verdict: "❌ 不适合大项目",
    },
    {
      x: 3.47,
      header: "Perforce",
      subLabel: "行业标准",
      bullets: ["• 解决大文件问题", "• 商业闭源昂贵", "• EA/育碧/暴雪都在付授权费"],
      verdict: "💰 太贵且闭源",
    },
    {
      x: 6.63,
      header: "Git LFS",
      subLabel: "补丁方案",
      bullets: ["• 大文件转存外部", "• 底层仍是 Git 逻辑", "• Locking 机制原始"],
      verdict: "🩹 补丁非根本解",
    },
  ];

  columns.forEach((col) => {
    const { x } = col;
    const colY = 0.9;
    const colW = 2.9;
    const colH = 4.5;

    // Column card background
    slide.addShape(pres.ShapeType.rect, {
      x: x, y: colY, w: colW, h: colH,
      fill: { color: "001d3d" },
      line: { color: "001d3d", width: 0 },
      rectRadius: 0.1,
    });

    // Column header text
    slide.addText(col.header, {
      x: x, y: 1.0, w: colW, h: 0.45,
      fontSize: 20,
      color: "ffc300",
      fontFace: "Liberation Sans",
      bold: true,
      align: "center",
      valign: "middle",
    });

    // Sub-label
    slide.addText(col.subLabel, {
      x: x, y: 1.55, w: colW, h: 0.3,
      fontSize: 11,
      color: "a3b1c6",
      fontFace: "WenQuanYi Micro Hei",
      bold: false,
      align: "center",
      valign: "middle",
    });

    // Divider line under header
    slide.addShape(pres.ShapeType.line, {
      x: x + 0.15, y: 1.92, w: colW - 0.3, h: 0,
      line: { color: "003566", width: 1 },
    });

    // Bullet points
    const bulletYs = [2.1, 2.65, 3.2];
    col.bullets.forEach((bullet, bi) => {
      slide.addText(bullet, {
        x: x + 0.15, y: bulletYs[bi], w: colW - 0.2, h: 0.45,
        fontSize: 12,
        color: "FFFFFF",
        fontFace: "WenQuanYi Micro Hei",
        bold: false,
        align: "left",
        valign: "middle",
      });
    });

    // Verdict badge background
    slide.addShape(pres.ShapeType.rect, {
      x: x + 0.1, y: 4.2, w: colW - 0.2, h: 0.35,
      fill: { color: "003566" },
      line: { color: "003566", width: 0 },
      rectRadius: 0.06,
    });

    // Verdict text
    slide.addText(col.verdict, {
      x: x + 0.1, y: 4.2, w: colW - 0.2, h: 0.35,
      fontSize: 11,
      color: "FFFFFF",
      fontFace: "WenQuanYi Micro Hei",
      bold: false,
      align: "center",
      valign: "middle",
    });
  });

  // ── Page number badge ───────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "003566" },
    line: { color: "ffc300", width: 1 },
  });
  slide.addText("4", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 11,
    color: "FFFFFF",
    fontFace: "Liberation Sans",
    bold: true,
    align: "center",
    valign: "middle",
  });

  return slide;
}

module.exports = { createSlide };

// ── Standalone preview ────────────────────────────────────────────────────────
if (require.main === module) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.defineFontFaces([
    { name: "WenQuanYi Micro Hei", src: [{ path: "../fonts/wqy-microhei.ttc", type: "ttc" }] },
    { name: "Liberation Sans", src: [{ path: "../fonts/LiberationSans-Regular.ttf", type: "ttf" }] },
  ]);

  const theme = {
    primary: "000814",
    secondary: "001d3d",
    accent: "003566",
    light: "ffc300",
    bg: "001d3d",
  };

  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-04-preview.pptx" }).then(() => {
    console.log("slide-04-preview.pptx written");
  });
}
