"use strict";

function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Background
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 5.625,
    fill: { color: "000814" },
    line: { color: "000814", width: 0 }
  });

  // Left accent bar (golden)
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });

  // Title
  slide.addText("稀疏工作区 · 按需水合", {
    x: 0.3, y: 0.2, w: 9.4, h: 0.5,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });

  // Subtitle
  slide.addText("On-demand Hydration", {
    x: 0.3, y: 0.8, w: 9.4, h: 0.35,
    fontSize: 13,
    color: "ffc300",
    fontFace: "Liberation Sans"
  });

  // Left column header card
  slide.addShape(pres.ShapeType.roundRect, {
    x: 0.3, y: 1.3, w: 4.4, h: 0.5,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.06
  });
  slide.addText("传统方式（Git Clone）", {
    x: 0.3, y: 1.3, w: 4.4, h: 0.5,
    fontSize: 14,
    color: "FFFFFF",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Right column header card
  slide.addShape(pres.ShapeType.roundRect, {
    x: 5.0, y: 1.3, w: 4.7, h: 0.5,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 },
    rectRadius: 0.06
  });
  slide.addText("Lore 稀疏工作区", {
    x: 5.0, y: 1.3, w: 4.7, h: 0.5,
    fontSize: 14,
    color: "000814",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Left items
  var leftItems = [
    "• 必须 clone 完整仓库",
    "• 新员工等待数小时",
    "• 磁盘占用：完整资产 TB 级"
  ];
  var leftYPositions = [2.0, 2.55, 3.1];
  leftItems.forEach(function(text, i) {
    slide.addShape(pres.ShapeType.roundRect, {
      x: 0.3, y: leftYPositions[i], w: 4.4, h: 0.42,
      fill: { color: "001d3d" },
      line: { color: "001d3d", width: 0 },
      rectRadius: 0.05
    });
    slide.addText(text, {
      x: 0.5, y: leftYPositions[i], w: 4.2, h: 0.42,
      fontSize: 13,
      color: "FFFFFF",
      valign: "middle",
      fontFace: "WenQuanYi Micro Hei"
    });
  });

  // Right items
  var rightItems = [
    "• 只下载指定目录",
    "• 内容按需拉取（hydration）",
    "• 程序员 2GB / 美术 50GB，同一版本"
  ];
  var rightYPositions = [2.0, 2.55, 3.1];
  rightItems.forEach(function(text, i) {
    slide.addShape(pres.ShapeType.roundRect, {
      x: 5.0, y: rightYPositions[i], w: 4.7, h: 0.42,
      fill: { color: "001d3d" },
      line: { color: "001d3d", width: 0 },
      rectRadius: 0.05
    });
    slide.addText(text, {
      x: 5.2, y: rightYPositions[i], w: 4.5, h: 0.42,
      fontSize: 13,
      color: "ffc300",
      valign: "middle",
      fontFace: "WenQuanYi Micro Hei"
    });
  });

  // VS badge between columns
  slide.addShape(pres.ShapeType.ellipse, {
    x: 4.5, y: 2.55, w: 0.5, h: 0.5,
    fill: { color: "FFFFFF" },
    line: { color: "FFFFFF", width: 0 }
  });
  slide.addText("VS", {
    x: 4.5, y: 2.55, w: 0.5, h: 0.5,
    fontSize: 12,
    color: "000814",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Bottom callout box
  slide.addShape(pres.ShapeType.roundRect, {
    x: 0.3, y: 3.75, w: 9.3, h: 0.65,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.08
  });
  slide.addText("像海绵吸水——只吸你需要的那部分。元数据完整在本地，内容按需拉取。", {
    x: 0.5, y: 3.75, w: 9.1, h: 0.65,
    fontSize: 13,
    color: "FFFFFF",
    valign: "middle",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Page number badge
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });
  slide.addText("7", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 11,
    color: "000814",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });
}

module.exports = { createSlide };
