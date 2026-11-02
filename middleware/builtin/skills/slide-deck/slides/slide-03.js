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
  slide.addText("游戏开发的版本控制困局", {
    x: 0.3, y: 0.2, w: 9.3, h: 0.55,
    fontSize: 28,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei",
    bold: true,
  });

  slide.addText("为什么现有工具不够用", {
    x: 0.3, y: 0.85, w: 9.3, h: 0.35,
    fontSize: 14,
    color: "ffc300",
    fontFace: "WenQuanYi Micro Hei",
    bold: false,
  });

  // ── Content cards ───────────────────────────────────────────────────────────
  const cards = [
    {
      iconColor: "003566",
      title: "AAA 游戏仓库：代码 + 数百 GB 二进制资产共存",
      detail: "3D模型、贴图、音频……单一资产动辄数 GB，版本历史急速膨胀",
    },
    {
      iconColor: "ffc300",
      title: "Git clone 耗时数小时，.git 目录膨胀至数百 GB",
      detail: "大型工作室新员工入职第一天，光 clone 仓库就要等半天",
    },
    {
      iconColor: "003566",
      title: "程序员用 Git，美术用 Perforce——工具链长期分裂",
      detail: "两套工具、两套流程、两套权限——协作成本每天都在累积",
    },
  ];

  const cardYs = [1.35, 2.55, 3.75];

  cards.forEach((card, i) => {
    const y = cardYs[i];

    // Card background
    slide.addShape(pres.ShapeType.rect, {
      x: 0.3, y: y, w: 9.3, h: 0.95,
      fill: { color: "001d3d" },
      line: { color: "001d3d", width: 0 },
      rectRadius: 0.08,
    });

    // Icon oval
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.5, y: y + 0.125, w: 0.7, h: 0.7,
      fill: { color: card.iconColor },
      line: { color: card.iconColor, width: 0 },
    });

    // Card title
    slide.addText(card.title, {
      x: 1.4, y: y + 0.05, w: 8.0, h: 0.35,
      fontSize: 15,
      color: "FFFFFF",
      fontFace: "WenQuanYi Micro Hei",
      bold: true,
      valign: "middle",
    });

    // Card detail
    slide.addText(card.detail, {
      x: 1.4, y: y + 0.33, w: 8.0, h: 0.35,
      fontSize: 12,
      color: "a3b1c6",
      fontFace: "WenQuanYi Micro Hei",
      bold: false,
      valign: "middle",
    });
  });

  // ── Page number badge ───────────────────────────────────────────────────────
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "003566" },
    line: { color: "ffc300", width: 1 },
  });
  slide.addText("3", {
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
  pres.writeFile({ fileName: "slide-03-preview.pptx" }).then(() => {
    console.log("slide-03-preview.pptx written");
  });
}
