# byCLI Weixin executor rules

Load this reference for every `bycli weixin` command; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication or verification failures from `mp.weixin.qq.com`.

This reference tracks the Weixin command surface in `@sovovs/bycli` 2.1.19. Treat `bycli weixin --help -f yaml` and `bycli weixin <command> --help -f yaml` as the source of truth when the installed version differs. This reference only defines Weixin command execution, authentication gates, session handling, and returned records. When a caller delegates the task, return all requested records, bodies, and file metadata to that caller without choosing a canonical artifact name or storage layout.

## Command selection

| Command | Access | Purpose and important output |
|---|---|---|
| `accounts <query>` | read | Search official accounts; returns `nickname`, `fakeid`, and `alias`. Default `--limit` is 10. |
| `articles <fakeid>` | read | List account articles; returns `title`, `author`, `digest`, `publishedAt`, and `url`. Supports `--name`, `--limit`, and `--max-pages`. |
| `collections` | read | List content collections; returns IDs, type, item/view counts, update/payment flags, timestamps, and `coverUrl`. Defaults: `--limit 20 --max-pages 5`. |
| `collection-detail <collectionId>` | read | Return one collection's metadata, `settingsJson`, and `itemsJson`. Default `--max-pages` is 5. |
| `drafts` | read | List draft titles and times. Defaults: `--limit 10 --timeout 60`. |
| `published [query]` | read | List published records and engagement metrics; optional title or URL substring filter. Defaults: `--limit 10 --max-pages 5 --timeout 30`. |
| `download --url <article-url>` | read | Save one article as Markdown; returns title, author, publish time, status, size, and saved path. Defaults: `--output ./weixin-articles --download-images true`. |
| `save-articles <fakeid>` | write | Save account articles as Markdown; returns per-record status, stage, path, error, and URL. Supports `--name`, `--output`, `--limit`, and `--max-pages`. |
| `download-publish-data <query>` | write | Match an exact article URL or title and download its detail spreadsheet; returns title, publication time, URL, status, path, and size. Defaults: `--output ./weixin-publish-data --max-pages 5 --timeout 60`. |
| `create-draft <content>` | write | Create a Weixin article draft; requires `--title`, supports `--author`, `--cover-image`, `--summary`, and `--timeout` (default 180), and returns `status` and `detail`. |

Use IDs from the corresponding list command: `accounts` supplies the `fakeid` for `articles` and `save-articles`; `collections` supplies the `collectionId` for `collection-detail`.

`create-draft` mutates the official account. Execute it only when the user explicitly requests draft creation and has supplied or approved the final title and body. A returned `save attempted, check browser to confirm` status is not confirmation that the draft was saved; report that status exactly and ask the user to verify the open browser.

`download-publish-data` accepts an exact article URL or title. If a title matches multiple records, do not guess: rerun with the complete URL or add `--date YYYY-MM-DD` using a user-provided or already-known publication date.

## Browser session

- Use browser authentication by default. Every browser-backed Weixin command must include `--site-session persistent --keep-tab true`.
- Before browser commands, complete the main skill's `doctor` and `daemon status` checks. Reuse the Chrome session for `mp.weixin.qq.com`.
- A newly leased adapter tab may begin at `about:blank`. The adapter navigates to `mp.weixin.qq.com` and then re-reads page state. If existing cookies redirect it to an authenticated `/cgi-bin/` URL with a non-empty token, continue the command; do not reproduce this check with `bycli browser`.
- Only `accounts`, `articles`, and `save-articles` support `--auth-source env`. All other Weixin commands require Browser Bridge and the logged-in browser session.
- Pass only options shown by that command's structured help. In particular, `accounts`, `articles`, `collections`, `collection-detail`, `download`, and `save-articles` do not support `--timeout`; never add a generic `--timeout 180` to them.
- Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser, login, or verification failure.

```bash
bycli weixin accounts "<account name>" --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin articles '<fakeid>' --limit <n> --max-pages <n> --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin collections --limit <n> --max-pages <n> --site-session persistent --keep-tab true -f json
bycli weixin collection-detail '<collectionId>' --max-pages <n> --site-session persistent --keep-tab true -f json
bycli weixin drafts --limit <n> --timeout 60 --site-session persistent --keep-tab true -f json
bycli weixin published '<optional title or URL>' --limit <n> --max-pages <n> --timeout 30 --site-session persistent --keep-tab true -f json
bycli weixin download --url '<article-url>' --output '<directory>' --download-images true --site-session persistent --keep-tab true -f json
bycli weixin save-articles '<fakeid>' --limit <n> --max-pages <n> --output '<directory>' --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin download-publish-data '<exact URL or title>' --date YYYY-MM-DD --output '<directory>' --max-pages <n> --timeout 60 --site-session persistent --keep-tab true -f json
bycli weixin create-draft '<content>' --title '<title>' --author '<author>' --cover-image '<local path>' --summary '<summary>' --timeout 180 --site-session persistent --keep-tab true -f json
```

Omit optional placeholders and their flags rather than passing empty strings. `--author` is limited to 8 characters and `--title` to 64 characters. `--cover-image` must be a readable local image path; the adapter uploads it into the article body before selecting it as the cover. Failure to select the uploaded image as the cover can be non-fatal, so report the returned draft detail rather than claiming the cover was set.

## Login and verification gate

