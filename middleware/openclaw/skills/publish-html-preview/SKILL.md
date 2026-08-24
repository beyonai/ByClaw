---
name: publish-html-preview
description: Publish generated HTML files or multi-file HTML/CSS/JavaScript sites from an agent sandbox to the ByClaw Artifact service and return a temporary browser-accessible preview URL. Use when an agent has created a webpage, prototype, report, visualization, or other HTML output whose scripts, styles, modules, images, routing, or relative resources require HTTP hosting to preview correctly; also use when the user asks to deploy, host, open, or preview generated HTML. Do not use for code snippets that have not been materialized as files or when the user only requested source files without a hosted preview.
---

# Publish HTML Preview

Publish generated web content through the ByClaw Artifact API. Treat the returned preview URL as the user-facing deliverable; a sandbox-local file path is not a substitute for a hosted preview.

## Workflow

1. Finish and locally verify the webpage before publishing it.
2. Select the upload root:
   - For a site with HTML, CSS, JavaScript, images, modules, or other relative resources, pass the common site directory.
   - For one self-contained HTML file, pass that file.
   - For an existing site ZIP, pass the ZIP and provide `--entry-point` when its entry is not root `index.html`.
3. Ensure site references are relative, such as `assets/app.js` or `./assets/app.css`. Avoid root-relative references such as `/assets/app.js`, because the preview is hosted below an Artifact-specific path.
4. Run the bundled publisher from this Skill's directory:

```bash
python3 scripts/publish_html_preview.py --path /absolute/path/to/site
```

For a non-default entry page:

```bash
python3 scripts/publish_html_preview.py \
  --path /absolute/path/to/site \
  --entry-point pages/demo.html \
  --display-name "Interactive demo"
```

5. Read the JSON printed to stdout. Require `ok: true`, `status: "READY"`, and a non-empty `previewUrl`.
6. Return `previewUrl` as a clickable link. Briefly report any `warnings`. Include `downloadUrl` only when it helps the user or the user asks to download the source package.

## Runtime Contract

- Read authentication only from `BEYOND_TOKEN`. Never ask the user to paste it, print it, put it in a command argument, or persist it in a file.
- Read the discovered backend base URL from `BYAI_SERVICE_BASE_URL`. The sandbox host must populate this variable with the result of `discover_backend_base_url`; the value already includes protocol, host, port, and any context path such as `/byaiService`.
- As compatibility fallbacks, the script also accepts `BAIYING_HUB_BASE_URL` and `BAIYING_WORKSPACE_ARCHIVE_BASE_URL`, matching the backend discovery contract.
- Fail clearly when authentication or backend discovery is unavailable. Do not guess localhost, cluster service names, ports, or public domains.
- Keep capability URLs private except when returning them to the requesting user. Anyone possessing a preview or download URL can access the Artifact until it expires or is revoked.

## Publishing Behavior

- A directory is ZIP-compressed with its contents at the archive root and published as `SITE`. Symlinks are rejected.
- A single HTML file is published as `FILE` through API `AUTO` mode.
- An existing ZIP is published through `AUTO`, or as `SITE` when `--entry-point` is provided.
- The default entry point for a directory is `index.html`.
- The default lifetime is seven days. Use `--expires-in-seconds` only when the task requires a shorter or longer lifetime; the service maximum is 30 days.
- The script sends SHA-256 for server-side integrity verification and streams multipart content instead of loading the whole upload into memory.
- Preserve the generated source files after upload. Artifact publication is not a replacement for saving the user's requested deliverables.

## Failure Handling

- If local validation fails, fix the site before uploading.
- If the API rejects the upload, report the concise error without exposing headers, environment variables, or tokens.
- If `previewUrl` is absent, do not invent a URL. Report that the Artifact was uploaded without an HTML preview and check the entry point and archive layout.
- Do not repeatedly upload unchanged content after a successful response; each upload creates a new capability URL and stored Artifact.
