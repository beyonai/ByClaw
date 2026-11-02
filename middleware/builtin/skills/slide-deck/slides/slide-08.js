"use strict";

function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Background
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 5.625,
    fill: { color: "000814" },
    line: { color: "000814", width: 0 }
  });

  // Left accent bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 }
  });

  // Title
  slide.addText("为什么选择 Rust？", {
    x: 0.3, y: 0.2, w: 9.4, h: 0.6,
    fontSize: 28,
    color: "FFFFFF",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });

  // Large stat callout on left
  slide.addShape(pres.ShapeType.roundRect, {
    x: 0.3, y: 1.1, w: 3.5, h: 2.8,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.1
  });

  // Big number "81.6%"
  slide.addText("81.6%", {
    x: 0.5, y: 1.3, w: 3, h: 1.2,
    fontSize: 60,
    color: "ffc300",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Label "Rust 代码占比"
  slide.addText("Rust 代码占比", {
    x: 0.5, y: 2.55, w: 3, h: 0.4,
    fontSize: 14,
    color: "FFFFFF",
    align: "center",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Sub-label
  slide.addText("Python 14.2% · C 3.9%", {
    x: 0.5, y: 3.0, w: 3, h: 0.3,
    fontSize: 11,
    color: "a3b1c6",
    align: "center",
    fontFace: "Liberation Sans"
  });

  // --- Right side: 3 reason cards ---

  // Card 1
  slide.addShape(pres.ShapeType.roundRect, {
    x: 4.2, y: 1.1, w: 5.5, h: 0.9,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  // Circle marker 1 (ffc300)
  slide.addShape(pres.ShapeType.ellipse, {
    x: 4.4, y: 1.2, w: 0.35, h: 0.35,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });
  slide.addText("内存安全", {
    x: 4.9, y: 1.2, w: 4.6, h: 0.3,
    fontSize: 15,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("所有权模型从语言层面排除整类 bug", {
    x: 4.9, y: 1.55, w: 4.6, h: 0.35,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Card 2
  slide.addShape(pres.ShapeType.roundRect, {
    x: 4.2, y: 2.15, w: 5.5, h: 0.9,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  // Circle marker 2 (003566)
  slide.addShape(pres.ShapeType.ellipse, {
    x: 4.4, y: 2.25, w: 0.35, h: 0.35,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 }
  });
  slide.addText("高并发无竞争条件", {
    x: 4.9, y: 2.25, w: 4.6, h: 0.3,
    fontSize: 15,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("版本控制系统的核心需求", {
    x: 4.9, y: 2.6, w: 4.6, h: 0.35,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Card 3
  slide.addShape(pres.ShapeType.roundRect, {
    x: 4.2, y: 3.2, w: 5.5, h: 0.9,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  // Circle marker 3 (ffc300)
  slide.addShape(pres.ShapeType.ellipse, {
    x: 4.4, y: 3.3, w: 0.35, h: 0.35,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });
  slide.addText("零成本抽象", {
    x: 4.9, y: 3.3, w: 4.6, h: 0.3,
    fontSize: 15,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("比 Go GC 更适合低延迟存储系统", {
    x: 4.9, y: 3.65, w: 4.6, h: 0.35,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Bottom note
  slide.addShape(pres.ShapeType.roundRect, {
    x: 0.3, y: 4.3, w: 9.3, h: 0.5,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.06
  });
  slide.addText("Linux 内核、Android 系统库都在引入 Rust——这是整个系统软件行业的趋势", {
    x: 0.5, y: 4.3, w: 9.1, h: 0.5,
    fontSize: 12,
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
  slide.addText("8", {
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
