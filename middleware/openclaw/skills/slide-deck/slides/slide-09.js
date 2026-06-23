function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Background
  slide.background = { color: "000814" };

  // Left accent bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "ffc300" },
    line: { color: "ffc300" }
  });

  // Title
  slide.addText("与现有方案的真实对比", {
    x: 0.3, y: 0.2, w: 9.3, h: 0.5,
    fontSize: 28, color: "FFFFFF", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    valign: "middle"
  });

  // Header row background
  slide.addShape(pres.ShapeType.rect, {
    x: 0.3, y: 0.9, w: 9.3, h: 0.45,
    fill: { color: "003566" },
    line: { color: "003566" },
    rectRadius: 0.04
  });

  // Column headers
  const headerTexts = [
    { text: "特性", x: 0.5, w: 2.5 },
    { text: "Git", x: 3.2, w: 2 },
    { text: "Perforce", x: 5.4, w: 2 },
    { text: "Lore", x: 7.6, w: 1.8 }
  ];
  headerTexts.forEach(h => {
    slide.addText(h.text, {
      x: h.x, y: 0.9, w: h.w, h: 0.45,
      fontSize: 13, color: "ffc300", bold: true,
      fontFace: "WenQuanYi Micro Hei",
      align: "center", valign: "middle"
    });
  });

  // Row data
  const rows = [
    {
      y: 1.45, fill: "001d3d",
      feature: "大文件支持",
      git: { text: "❌ 极差", color: "ff6b6b" },
      perforce: { text: "✅ 良好", color: "69db7c" },
      lore: { text: "✅ 原生支持", color: "ffc300", bold: true }
    },
    {
      y: 2.07, fill: "000814",
      feature: "稀疏克隆",
      git: { text: "⚠️ 有限", color: "ffd43b" },
      perforce: { text: "⚠️ 部分", color: "ffd43b" },
      lore: { text: "✅ 完整支持", color: "ffc300", bold: true }
    },
    {
      y: 2.69, fill: "001d3d",
      feature: "开源免费",
      git: { text: "✅ 完全开源", color: "69db7c" },
      perforce: { text: "❌ 商业闭源", color: "ff6b6b" },
      lore: { text: "✅ MIT 协议", color: "ffc300", bold: true }
    },
    {
      y: 3.31, fill: "000814",
      feature: "大团队协作",
      git: { text: "❌ 困难", color: "ff6b6b" },
      perforce: { text: "✅ 良好", color: "69db7c" },
      lore: { text: "✅ 优化设计", color: "ffc300", bold: true }
    },
    {
      y: 3.93, fill: "001d3d",
      feature: "实际使用案例",
      git: { text: "开源项目", color: "a3b1c6" },
      perforce: { text: "EA/育碧/暴雪", color: "a3b1c6" },
      lore: { text: "UEFN 数十万用户", color: "ffc300", bold: true, fontSize: 12 }
    }
  ];

  rows.forEach(row => {
    // Row background
    slide.addShape(pres.ShapeType.rect, {
      x: 0.3, y: row.y, w: 9.3, h: 0.52,
      fill: { color: row.fill },
      line: { color: row.fill },
      rectRadius: 0.03
    });

    // Feature name
    slide.addText(row.feature, {
      x: 0.5, y: row.y, w: 2.5, h: 0.52,
      fontSize: 13, color: "FFFFFF", bold: true,
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });

    // Git cell
    slide.addText(row.git.text, {
      x: 3.2, y: row.y, w: 2, h: 0.52,
      fontSize: row.git.fontSize || 13, color: row.git.color,
      fontFace: "WenQuanYi Micro Hei",
      align: "center", valign: "middle"
    });

    // Perforce cell
    slide.addText(row.perforce.text, {
      x: 5.4, y: row.y, w: 2, h: 0.52,
      fontSize: row.perforce.fontSize || 13, color: row.perforce.color,
      fontFace: "WenQuanYi Micro Hei",
      align: "center", valign: "middle"
    });

    // Lore cell
    slide.addText(row.lore.text, {
      x: 7.6, y: row.y, w: 1.8, h: 0.52,
      fontSize: row.lore.fontSize || 13, color: row.lore.color,
      bold: row.lore.bold || false,
      fontFace: "WenQuanYi Micro Hei",
      align: "center", valign: "middle"
    });
  });

  // Bottom callout background
  slide.addShape(pres.ShapeType.rect, {
    x: 0.3, y: 4.65, w: 9.3, h: 0.55,
    fill: { color: "003566" },
    line: { color: "003566" },
    rectRadius: 0.06
  });

  // Bottom callout text
  slide.addText("Lore 已内置 UEFN（Unreal Editor for Fortnite），全球数十万堡垒之夜创作者每天在用", {
    x: 0.3, y: 4.65, w: 9.3, h: 0.55,
    fontSize: 12, color: "FFFFFF",
    fontFace: "WenQuanYi Micro Hei",
    align: "center", valign: "middle"
  });

  // Page number badge
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300" }
  });
  slide.addText("9", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 12, color: "000814", bold: true,
    fontFace: "Liberation Sans",
    align: "center", valign: "middle"
  });
}

module.exports = { createSlide };
