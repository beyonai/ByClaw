"use strict";
const pptxgen = require("pptxgenjs");

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: "000814" };

  // ── Left half ──────────────────────────────────────────────────────────────

  // Small label
  slide.addText("OPEN SOURCE · EPIC GAMES · 2025", {
    x: 0.5, y: 0.4, w: 5.5, h: 0.3,
    fontSize: 11,
    color: "ffc300",
    fontFace: "Liberation Sans",
    bold: false,
  });

  // Main title "Lore"
  slide.addText("Lore", {
    x: 0.5, y: 1.0, w: 5.5, h: 1.2,
    fontSize: 80,
    color: "FFFFFF",
    fontFace: "Liberation Sans",
    bold: true,
  });

  // Subtitle
  slide.addText("Epic Games 的版本控制革命", {
    x: 0.5, y: 2.3, w: 5.5, h: 0.5,
    fontSize: 26,
    color: "ffc300",
    fontFace: "WenQuanYi Micro Hei",
    bold: true,
  });

  // Description
  slide.addText("游戏行业为什么需要一个新的 Git？", {
    x: 0.5, y: 3.0, w: 5.5, h: 0.4,
    fontSize: 16,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei",
    bold: false,
  });

  // Bottom tag badge
  slide.addShape(pres.ShapeType.rect, {
    x: 0.5, y: 4.5, w: 1.6, h: 0.32,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.05,
  });
  slide.addText("GitHub 3600+ ★", {
    x: 0.5, y: 4.5, w: 1.6, h: 0.32,
    fontSize: 11,
    color: "FFFFFF",
    fontFace: "Liberation Sans",
    bold: false,
    align: "center",
    valign: "middle",
  });

  // ── Right half – decorative tech shapes ───────────────────────────────────

  // Large circle outline (no fill)
  slide.addShape(pres.ShapeType.ellipse, {
    x: 6.5, y: 0.3, w: 3.2, h: 3.2,
    fill: { type: "none" },
    line: { color: "003566", width: 3 },
  });

  // Medium filled circle
  slide.addShape(pres.ShapeType.ellipse, {
    x: 7.8, y: 1.0, w: 1.5, h: 1.5,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
  });

  // Small golden circle
  slide.addShape(pres.ShapeType.ellipse, {
    x: 8.8, y: 2.6, w: 0.6, h: 0.6,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 },
  });

  // Three horizontal lines
  const lineYs = [3.8, 4.1, 4.4];
  lineYs.forEach((ly) => {
    slide.addShape(pres.ShapeType.line, {
      x: 6.2, y: ly, w: 3.3, h: 0,
      line: { color: "003566", width: 2 },
    });
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
  pres.writeFile({ fileName: "slide-01-preview.pptx" }).then(() => {
    console.log("slide-01-preview.pptx written");
  });
}
