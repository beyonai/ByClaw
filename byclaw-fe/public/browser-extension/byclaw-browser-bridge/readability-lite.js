(function () {
  const BLOCK_TAGS = new Set([
    "article",
    "aside",
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
  ]);
  const NOISE_SELECTOR = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "[hidden]",
    "[aria-hidden='true']",
    ".ad",
    ".ads",
    ".advert",
    ".advertisement",
    ".banner",
    ".breadcrumb",
    ".comment",
    ".comments",
    ".footer",
    ".header",
    ".modal",
    ".nav",
    ".navbar",
    ".pagination",
    ".recommend",
    ".related",
    ".share",
    ".sidebar",
    ".sponsor",
    ".toolbar",
    "#comments",
    "#footer",
    "#header",
    "#sidebar",
  ].join(",");
  const POSITIVE_RE = /\b(article|body|content|entry|main|page|post|text|story|markdown|doc)\b/i;
  const NEGATIVE_RE = /\b(ad|advert|aside|banner|comment|footer|header|menu|meta|nav|promo|recommend|related|share|sidebar|sponsor|tool|widget)\b/i;

  function extract(options) {
    const sourceUrl = options?.sourceUrl || location.href;
    const clone = document.documentElement.cloneNode(true);
    normalizeUrls(clone, sourceUrl);
    stripNoise(clone);
    const root = selectContentRoot(clone) || clone.querySelector("body") || clone;
    const title = bestTitle(clone);
    const text = normalizeText(root.textContent || "");
    const markdown = buildMarkdownDocument(title, sourceUrl, root);
    const images = collectImages(root);
    return {
      sourceUrl,
      title,
      byline: findByline(clone),
      markdown,
      html: root.outerHTML || "",
      text,
      images,
      extractionMode: "READABILITY_LITE",
      contentLength: text.length,
      pagination: detectPagination(clone, sourceUrl),
    };
  }

  function selectContentRoot(root) {
    const preferred = Array.from(root.querySelectorAll("article, main, [role='main'], .article, .content, .post, .entry"));
    const candidates = preferred.length
      ? preferred
      : Array.from(root.querySelectorAll("article, main, section, div")).filter((node) => textLength(node) > 120);
    let best = root.querySelector("body") || root;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function scoreCandidate(node) {
    const text = normalizeText(node.textContent || "");
    const paragraphScore = node.querySelectorAll("p").length * 80;
    const headingScore = node.querySelectorAll("h1,h2,h3").length * 120;
    const imageScore = node.querySelectorAll("img").length * 40;
    const linkPenalty = Math.floor(text.length * linkDensity(node) * 0.7);
    return text.length + paragraphScore + headingScore + imageScore + classWeight(node) - linkPenalty;
  }

  function textLength(node) {
    return normalizeText(node.textContent || "").length;
  }

  function classWeight(node) {
    const value = `${node.className || ""} ${node.id || ""}`;
    let weight = 0;
    if (POSITIVE_RE.test(value)) {
      weight += 600;
    }
    if (NEGATIVE_RE.test(value)) {
      weight -= 900;
    }
    return weight;
  }

  function linkDensity(node) {
    const text = normalizeText(node.textContent || "");
    if (!text) {
      return 0;
    }
    const linkText = Array.from(node.querySelectorAll("a"))
      .map((link) => normalizeText(link.textContent || ""))
      .join(" ");
    return linkText.length / text.length;
  }

  function buildMarkdownDocument(title, sourceUrl, root) {
    return [`# ${escapeMarkdown(title)}`, "", `> Source: ${sourceUrl}`, "", renderChildren(root)]
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function renderChildren(node, context) {
    return Array.from(node.childNodes)
      .map((child) => renderNode(child, context || {}))
      .filter(Boolean)
      .join("");
  }

  function renderNode(node, context) {
    if (node.nodeType === Node.TEXT_NODE) {
      return context?.pre ? node.nodeValue || "" : normalizeInline(node.nodeValue || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }
    const tag = node.tagName.toLowerCase();
    if (isHidden(node) || shouldSkipNode(node)) {
      return "";
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(Number(tag.slice(1)) + 1, 6);
      return block(`${"#".repeat(level)} ${normalizeText(node.textContent || "")}`);
    }
    if (tag === "p") {
      return block(renderChildren(node).trim());
    }
    if (tag === "br") {
      return "  \n";
    }
    if (tag === "a") {
      return renderLink(node);
    }
    if (tag === "img") {
      return renderImage(node);
    }
    if (tag === "pre") {
      return block(`\`\`\`\n${(node.textContent || "").trim()}\n\`\`\``);
    }
    if (tag === "code") {
      return context?.pre ? node.textContent || "" : `\`${normalizeInline(node.textContent || "")}\``;
    }
    if (tag === "blockquote") {
      const text = renderChildren(node)
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return block(text);
    }
    if (tag === "ul" || tag === "ol") {
      return block(renderList(node, tag === "ol"));
    }
    if (tag === "table") {
      return block(renderTable(node));
    }
    const children = renderChildren(node, { ...context, pre: tag === "pre" });
    return BLOCK_TAGS.has(tag) ? block(children.trim()) : children;
  }

  function renderLink(node) {
    const text = normalizeInline(node.textContent || "");
    const href = node.getAttribute("href") || "";
    if (!text) {
      return "";
    }
    if (!href || href === text) {
      return text;
    }
    return `[${escapeMarkdown(text)}](${href})`;
  }

  function renderImage(node) {
    const src = node.currentSrc || node.getAttribute("src") || "";
    if (!src) {
      return "";
    }
    const alt = node.getAttribute("alt") || "";
    return `\n![${escapeMarkdown(alt)}](${src})\n`;
  }

  function renderList(node, ordered) {
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((child, index) => {
        const prefix = ordered ? `${index + 1}.` : "-";
        const text = renderChildren(child).trim().replace(/\n+/g, "\n  ");
        return `${prefix} ${text}`;
      })
      .join("\n");
  }

  function renderTable(node) {
    const rows = Array.from(node.querySelectorAll("tr"))
      .slice(0, 80)
      .map((row) =>
        Array.from(row.querySelectorAll("th,td"))
          .map((cell) => normalizeInline(cell.textContent || "").replace(/\|/g, "\\|"))
          .filter(Boolean)
      )
      .filter((cells) => cells.length);
    if (!rows.length) {
      return "";
    }
    const header = rows[0];
    const divider = header.map(() => "---");
    return [header, divider, ...rows.slice(1)].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
  }

  function stripNoise(root) {
    root.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
    root.querySelectorAll("*").forEach((node) => {
      if (classWeight(node) < -700 && textLength(node) < 800) {
        node.remove();
      }
    });
  }

  function normalizeUrls(root, sourceUrl) {
    root.querySelectorAll("a[href], img[src], source[src], video[src]").forEach((node) => {
      const attr = node.hasAttribute("href") ? "href" : "src";
      const value = node.getAttribute(attr);
      const absolute = absoluteUrl(value, sourceUrl);
      if (absolute) {
        node.setAttribute(attr, absolute);
      }
    });
  }

  function collectImages(root) {
    return Array.from(root.querySelectorAll("img"))
      .map((img) => ({
        sourceUrl: img.currentSrc || img.getAttribute("src") || "",
        alt: img.getAttribute("alt") || "",
        width: Number(img.getAttribute("width") || img.naturalWidth || 0),
        height: Number(img.getAttribute("height") || img.naturalHeight || 0),
      }))
      .filter((image) => image.sourceUrl)
      .slice(0, 60);
  }

  function detectPagination(root, sourceUrl) {
    const next = root.querySelector('link[rel~="next"], a[rel~="next"]') || findNextLink(root);
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href");
    return {
      canonicalUrl: absoluteUrl(canonical, sourceUrl) || sourceUrl,
      nextUrl: absoluteUrl(next?.getAttribute("href"), sourceUrl) || "",
      detected: Boolean(next),
    };
  }

  function findNextLink(root) {
    const nextTextRe = /^(next|more|older|下一页|下页|加载更多|更多)$/i;
    return Array.from(root.querySelectorAll("a[href]")).find((link) => nextTextRe.test(normalizeInline(link.textContent || "")));
  }

  function bestTitle(root) {
    const title =
      root.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      root.querySelector("h1")?.textContent ||
      root.querySelector("title")?.textContent ||
      document.title ||
      location.href;
    return normalizeText(title);
  }

  function findByline(root) {
    const node =
      root.querySelector("[rel='author']") ||
      root.querySelector("[class*='author' i]") ||
      root.querySelector("[class*='byline' i]");
    return normalizeText(node?.textContent || "");
  }

  function isHidden(node) {
    return (
      node.hidden ||
      node.getAttribute("aria-hidden") === "true" ||
      node.getAttribute("style")?.includes("display:none") ||
      node.getAttribute("style")?.includes("visibility:hidden")
    );
  }

  function shouldSkipNode(node) {
    const tag = node.tagName?.toLowerCase();
    return ["script", "style", "noscript", "iframe", "svg"].includes(tag);
  }

  function block(value) {
    const text = String(value || "").trim();
    return text ? `\n\n${text}\n\n` : "";
  }

  function absoluteUrl(value, baseUrl) {
    if (!value) {
      return "";
    }
    try {
      return new URL(value, baseUrl).toString();
    } catch (error) {
      return value;
    }
  }

  function normalizeInline(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n+/g, " ")
      .trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeMarkdown(value) {
    return String(value || "").replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
  }

  window.ByClawReadabilityLite = { extract };
})();
