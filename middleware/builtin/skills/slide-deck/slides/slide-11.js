function createSlide(pres, theme) {
  const slide = pres.addSlide();

  // Background
  slide.background = { color: "001d3d" };

  // Full-width top bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 10, h: 0.08,
    fill: { color: "ffc300" },
    line: { color: "ffc300" }
  });

  // Title
  slide.addText("Lore 的意义：不只是一个工具", {
    x: 0.5, y: 0.25, w: 9.0, h: 0.5,
    fontSize: 28, color: "FFFFFF", bold: true,
    fontFace: "WenQuanYi Micro Hei",
    valign: "middle"
  });

  // Subtitle
  slide.addText("游戏行业基础设施的开源化", {
    x: 0.5, y: 0.9, w: 9.0, h: 0.4,
    fontSize: 15, color: "ffc300",
    fontFace: "WenQuanYi Micro Hei",
    valign: "middle"
  });

  // Key takeaway cards
  const cards = [
    {
      number: "1",
      title: "游戏行业有机会得到第一个真正开源的大文件版控方案",
      body: "打破 Perforce 的商业垄断，降低整个行业的基础设施成本",
      titleColor: "FFFFFF"
    },
    {
      number: "2",
      title: "MIT 协议 + Epic 背书 = 可信赖的长期基础设施候选",
      body: "自部署、不依赖商业公司、有大公司验证",
      titleColor: "FFFFFF"
    },
    {
      number: "3",
      title: "关键问题：1.0 稳定版何时到来？谁会第一个公开迁移？",
      body: "去看 EpicGames/lore 的 16 个 ADR，加入 Discord 社区",
      titleColor: "ffc300"
    }
  ];

  const cardYPositions = [1.5, 2.55, 3.6];

  cards.forEach((card, i) => {
    const y = cardYPositions[i];

    // Card background
    slide.addShape(pres.ShapeType.rect, {
      x: 0.5, y: y, w: 8.8, h: 0.82,
      fill: { color: "000814" },
      line: { color: "000814" },
      rectRadius: 0.09
    });

    // Numbered circle
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.65, y: y + 0.16, w: 0.5, h: 0.5,
      fill: { color: "ffc300" },
      line: { color: "ffc300" }
    });
    slide.addText(card.number, {
      x: 0.65, y: y + 0.16, w: 0.5, h: 0.5,
      fontSize: 16, color: "000814", bold: true,
      fontFace: "Liberation Sans",
      align: "center", valign: "middle"
    });

    // Card title
    slide.addText(card.title, {
      x: 1.35, y: y + 0.05, w: 7.8, h: 0.35,
      fontSize: 14, color: card.titleColor, bold: true,
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });

    // Card body
    slide.addText(card.body, {
      x: 1.35, y: y + 0.42, w: 7.8, h: 0.32,
      fontSize: 12, color: "a3b1c6",
      fontFace: "WenQuanYi Micro Hei",
      valign: "middle"
    });
  });

  // Bottom action bar background
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 4.9, w: 10, h: 0.725,
    fill: { color: "000814" },
    line: { color: "000814" }
  });

  // Left link text
  slide.addText("🔗 github.com/EpicGames/lore", {
    x: 0.5, y: 5.1, w: 5.0, h: 0.35,
    fontSize: 13, color: "ffc300",
    fontFace: "Liberation Sans",
    valign: "middle"
  });

  // Right info text
  slide.addText("MIT License · Rust · Pre-1.0", {
    x: 4.5, y: 5.1, w: 4.7, h: 0.35,
    fontSize: 12, color: "a3b1c6",
    fontFace: "Liberation Sans",
    align: "right", valign: "middle"
  });

  // Page number badge (above action bar)
  slide.addShape(pres.ShapeType.ellipse, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: "ffc300" },
    line: { color: "ffc300" }
  });
  slide.addText("11", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 11, color: "000814", bold: true,
    fontFace: "Liberation Sans",
    align: "center", valign: "middle"
  });
}

module.exports = { createSlide };
