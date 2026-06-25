function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Background
  slide.background = { color: "000814" };

  // Left accent bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "003566" },
    line: { color: "003566" }
  });

  // Title
  slide.addText("现实争议：值得押注吗？", {
    x: 0.3, y: 0.2, w: 9.3, h: 0.5,
    fontSize: 28, color: "FFFFFF", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    valign: "middle"
  });

  // Subtitle
  slide.addText("Pre-1.0 的风险与机遇", {
    x: 0.3, y: 0.82, w: 9.3, h: 0.35,
    fontSize: 13, color: "ffc300",
    fontFace: "WenQuanYi Micro Hei",
    valign: "middle"
  });

  // Left column header
  slide.addShape(pres.ShapeType.rect, {
    x: 0.3, y: 1.25, w: 4.3, h: 0.45,
    fill: { color: "003566" },
    line: { color: "003566" },
    rectRadius: 0.06
  });
  slide.addText("⚠️ 风险与挑战", {
    x: 0.3, y: 1.25, w: 4.3, h: 0.45,
    fontSize: 14, color: "FFFFFF", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    align: "center", valign: "middle"
  });

  // Right column header
  slide.addShape(pres.ShapeType.rect, {
    x: 5.0, y: 1.25, w: 4.6, h: 0.45,
    fill: { color: "001d3d" },
    line: { color: "ffc300", pt: 1.5 },
    rectRadius: 0.06
  });
  slide.addText("✅ 理由与信心", {
    x: 5.0, y: 1.25, w: 4.6, h: 0.45,
    fontSize: 14, color: "ffc300", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    align: "center", valign: "middle"
  });

  // Left cards data
  const leftCards = [
    {
      title: "Pre-1.0 格式不稳定",
      body: "接口/磁盘格式可能随时变化，迁移成本高"
    },
    {
      title: "集中式架构门槛",
      body: "需要中央服务器，个人开发者/开源社区不友好"
    },
    {
      title: "与 Git 生态割裂",
      body: "无法直接用现有 CI/CD 工具链"
    }
  ];

  const leftYPositions = [1.85, 2.7, 3.55];

  leftCards.forEach((card, i) => {
    const y = leftYPositions[i];

    // Card background
    slide.addShape(pres.ShapeType.rect, {
      x: 0.3, y: y, w: 4.3, h: 0.72,
      fill: { color: "001d3d" },
      line: { color: "001d3d" },
      rectRadius: 0.07
    });

    // Card title
    slide.addText(card.title, {
      x: 0.45, y: y + 0.04, w: 4.0, h: 0.28,
      fontSize: 13, color: "ff6b6b", bold: true,
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });

    // Card body
    slide.addText(card.body, {
      x: 0.45, y: y + 0.34, w: 4.0, h: 0.3,
      fontSize: 11, color: "FFFFFF",
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });
  });

  // Right cards data
  const rightCards = [
    {
      title: "16 个公开 ADR",
      body: "架构决策全部透明，工程文化比多数商业产品更强"
    },
    {
      title: "UEFN 已验证",
      body: "数十万创作者在用，说明技术路线可行"
    },
    {
      title: "MIT 开源 + Epic 背书",
      body: "打破 Perforce 商业垄断的最有力候选"
    }
  ];

  const rightYPositions = [1.85, 2.7, 3.55];

  rightCards.forEach((card, i) => {
    const y = rightYPositions[i];

    // Card background
    slide.addShape(pres.ShapeType.rect, {
      x: 5.0, y: y, w: 4.6, h: 0.72,
      fill: { color: "001d3d" },
      line: { color: "001d3d" },
      rectRadius: 0.07
    });

    // Card title
    slide.addText(card.title, {
      x: 5.15, y: y + 0.04, w: 4.3, h: 0.28,
      fontSize: 13, color: "ffc300", bold: true,
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });

    // Card body
    slide.addText(card.body, {
      x: 5.15, y: y + 0.34, w: 4.3, h: 0.3,
      fontSize: 11, color: "FFFFFF",
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });
  });

  // Bottom callout background
  slide.addShape(pres.ShapeType.rect, {
    x: 0.3, y: 4.45, w: 9.3, h: 0.6,
    fill: { color: "003566" },
    line: { color: "003566" },
    rectRadius: 0.06
  });

  // Bottom callout text
  slide.addText("现阶段适合人群：新项目 · 小团队 · 愿意换取早期反馈的先行者", {
    x: 0.3, y: 4.45, w: 9.3, h: 0.6,
    fontSize: 13, color: "FFFFFF", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    align: "center", valign: "middle"
  });

  // Page number badge
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300" }
  });
  slide.addText("10", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 11, color: "000814", bold: true,
    fontFace: "Liberation Sans",
    align: "center", valign: "middle"
  });
}

module.exports = { createSlide };
