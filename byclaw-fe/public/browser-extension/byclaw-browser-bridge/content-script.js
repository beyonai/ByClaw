(function () {
  const PORTAL_SOURCE = "BYCLAW_PORTAL";
  const EXTENSION_SOURCE = "BYCLAW_EXTENSION";
  const PROTOCOL_VERSION = "1.1";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== PORTAL_SOURCE) {
      return;
    }
    if (event.data?.type === "BYCLAW_CAPTURE_PING") {
      chrome.runtime.sendMessage({ type: "BYCLAW_GET_EXTENSION_STATUS" }, (response) => {
        postToPortal("BYCLAW_CAPTURE_PONG", response?.status || { installed: true, protocolVersion: PROTOCOL_VERSION });
      });
      return;
    }
    if (event.data?.type === "BYCLAW_CAPTURE_UNBIND") {
      chrome.runtime.sendMessage({ type: "BYCLAW_CLEAR_BINDING" }, (response) => {
        postToPortal("BYCLAW_CAPTURE_UNBIND_ACK", response?.status || { installed: true, binding: { bound: false } });
      });
      return;
    }
    if (event.data?.type !== "BYCLAW_CAPTURE_BIND") {
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "BYCLAW_SAVE_BINDING",
        payload: event.data.payload,
      },
      (response) => {
        postToPortal("BYCLAW_CAPTURE_BIND_ACK", {
          ...(response?.status || {}),
          boundAt: new Date().toISOString(),
        });
      }
    );
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BYCLAW_COLLECT_CURRENT_PAGE") {
      collectCurrentPage()
        .then((page) => sendResponse(page))
        .catch((error) => sendResponse({ error: error.message || String(error), capturedAt: new Date().toISOString() }));
      return true;
    }
    if (message?.type === "BYCLAW_BRIDGE_COMMAND") {
      executeBridgeCommand(message.command || {})
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }
    return undefined;
  });

  async function executeBridgeCommand(command) {
    const action = command.action;
    if (action === "waitForSelector") {
      await waitForSelector(command.selector || "body", command.timeoutMs || 15000);
      return { ok: true };
    }
    if (action === "scroll") {
      await scrollPage(command);
      return { ok: true };
    }
    if (action === "click") {
      const element = queryRequired(command.selector);
      element.click();
      return { ok: true };
    }
    if (action === "input") {
      const element = queryRequired(command.selector);
      element.focus();
      element.value = command.value || "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (command.submit) {
        element.form?.requestSubmit?.();
      }
      return { ok: true };
    }
    if (action === "extract") {
      return collectCurrentPage(command.selectors || []);
    }
    if (action === "collectMailbox") {
      return collectMailbox(command);
    }
    if (action === "detectMailboxSession") {
      return detectMailboxSession(command);
    }
    return { ok: true, skipped: true };
  }

  async function collectCurrentPage(selectors = []) {
    const preparation = await preparePageForCapture();
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const selectedRoot = firstMatchedElement(selectors);
    const extracted =
      !selectedRoot && window.ByClawReadabilityLite?.extract
        ? window.ByClawReadabilityLite.extract({ sourceUrl: canonical })
        : fallbackExtract(canonical, selectedRoot);

    return {
      ...extracted,
      capturedAt: new Date().toISOString(),
      lazyLoadScrolls: preparation.lazyLoadScrolls,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    };
  }

  function fallbackExtract(sourceUrl, selectedRoot) {
    const title = document.title || location.href;
    const article = selectedRoot || document.querySelector("article") || document.querySelector("main") || document.body;
    const text = normalizeText(article?.innerText || document.body.innerText || "");
    const markdown = toMarkdown(title, sourceUrl, article || document.body);
    const images = Array.from((article || document).querySelectorAll("img"))
      .slice(0, 30)
      .map((img) => ({
        sourceUrl: img.currentSrc || img.src,
        alt: img.alt || "",
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      }))
      .filter((img) => img.sourceUrl);

    return {
      sourceUrl,
      title,
      markdown,
      html: document.documentElement.outerHTML,
      text,
      images,
      extractionMode: "DOM_FALLBACK",
      contentLength: text.length,
      pagination: {
        canonicalUrl: sourceUrl,
        nextUrl: document.querySelector('link[rel~="next"], a[rel~="next"]')?.href || "",
        detected: Boolean(document.querySelector('link[rel~="next"], a[rel~="next"]')),
      },
    };
  }

  async function preparePageForCapture() {
    const startX = window.scrollX;
    const startY = window.scrollY;
    const viewportHeight = Math.max(window.innerHeight || 0, 600);
    const totalHeight = () =>
      Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        document.body?.offsetHeight || 0,
        document.documentElement?.offsetHeight || 0
      );
    const maxScrolls = Math.min(6, Math.max(1, Math.ceil(totalHeight() / viewportHeight)));
    let lazyLoadScrolls = 0;
    for (let index = 1; index <= maxScrolls; index += 1) {
      const nextY = Math.min(totalHeight() - viewportHeight, Math.floor((totalHeight() / maxScrolls) * index));
      window.scrollTo(startX, Math.max(0, nextY));
      lazyLoadScrolls += 1;
      await delay(120);
    }
    window.scrollTo(startX, startY);
    await delay(60);
    return { lazyLoadScrolls };
  }

  function firstMatchedElement(selectors) {
    for (const selector of selectors || []) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      } catch (error) {
        // Ignore invalid connector-provided selector and try the next one.
      }
    }
    return null;
  }

  function queryRequired(selector) {
    if (!selector) {
      throw new Error("Command selector is required.");
    }
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    return element;
  }

  function waitForSelector(selector, timeoutMs) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for selector: ${selector}`));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(element);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function scrollPage(command) {
    const direction = command.direction || "bottom";
    const stepPx = Number(command.stepPx || 900);
    const maxSteps = Number(command.maxSteps || 8);
    const delayMs = Number(command.delayMs || 300);
    for (let index = 0; index < maxSteps; index += 1) {
      const before = window.scrollY;
      window.scrollBy(0, direction === "top" ? -stepPx : stepPx);
      await delay(delayMs);
      if (window.scrollY === before) {
        break;
      }
    }
  }

  async function collectMailbox(command) {
    await delay(800);
    if (!isQqMailHost(location.hostname)) {
      throw new Error(`当前页面不是 QQ 邮箱域名：${location.hostname}`);
    }
    if (isMailboxLoginPage()) {
      throw new Error("请先在本地浏览器登录 QQ 邮箱后重试。");
    }

    const scope = normalizeText(command.scope || "");
    const query = normalizeMailboxQuery(command.query || command.keyword || scope);
    const days = resolveMailboxDays(command.days || scope);
    const searched = query ? await trySearchMailbox(query) : false;
    const maxItems = Math.max(1, Math.min(Number(command.maxItems || 10), 30));
    const items = await collectVisibleMailItems(maxItems, { days });
    const fallbackText = items.length ? "" : extractLargestReadableBlock().text;
    const finalItems = items.length
      ? items
      : [
          {
            title: document.title || "QQ 邮箱页面",
            summary: "",
            text: fallbackText || normalizeText(document.body?.innerText || ""),
          },
        ].filter((item) => item.text);
    if (!finalItems.length) {
      throw new Error("未从 QQ 邮箱页面读取到可入库的邮件内容。");
    }

    const sourceUrl = location.href;
    const title = `QQ 邮箱采集${scope ? ` - ${scope}` : ""}`;
    const text = finalItems.map((item) => `${item.title}\n${item.text}`).join("\n\n");
    return {
      sourceUrl,
      title,
      markdown: mailboxToMarkdown({ title, sourceUrl, scope, query, days, searched, items: finalItems }),
      html: document.documentElement?.outerHTML || "",
      text,
      images: [],
      extractionMode: "QQ_MAIL_BRIDGE",
      contentLength: text.length,
      pagination: {
        provider: "qqmail",
        itemCount: finalItems.length,
        scope,
        query,
        days,
        searched,
      },
      capturedAt: new Date().toISOString(),
    };
  }

  async function detectMailboxSession(command) {
    if ((command.provider || "qqmail") !== "qqmail" || !isQqMailHost(location.hostname)) {
      return {
        ok: true,
        provider: command.provider || "qqmail",
        loggedIn: false,
        status: "NEED_LOGIN",
        statusName: "未打开 QQ 邮箱",
      };
    }
    await delay(200);
    const loggedIn = !isMailboxLoginPage();
    return {
      ok: true,
      provider: "qqmail",
      loggedIn,
      status: loggedIn ? "LOGGED_IN" : "NEED_LOGIN",
      statusName: loggedIn ? "已登录" : "未登录",
      sourceUrl: location.href,
      title: document.title || "QQ 邮箱",
      detectedAt: new Date().toISOString(),
    };
  }

  function isQqMailHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return (
      host === "mail.qq.com" ||
      host.endsWith(".mail.qq.com") ||
      host === "exmail.qq.com" ||
      host.endsWith(".exmail.qq.com") ||
      host === "mail.tencent.com" ||
      host.endsWith(".mail.tencent.com")
    );
  }

  function isMailboxLoginPage() {
    const title = normalizeText(document.title || "");
    const text = readableDocuments()
      .map((doc) => normalizeText((doc.body?.innerText || "").slice(0, 1500)))
      .join(" ");
    const hasMailShell = /收件箱|写信|通讯录|已发送|草稿箱|垃圾箱|星标邮件/.test(`${title} ${text}`);
    const hasLoginSignal = /登录|扫码|账号密码|Sign in|login/i.test(`${title} ${text} ${location.href}`);
    return hasLoginSignal && !hasMailShell;
  }

  async function trySearchMailbox(query) {
    const input = findFirstVisibleElement([
      "input[type='search']",
      "input[placeholder*='搜索']",
      "input[aria-label*='搜索']",
      "input[name*='search' i]",
      "input[id*='search' i]",
      ".search input",
      "#search",
      "#searchInput",
    ]);
    if (!input) {
      return false;
    }
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    const button = findFirstVisibleElement(["button[type='submit']", "button", "[role='button']"], (element) =>
      /搜索|search/i.test(normalizeText(element.innerText || element.getAttribute("aria-label") || ""))
    );
    button?.click();
    await delay(1800);
    return true;
  }

  async function collectVisibleMailItems(maxItems, options = {}) {
    const items = [];
    const seen = new Set();
    for (let index = 0; index < maxItems; index += 1) {
      const rows = findMailRows();
      const row = rows.find((candidate) => {
        const key = normalizeText(candidate.innerText || candidate.textContent || "").slice(0, 180);
        return key && !seen.has(key);
      });
      if (!row) {
        break;
      }
      const rowText = normalizeText(row.innerText || row.textContent || "");
      const rowKey = rowText.slice(0, 180);
      seen.add(rowKey);
      row.scrollIntoView?.({ block: "center", inline: "nearest" });
      await delay(120);
      row.click();
      await delay(1200);
      const detail = extractMailDetail(rowText, index);
      if (!isMailboxTextWithinDays(`${rowText}\n${detail.text || ""}`, options.days)) {
        continue;
      }
      items.push({
        title: detail.title,
        summary: rowText,
        text: detail.text || rowText,
      });
    }
    return items;
  }

  function findMailRows() {
    const selectors = [
      "tr[role='row']",
      "[role='row']",
      "tr[class*='mail' i]",
      "tr[class*='list' i]",
      "li[class*='mail' i]",
      "li[class*='item' i]",
      ".mail_item",
      ".mail-list-item",
      ".mail_list li",
      ".iMList li",
      ".list_item",
      "tr",
    ];
    const elements = [];
    const visited = new Set();
    for (const doc of readableDocuments()) {
      for (const selector of selectors) {
        for (const element of safeQueryAll(doc, selector)) {
          if (visited.has(element)) {
            continue;
          }
          visited.add(element);
          const text = normalizeText(element.innerText || element.textContent || "");
          if (isVisible(element) && looksLikeMailRow(text)) {
            elements.push(element);
          }
        }
      }
    }
    return elements;
  }

  function extractMailDetail(rowText, index) {
    const block = extractLargestReadableBlock();
    const text = block.text && !sameShortText(block.text, rowText) ? block.text : rowText;
    return {
      title: inferMailTitle(rowText, text, index),
      text,
    };
  }

  function extractLargestReadableBlock() {
    const selectors = [
      "[id*='mailContent' i]",
      "[class*='mailContent' i]",
      "[class*='mail_content' i]",
      "[class*='readmail' i]",
      "[class*='read' i]",
      "[class*='content' i]",
      "article",
      "main",
      "body",
    ];
    const blocks = [];
    for (const doc of readableDocuments()) {
      for (const selector of selectors) {
        for (const element of safeQueryAll(doc, selector)) {
          const text = normalizeText(element.innerText || element.textContent || "");
          if (isVisible(element) && text.length > 30 && !looksLikeMailboxChrome(text)) {
            blocks.push({ text, length: text.length });
          }
        }
      }
    }
    blocks.sort((a, b) => b.length - a.length);
    return blocks[0] || { text: "" };
  }

  function inferMailTitle(rowText, detailText, index) {
    const candidates = normalizeText(rowText)
      .split(/\n| {2,}|收件箱|未读|已读/)
      .map((item) => normalizeText(item))
      .filter((item) => item.length >= 2 && item.length <= 80 && !/^\d{1,2}[:/-]\d{1,2}/.test(item));
    return candidates[0] || normalizeText(detailText).split("\n")[0]?.slice(0, 80) || `邮件 ${index + 1}`;
  }

  function mailboxToMarkdown({ title, sourceUrl, scope, query, days, searched, items }) {
    const lines = [
      `# ${title}`,
      "",
      `> Source: ${sourceUrl}`,
      "",
      "- 来源：QQ 邮箱网页版",
      `- 采集时间：${new Date().toISOString()}`,
    ];
    if (scope) {
      lines.push(`- 范围：${scope}`);
    }
    if (query) {
      lines.push(`- 搜索关键词：${query}`);
      lines.push(`- 搜索执行：${searched ? "是" : "否"}`);
    }
    if (days) {
      lines.push(`- 时间过滤：最近 ${days} 天`);
    }
    lines.push("");
    items.forEach((item, index) => {
      lines.push(`## ${index + 1}. ${item.title}`, "");
      if (item.summary && !sameShortText(item.summary, item.text)) {
        lines.push(`> 列表摘要：${item.summary}`, "");
      }
      lines.push(item.text, "");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeMailboxQuery(value) {
    const text = normalizeText(value)
      .replace(/最近\s*\d+\s*天/g, "")
      .replace(/最近一周|最近两周|最近一个月|全部|收件箱|QQ邮箱|邮箱|采集|同步/g, "")
      .replace(/[，。,；;：:]+/g, " ")
      .trim();
    return text.length >= 2 ? text.slice(0, 80) : "";
  }

  function resolveMailboxDays(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(1, Math.min(365, Math.floor(value)));
    }
    const text = normalizeText(value || "");
    const match = text.match(/(?:最近|近)\s*(\d{1,3})\s*天/);
    if (match) {
      return Math.max(1, Math.min(365, Number(match[1])));
    }
    if (/最近一周|近一周/.test(text)) {
      return 7;
    }
    if (/最近两周|近两周/.test(text)) {
      return 14;
    }
    if (/最近一个月|近一个月/.test(text)) {
      return 30;
    }
    return 7;
  }

  function isMailboxTextWithinDays(text, days) {
    const date = extractMailboxDate(text);
    if (!date || !days) {
      return true;
    }
    const start = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
    return date.getTime() >= start && date.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
  }

  function extractMailboxDate(text) {
    const normalized = normalizeText(text || "");
    const fullDate = normalized.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (fullDate) {
      return new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]));
    }
    const shortDate = normalized.match(/(?:^|\s)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s|$)/);
    if (shortDate) {
      const now = new Date();
      const date = new Date(now.getFullYear(), Number(shortDate[1]) - 1, Number(shortDate[2]));
      if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
        date.setFullYear(date.getFullYear() - 1);
      }
      return date;
    }
    if (/前天/.test(normalized)) {
      return daysAgo(2);
    }
    if (/昨天/.test(normalized)) {
      return daysAgo(1);
    }
    if (/今天|\b\d{1,2}:\d{2}\b/.test(normalized)) {
      return daysAgo(0);
    }
    return null;
  }

  function daysAgo(days) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date;
  }

  function readableDocuments() {
    const docs = [document];
    for (const frame of document.querySelectorAll("iframe, frame")) {
      try {
        if (frame.contentDocument?.body && !docs.includes(frame.contentDocument)) {
          docs.push(frame.contentDocument);
        }
      } catch (error) {
        // Cross-origin frames are expected on some login shells; ignore them.
      }
    }
    return docs;
  }

  function findFirstVisibleElement(selectors, predicate = () => true) {
    for (const doc of readableDocuments()) {
      for (const selector of selectors) {
        for (const element of safeQueryAll(doc, selector)) {
          if (isVisible(element) && predicate(element)) {
            return element;
          }
        }
      }
    }
    return null;
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function isVisible(element) {
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function looksLikeMailRow(text) {
    if (!text || text.length < 8 || text.length > 900) {
      return false;
    }
    if (/QQ邮箱.*登录|扫码登录|账号密码登录/.test(text)) {
      return false;
    }
    if (text.length < 120 && /写信|收信|通讯录|设置|帮助|退出|邮箱首页/.test(text)) {
      return false;
    }
    return true;
  }

  function looksLikeMailboxChrome(text) {
    return text.length < 260 && /写信|收信|通讯录|设置|帮助|退出|邮箱首页|文件中转站/.test(text);
  }

  function sameShortText(left, right) {
    return normalizeText(left).slice(0, 160) === normalizeText(right).slice(0, 160);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function postToPortal(type, payload) {
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type,
        payload,
      },
      safeTargetOrigin()
    );
  }

  function safeTargetOrigin() {
    return location.origin && location.origin !== "null" ? location.origin : "*";
  }

  function toMarkdown(title, sourceUrl, root) {
    const lines = [`# ${title}`, "", `> Source: ${sourceUrl}`, ""];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = normalizeText(node.nodeValue || "");
        if (value) {
          lines.push(value);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag.slice(1));
          const text = normalizeText(node.innerText || "");
          if (text) {
            lines.push("", `${"#".repeat(Math.min(level + 1, 6))} ${text}`, "");
          }
          walker.currentNode = node;
        } else if (tag === "img") {
          const src = node.currentSrc || node.src;
          if (src) {
            lines.push(`![${node.alt || ""}](${src})`);
          }
        } else if (tag === "a") {
          const text = normalizeText(node.innerText || node.textContent || "");
          if (text && node.href) {
            lines.push(`[${text}](${node.href})`);
            walker.currentNode = node;
          }
        } else if (["p", "section", "article", "li", "blockquote", "pre"].includes(tag)) {
          lines.push("");
        }
      }
      node = walker.nextNode();
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
})();
