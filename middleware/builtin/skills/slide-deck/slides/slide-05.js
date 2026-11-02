"use strict";

function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Left panel background
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 3.5, h: 5.625,
    fill: { color: "003566" },
    line: { color: "003566", width: 0 }
  });

  // Right panel background
  slide.addShape(pres.ShapeType.rect, {
    x: 3.5, y: 0, w: 6.5, h: 5.625,
    fill: { color: "000814" },
    line: { color: "000814", width: 0 }
  });

  // Large section number "02" on left panel
  slide.addText("02", {
    x: 0.2, y: 1.5, w: 3, h: 2,
    fontSize: 96,
    color: "ffc300",
    bold: true,
    align: "center",
    valign: "middle",
    fontFace: "Liberation Sans"
  });

  // Small label "SECTION"
  slide.addText("SECTION", {
    x: 3.8, y: 1.3, w: 5.8, h: 0.3,
    fontSize: 11,
    color: "ffc300",
    bold: true,
    fontFace: "Liberation Sans"
  });

  // Section title
  slide.addText("Lore 的技术设计", {
    x: 3.8, y: 1.7, w: 5.8, h: 1.2,
    fontSize: 36,
    color: "FFFFFF",
    bold: true,
    fontFace: "WenQuanYi Micro Hei"
  });

  // Description
  slide.addText("从 Merkle 树到稀疏工作区", {
    x: 3.8, y: 2.9, w: 5.8, h: 0.4,
    fontSize: 16,
    color: "a3b1c6",
    fontFace: "WenQuanYi Micro Hei"
  });

  // Decorative squares
  const squareFills = ["ffc300", "003566", "FFFFFF"];
  squareFills.forEach(function(fill, i) {
    slide.addShape(pres.ShapeType.rect, {
      x: 3.8 + i * 0.25, y: 3.4, w: 0.15, h: 0.15,
      fill: { color: fill },
      line: { color: fill, width: 0 }
    });
  });

  // Page number badge
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300", width: 0 }
  });
  slide.addText("5", {
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