After the adapter's post-navigation check, treat login `AUTH_REQUIRED` / exit code 77, legacy or outer login `TIMEOUT` / exit code 75, anti-bot prompts, CAPTCHAs, sliders, SMS/security checks, and WeChat environment-verification pages as a required human gate. This includes “环境异常，完成验证后即可继续访问” and its “去验证” button. These are not Adapter defects; do not enter AutoFix or modify Adapter code.

1. Stop all tool execution immediately. Do not click, bypass, refresh, retry, navigate, focus another page, switch authentication source, or use another acquisition method.
2. Freeze the current browser context. Do not issue another Weixin, raw browser, doctor, daemon, or browser-lifecycle command; keep the current tab and processes available for the user.
3. Ask the user to complete verification in the already open tab and explicitly confirm completion. The user—not the agent—clicks “去验证”. End the current turn.
4. While waiting, do not inspect page state or run a status check.
5. After the user's next explicit confirmation, rerun the interrupted command exactly once with `--site-session persistent --keep-tab true`; do not perform a preflight check.
6. If that single rerun still returns an authentication error, report the exact error and stop.

On the first login `TIMEOUT`, follow this gate immediately. Do not change `BYCLI_BROWSER_COMMAND_TIMEOUT`, open a second login page, inspect a retained `about:blank` tab, or issue another command before confirmation. After confirmation, the rerun reads the token from the authenticated backend URL and obtains domain cookies, including HttpOnly cookies, through Browser Bridge.

## Returned records and local files

- Preserve the complete structured output for the requested scope; do not silently discard fields that are not displayed in the default table format.
- Preserve partial successes. Return completed records and identify each failed or incomplete record with its original Adapter `status`, `stage`, and `error` where available.
- For local-file commands, return the resolved `saved` or `path`, `size`, and status alongside the corresponding record. Never claim a file exists unless the returned path is readable.
- For `articles`, return the 完整文章索引 for the requested `--limit` / `--max-pages` scope. Preserve title, URL, author, digest, and publish time.
- For `save-articles`, return the saved 正文 and each `path` (the current equivalent of legacy `fileName` metadata) alongside the corresponding record. Do not redownload records already returned with a readable saved file.
- For a requested article that has not been saved, use `weixin download --url '<article-url>'`, then return its body and file metadata.
- `collection-detail` serializes nested settings and items into `settingsJson` and `itemsJson`. Parse these JSON strings before summarizing them, but also preserve the original values in delegated results.
- `published` returns `notified`, `failed`, `reads`, `likes`, `shares`, `recommends`, `comments`, `underlines`, and `reprints`. Keep zero values; do not treat them as missing.
- `drafts` exposes only `Index`, `Title`, and `Time`; do not imply that draft body or edit URL was returned.

The executor response must provide a 可点击预览 for every record with a URL and its body/file status, for example:

```markdown
- [文章标题](https://mp.weixin.qq.com/s/...) — 已返回正文与文件元数据
- [另一篇文章](https://mp.weixin.qq.com/s/...) — 仅返回索引或发布数据
```

If an entry lacks a URL, mark its preview unavailable and report the incomplete record while returning the remaining records. Collection `coverUrl` values may be linked as cover previews, but they are not article URLs.

## Environment authentication

Use `--auth-source env` only when the user explicitly requests it or Browser Bridge is unavailable in CI/headless automation:

| Command | Complete same-session credential set |
|---|---|
| `articles`, `save-articles` | `WECHAT_TOKEN` + `WECHAT_COOKIE` |
| `accounts` | `WECHAT_TOKEN` + `WECHAT_COOKIE` + `WECHAT_FINGERPRINT` |

Never use environment authentication for `collections`, `collection-detail`, `drafts`, `published`, `download`, `download-publish-data`, or `create-draft`; those commands do not expose `--auth-source`.

Never mix browser-derived and environment-derived values. If variables are missing, name them without displaying their values. If all variables exist but authentication fails, ask the user to replace the complete same-session set because it may be expired or mixed across sessions.

Never request credential values in chat. Tell the user to obtain and inject them locally:

1. Sign in to `https://mp.weixin.qq.com/` in Chrome and enter an authenticated `/cgi-bin/` backend page.
2. Open DevTools **Network**, then refresh or perform the relevant account/article action.
3. Select an authenticated request whose origin is exactly `https://mp.weixin.qq.com`.
4. Set `WECHAT_TOKEN` from the request URL's non-empty `token` query parameter and `WECHAT_COOKIE` from the complete `Cookie` request header. Do not use `document.cookie`; it omits required HttpOnly cookies.
5. For `accounts`, set `WECHAT_FINGERPRINT` from the `fingerprint` query parameter of the matching `search_biz` request.
6. Ensure every value came from the same current login session. Replace the complete set when the session expires.

Use a secret manager or hidden shell input. Do not place literal values in arguments, shell history, committed `.env` files, fixtures, logs, traces, or skill files:

```bash
IFS= read -r -s WECHAT_TOKEN
IFS= read -r -s WECHAT_COOKIE
export WECHAT_TOKEN WECHAT_COOKIE
bycli weixin articles '<fakeid>' --auth-source env -f json
unset WECHAT_TOKEN WECHAT_COOKIE
```

For `accounts`, collect, export, and unset `WECHAT_FINGERPRINT` the same way. Never echo, inspect, serialize, retain, or return token, Cookie, fingerprint, or sensitive Cookie values.
