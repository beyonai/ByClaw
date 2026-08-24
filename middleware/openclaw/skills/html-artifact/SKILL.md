---
name: html-artifact
description: Create or modify polished HTML Artifact applications, including single-file pages and multi-file HTML/CSS/JavaScript sites. Use when an agent needs to build a webpage, form, interactive prototype, dashboard, report, landing page, survey, registration page, game, tracker, notes app, or other browser UI published through ByClaw; use the platform Artifact Data API whenever application data must survive reloads or be retrieved or updated later.
---

# HTML Artifact

Create a browser-ready HTML application and publish it with `$publish-html-preview`.

## Workflow

1. Clarify the page content, interaction, and which application data must persist across reloads.
2. Build the smallest suitable site:
   - Prefer one self-contained HTML file for simple pages.
   - Use a directory with relative CSS, JavaScript, image, and module paths for multi-file sites.
3. Use the platform Artifact Data API for any required JSON persistence, including application state, tasks, preferences, game progress, drafts, notes, configuration, results, and form submissions. Do not invent a backend or treat in-memory state, downloads, mail links, or `localStorage` alone as durable data storage.
4. Read [references/artifact-data-api.md](references/artifact-data-api.md) before implementing create, query, or update operations.
5. Verify layout, validation, loading, success, retry, and error states locally. Treat the data API as unavailable during `file://` preview.
6. Invoke `$publish-html-preview` to publish the finished file or site directory. Return its `previewUrl` to the user.

## Data and authentication rules

- Keep each logical dataset in a stable collection such as `tasks`, `preferences`, `game-saves`, `drafts`, or `submissions`.
- Store arbitrary application JSON that fits the documented limits. Submit only necessary data and validate it in the browser.
- Keep the returned `recordKey` whenever the application must query or update that record. The API does not list records, so the application must retain or otherwise know the key.
- Treat `recordKey` as a record-level capability. Anyone who has both the Artifact preview URL and a record key can query and update that record.
- Use `localStorage` only when appropriate to retain a `recordKey` or local UI preferences; remember that possession of the stored key grants record access, especially on shared devices. Never use local storage as a substitute for platform persistence.
- Use the latest returned `version` for updates and handle optimistic-lock conflicts instead of blindly overwriting data.
- Treat `BEYOND_TOKEN` as a sandbox-only secret. Never copy, interpolate, serialize, print, or expose its value in HTML, JavaScript, CSS, source maps, URLs, logs, generated assets, build output, example code, or responses to the user.
- Never generate browser code that reads, embeds, or sends `BEYOND_TOKEN`. A published page must not call the Agent-side owner API because every visitor can inspect its source and network requests.
- Use `BYAI_SERVICE_BASE_URL` and `BEYOND_TOKEN` only for Agent-side owner API calls executed by the Agent process inside the sandbox. Read both directly from the process environment at request time; keep them out of files and command output.
- Let a published page derive its capability-protected data endpoint from its Artifact preview URL as documented in the API reference.

## Publishing rules

- Use relative resource references. Do not use root-relative paths such as `/assets/app.js`.
- Preserve the editable source after publishing.
- Do not invent a preview link or substitute a sandbox-local path.
- Re-publish only after meaningful source changes; each publication creates a new Artifact capability and an independent data namespace.
