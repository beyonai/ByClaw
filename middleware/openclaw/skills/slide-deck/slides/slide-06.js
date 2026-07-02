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
  slide.addText("Merkle 树 + 内容寻址存储", {
    x: 0.3, y: 0.2, w: 9.4, h: 0.55,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });

  // --- Tree diagram (left column) ---

  // Root node
  slide.addShape(pres.ShapeType.roundRect, {
    x: 1.8, y: 1.1, w: 1.4, h: 0.45,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 },
    rectRadius: 0.05
  });
  slide.addText("Root Hash", {
    x: 1.8, y: 1.1, w: 1.4, h: 0.45,
    fontSize: 11,
    color: "000814",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Horizontal connector from left child to right child (top)
  slide.addShape(pres.ShapeType.line, {
    x: 2.2, y: 1.56, w: 0.6, h: 0,
    line: { color: "003566", width: 1.5 }
  });

  // Left child vertical connector
  slide.addShape(pres.ShapeType.line, {
    x: 2.2, y: 1.56, w: 0, h: 0.35,
    line: { color: "003566", width: 1.5 }
  });

  // Right child vertical connector
  slide.addShape(pres.ShapeType.line, {
    x: 2.8, y: 1.56, w: 0, h: 0.35,
    line: { color: "003566", width: 1.5 }
  });

  // Left child node
  slide.addShape(pres.ShapeType.roundRect, {
    x: 1.3, y: 1.9, w: 1.2, h: 0.4,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.05
  });
  slide.addText("Dir Hash A", {
    x: 1.3, y: 1.9, w: 1.2, h: 0.4,
    fontSize: 10,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Right child node
  slide.addShape(pres.ShapeType.roundRect, {
    x: 2.7, y: 1.9, w: 1.2, h: 0.4,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 },
    rectRadius: 0.05
  });
  slide.addText("Dir Hash B", {
    x: 2.7, y: 1.9, w: 1.2, h: 0.4,
    fontSize: 10,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Lines from left child down to 2 leaf nodes
  // Left child center x = 1.3 + 0.6 = 1.9, bottom y = 1.9 + 0.4 = 2.3
  slide.addShape(pres.ShapeType.line, {
    x: 1.3, y: 2.3, w: 0.6, h: 0,
    line: { color: "003566", width: 1.5 }
  });
  slide.addShape(pres.ShapeType.line, {
    x: 1.3, y: 2.3, w: 0, h: 0.3,
    line: { color: "003566", width: 1.5 }
  });
  slide.addShape(pres.ShapeType.line, {
    x: 1.9, y: 2.3, w: 0, h: 0.3,
    line: { color: "003566", width: 1.5 }
  });

  // Line from right child down to leaf
  slide.addShape(pres.ShapeType.line, {
    x: 3.3, y: 2.3, w: 0, h: 0.3,
    line: { color: "003566", width: 1.5 }
  });

  // Leaf nodes under left child
  // Leaf 1: x:0.8
  slide.addShape(pres.ShapeType.roundRect, {
    x: 0.8, y: 2.6, w: 1.0, h: 0.38,
    fill: { color: "001d3d" },
    line: { color: "003566", width: 1 },
    rectRadius: 0.04
  });
  slide.addText("File Chunk", {
    x: 0.8, y: 2.6, w: 1.0, h: 0.38,
    fontSize: 9,
    color: "a3b1c6",
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Leaf 2: x:1.9
  slide.addShape(pres.ShapeType.roundRect, {
    x: 1.9, y: 2.6, w: 1.0, h: 0.38,
    fill: { color: "001d3d" },
    line: { color: "003566", width: 1 },
    rectRadius: 0.04
  });
  slide.addText("File Chunk", {
    x: 1.9, y: 2.6, w: 1.0, h: 0.38,
    fontSize: 9,
    color: "a3b1c6",
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Leaf under right child: x:2.7
  slide.addShape(pres.ShapeType.roundRect, {
    x: 2.7, y: 2.6, w: 1.2, h: 0.38,
    fill: { color: "001d3d" },
    line: { color: "003566", width: 1 },
    rectRadius: 0.04
  });
  slide.addText("File Chunk", {
    x: 2.7, y: 2.6, w: 1.2, h: 0.38,
    fontSize: 9,
    color: "a3b1c6",
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Label below diagram
  slide.addText("每块内容 → 唯一哈希 → 可验证完整性", {
    x: 0.3, y: 3.2, w: 4.8, h: 0.35,
    fontSize: 11,
    color: "ffc300",
    fontFace: "WenQuanYi Micro Hei"
  });

  // --- Right column: 3 key point cards ---

  // Card 1
  slide.addShape(pres.ShapeType.roundRect, {
    x: 5.3, y: 1.0, w: 4.4, h: 1.0,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  slide.addText("密码学完整性", {
    x: 5.5, y: 1.1, w: 4.0, h: 0.3,
    fontSize: 14,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("根哈希变化即仓库状态变化，无法伪造", {
    x: 5.5, y: 1.45, w: 4.0, h: 0.4,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Card 2
  slide.addShape(pres.ShapeType.roundRect, {
    x: 5.3, y: 2.15, w: 4.4, h: 1.0,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  slide.addText("天然去重", {
    x: 5.5, y: 2.25, w: 4.0, h: 0.3,
    fontSize: 14,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("相同内容同一哈希，全仓库只存一份", {
    x: 5.5, y: 2.6, w: 4.0, h: 0.4,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Card 3
  slide.addShape(pres.ShapeType.roundRect, {
    x: 5.3, y: 3.3, w: 4.4, h: 1.0,
    fill: { color: "001d3d" },
    line: { color: "001d3d", width: 0 },
    rectRadius: 0.08
  });
  slide.addText("分块存储", {
    x: 5.5, y: 3.4, w: 4.0, h: 0.3,
    fontSize: 14,
    color: "ffc300",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });
  slide.addText("大文件改10%只需重存那10%的块", {
    x: 5.5, y: 3.75, w: 4.0, h: 0.4,
    fontSize: 12,
    color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Page number badge
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });
  slide.addText("6", {
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
