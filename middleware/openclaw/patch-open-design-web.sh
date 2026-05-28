#!/usr/bin/env sh
set -eu

WEB_OUT="${WEB_OUT:-/opt/open-design/apps/web/out}"
export WEB_OUT

node <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.env.WEB_OUT || "/opt/open-design/apps/web/out";

const css = `
<style id="od-custom-ui-patch">
  .app-chrome-header {
    display: none !important;
  }

  .workspace-shell {
    grid-template-rows: minmax(0, 1fr) !important;
  }

  .entry-main__topbar {
    display: none !important;
  }

  .entry-shell--no-header .entry-nav-rail {
    display: none !important;
  }

  .entry-shell--no-header .entry {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .entry-shell--no-header .entry-main {
    grid-column: 1 / -1 !important;
  }

  :root {
    --accent: #2563eb !important;
    --accent-strong: #1d4ed8 !important;
    --accent-soft: #dbeafe !important;
    --accent-tint: #eff6ff !important;
    --accent-hover: #1d4ed8 !important;
  }

  [data-theme="dark"] {
    --accent: #60a5fa !important;
    --accent-strong: #93c5fd !important;
    --accent-soft: #1e3a5f !important;
    --accent-tint: #172033 !important;
    --accent-hover: #93c5fd !important;
  }

  @media (prefers-color-scheme: dark) {
    html:not([data-theme]) {
      --accent: #60a5fa !important;
      --accent-strong: #93c5fd !important;
      --accent-soft: #1e3a5f !important;
      --accent-tint: #172033 !important;
      --accent-hover: #93c5fd !important;
    }
  }
</style>
`;

const js = `
<script id="od-parent-message-patch">
(function () {
  function applyBlueTheme() {
    try {
      var key = "open-design:config";
      var raw = localStorage.getItem(key) || "{}";
      var cfg = JSON.parse(raw);
      if (!cfg || typeof cfg !== "object") cfg = {};
      cfg.accentColor = "#2563eb";
      localStorage.setItem(key, JSON.stringify(cfg));

      var s = document.documentElement.style;
      s.setProperty("--accent", "#2563eb");
      s.setProperty("--accent-strong", "color-mix(in srgb, #2563eb 86%, var(--text-strong))");
      s.setProperty("--accent-soft", "color-mix(in srgb, #2563eb 22%, var(--bg-panel))");
      s.setProperty("--accent-tint", "color-mix(in srgb, #2563eb 12%, var(--bg-panel))");
      s.setProperty("--accent-hover", "color-mix(in srgb, #2563eb 90%, var(--text-strong))");
    } catch (e) {}
  }

  function notifyParent() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: "createSummary",
      data: {
        content: "设计任务任务已完成"
      }
    }, "*");
    console.log("设计消息已发送");
  }

  applyBlueTheme();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", notifyParent, { once: true });
  } else {
    notifyParent();
  }
})();
</script>
`;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      walk(file);
    } else if (file.endsWith(".html")) {
      patchHtml(file);
    }
  }
}

function patchHtml(file) {
  let html = fs.readFileSync(file, "utf8");
  let changed = false;

  if (!html.includes('id="od-custom-ui-patch"') && html.includes("</head>")) {
    html = html.replace("</head>", `${css}\n</head>`);
    changed = true;
  }

  if (!html.includes('id="od-parent-message-patch"') && html.includes("</body>")) {
    html = html.replace("</body>", `${js}\n</body>`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, html);
    console.log(`[patch-open-design-web] patched ${file}`);
  }
}

if (!fs.existsSync(root)) {
  throw new Error(`web output not found: ${root}`);
}

walk(root);
NODE
