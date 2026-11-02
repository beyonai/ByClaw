"use strict";
const pptxgen = require("pptxgenjs");

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: "001d3d" };

  // ── Title block ─────────────────────────────────────────────────────────────

  // Small label
  slide.addText("TODAY'S AGENDA", {
    x: 0.5, y: 0.3, w: 6, h: 0.3,
    fontSize: 14,
    color: "ffc300",
    fontFace: "Liberation Sans",
    bold: true,
  });

  // Section title
  slide.addText("今天聊什么", {
    x: 0.5, y: 0.6, w: 6, h: 0.6,
    fontSize: 36,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei",
    bold: true,
  });

  // Decorative line under title
  slide.addShape(pres.ShapeType.line, {
    x: 0.5, y: 1.25, w: 3, h: 0,
    line: { color: "ffc300", width: 2 },
  });

  // ── TOC items ───────────────────────────────────────────────────────────────
  const items = [
    { num: "01", text: "游戏开发的版本控制困局" },
    { num: "02", text: "Lore 核心技术架构深解" },
    { num: "03", text: "真实对比：Git / Perforce / LFS" },
    { num: "04", text: "争议与展望" },
  ];

  const rowYs = [1.6, 2.5, 3.4, 4.2];

  items.forEach((item, i) => {
    const y = rowYs[i];

    // Number circle background
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.5, y: y, w: 0.55, h: 0.55,
      fill: { color: "003566" },
      line: { color: "003566", width: 0 },
    });

    // Number text
    slide.addText(item.num, {
      x: 0.5, y: y, w: 0.55, h: 0.55,
      fontSize: 18,
      color: "ffc300",
      fontFace: "Liberation Sans",
      bold: true,
      align: "center",
      valign: "middle",
    });

    // Item text
    slide.addText(item.text, {
      x: 1.2, y: y, w: 7, h: 0.55,
      fontSize: 18,
      color: "FFFFFF",
      fontFace: "WenQuanYi Micro Hei",
      bold: true,
      valign: "middle",
    });
  });

  // ── Page number badge ───────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "003566" },
    line: { color: "ffc300", width: 1 },
  });
  slide.addText("2", {
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
  pres.writeFile({ fileName: "slide-02-preview.pptx" }).then(() => {
    console.log("slide-02-preview.pptx written");
  });
}
