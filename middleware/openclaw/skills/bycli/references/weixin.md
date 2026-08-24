# byCLI Weixin executor rules

Load this reference for every `bycli weixin` command; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication or verification failures from `mp.weixin.qq.com` or `weixin.sogou.com`.

This reference tracks the Weixin command surface in `@sovovs/bycli` 2.1.35. Treat `bycli weixin --help -f yaml` and `bycli weixin <command> --help -f yaml` as the source of truth when the installed version differs. This reference only defines Weixin command execution, authentication gates, session handling, and returned records. When a caller delegates the task, return all requested records, bodies, and file metadata to that caller without choosing a canonical artifact name or storage layout.

## Command selection

| Command | Access | Purpose and important output |
|---|---|---|
| `accounts <query>` | read | Search official accounts; returns `nickname`, `fakeid`, and `alias`. Default `--limit` is 10. |
| `articles <fakeid>` | read | List account articles; returns `title`, `author`, `digest`, `publishedAt`, `url`, `source`, and `coverage`. Supports `--name`, `--limit`, and `--max-pages`. |
| `sougousearch <query>` | read | Search Sogou Weixin for articles; returns `rank`, `page`, `title`, `account`, `url`, `summary`, and `publish_time`. Defaults: `--page 1 --limit 10`; maximum `--limit` is 10. |
| `collections` | read | List content collections; returns IDs, type, item/view counts, update/payment flags, timestamps, and `coverUrl`. Defaults: `--limit 20 --max-pages 5`. |
| `collection-detail <collectionId>` | read | Return one collection's metadata, `settingsJson`, and `itemsJson`. Default `--max-pages` is 5. |
| `drafts` | read | List draft titles and times. Defaults: `--limit 10 --timeout 60`. |
| `published [query]` | read | List published records and engagement metrics; optional title or URL substring filter. Defaults: `--limit 10 --max-pages 5 --timeout 30`. |
| `download --url <article-url>` | read | Save one article as Markdown from either a direct WeChat article URL or a Sogou `/link` result; returns title, author, publish time, status, size, saved path, `source_url`, and `resolved_url`. Defaults: `--output ./weixin-articles --download-images true`. |
| `save-articles <fakeid>` | write | Save account articles as Markdown; returns per-record status, stage, path, error, URL, `source`, and `coverage`. Supports `--name`, `--output`, `--limit`, and `--max-pages`. |
| `download-publish-data <query>` | write | Match an exact article URL or title and save both its Excel data and Markdown analysis; returns title, publication time, URL, status, `markdownPath`, `markdownSize`, `dataPath`, `dataSize`, and error. Defaults: `--output ./weixin-publish-data --max-pages 5 --timeout 60`. |
| `create-draft [content]` | write | Create a Weixin article draft; requires `--title`, accepts inline text or `--content-file`, supports `text`, `html`, and `html-text` content formats, browser rich-text paste, official API mode, `--author`, `--cover-image`, `--summary`, `--dry-run`, and `--timeout` (default 180). Returns `status` and `detail`. |

Use IDs from the corresponding list command: `accounts` supplies the `fakeid` for `articles` and `save-articles`; `collections` supplies the `collectionId` for `collection-detail`.

## Official-account and article discovery

Classify discovery intent before choosing a command. A direct article URL, an already selected `fakeid`, and requests for drafts, collections, or the authenticated account's own published data bypass discovery and use their corresponding command directly. When a bare phrase has no explicit account-history or article-title/topic cue, ask one clarification question before running either discovery command; do not infer intent from text equality, search ranking, or a speculative first search.

1. **Explicit account identity or account-history intent starts with `accounts`.** This includes a supplied nickname, account name, alias, original ID, or a request for one account's historical posts. Derive `searchQuery` from that identity and run `accounts '<searchQuery>' --limit 10`.
2. Normalize `searchQuery` and each returned `nickname` and non-empty `alias` by trimming surrounding whitespace and applying case-insensitive comparison. De-duplicate records by `fakeid`. A record is exact only when normalized `nickname` or `alias` equals normalized `searchQuery`; substring, token, semantic, and rank similarity are not exact matches.
3. Branch on exact account matches:
   - **One exact match:** Select it. Return the account for identity-only requests; for listing or saving, continue with its `fakeid` and exact nickname as `--name`. The adapter may use its bounded nickname-scoped fallback under the rules below.
   - **Multiple exact matches:** Do not select one. Run `articles '<fakeid>' --limit 3 --max-pages 1` sequentially for each candidate and return numbered previews with nickname, alias, recent titles, and publication times. Preserve non-authentication preview failures; any authentication gate stops remaining previews. After the user selects a `fakeid`, omit `--name` when the selected nickname is still shared, keeping the resumed command backend-only.
   - **No exact match:** Return at most three fuzzy account suggestions from the original response and stop. Do not call `sougousearch`, select an account, or reinterpret it as topic intent. A successful empty account result is reported as no matching account and is terminal.
4. **Article-title or topic intent starts with `sougousearch`.** Run `sougousearch '<searchQuery>' --page 1 --limit <n>` directly and return its article results. Do not run `accounts` merely because the query text could equal a nickname. If no result title is an exact match for the requested title and only 高度相关候选 are available, return the candidate metadata and 必须先询问用户确认；未确认不得下载、不得返回 Markdown 正文。Only an explicitly confirmed candidate may pass its returned 搜狗 `/link` URL to `download`; return the Markdown body only after the `saved` path is readable.
5. A valid empty result from either branch is a completed search outcome. Report the empty scope and stop without changing intent, retrying, or entering AutoFix. Command failures are not empty results: preserve the typed error and apply the terminal-state precedence below.

## Adapter-owned Sogou fallback identity

`articles` and `save-articles` may run their adapter-owned Sogou fallback only after a `fakeid` has been selected and only for browser-authenticated primary `COMMAND_EXEC` or `EMPTY_RESULT` outcomes. Only an exact nickname from one unique `accounts` result whose `fakeid` equals the selected `fakeid` may be passed as `--name`; a merely non-empty name is insufficient. The fallback never runs for `AUTH_REQUIRED`, login/CAPTCHA/environment verification, argument errors, interruption, unknown errors, or `--auth-source env`.

The fallback's exact case-insensitive nickname filter yields nickname-scoped public results, not `fakeid`-proven account history. Substring, alias, punctuation, internal-whitespace, and fuzzy variants are excluded. If account discovery exposes multiple distinct `fakeid` values with the same exact nickname, omit `--name` and keep the command backend-only even after the user selects one candidate. Public results from distinct or unresolved account identities must not be merged or attributed to the selected `fakeid`.

For a direct `fakeid` request, run the backend path without `--name` unless the unique binding above is already known. A user-supplied nickname beside a direct `fakeid` is not identity proof by itself. If the backend command returns a terminal browser execution or empty result and the user wants public fallback, ask for the exact nickname before offering public fallback when it is absent, then validate it with `accounts`. Rerun with `--name` only when that lookup returns exactly one exact record with the same `fakeid`; zero, multiple, or mismatched exact records keep the command backend-only and require clarification. Do not call `sougousearch` independently or guess identity from `fakeid`.

The internal fallback scans sequentially until an explicit empty page, an explicit `--max-pages`, or the default 50-page bound. It collects the bounded set before deduplication, descending publication-time sorting, and final `--limit` selection. `coverage: search-exhausted` means Sogou returned an explicit empty page; `coverage: max-pages-reached` means the result is capped and must not be described as complete official-account history. `articles` requires every selected Sogou link to resolve to a trusted WeChat article URL; `save-articles` preserves non-authentication link failures as `status: failed`, `stage: resolve` rows while keeping other readable Markdown files.

## Direct command safeguards

`create-draft` mutates the official account. Execute it only when the user explicitly requests draft creation and has supplied or approved the final title and body. The command validates title, body, author, and any requested cover before performing the write.

Publishing modes:

- Before every real `create-draft` write, test only whether `WECHAT_APPID` and `WECHAT_APPSECRET` both exist and remain non-empty after trimming whitespace. Never print, echo, serialize, log, or return either value. If both are non-empty, pass them as `--appid "$WECHAT_APPID" --appsecret "$WECHAT_APPSECRET"` and try official API mode first. If either variable is absent or empty, pass neither API option and go directly to browser mode; a partial environment pair must never reach the command.
- Official API mode uploads the cover and local body images through the official material API, then creates the draft with `draft/add`; `--cover-image` is required. When structured help reports `browser: conditional`, do not run `doctor`, daemon checks, Browser Bridge, `--site-session`, or `--keep-tab` before the API attempt. If an installed build reports `browser: true`, it cannot provide a browserless API attempt; update byCLI before applying this routing rule.
- `status: draft created` is the only API success. Any API failure—including token, AppID/AppSecret, image upload, `40164` IP whitelist, `draft/add`, timeout, or missing success confirmation—automatically triggers exactly one browser-mode attempt with the same approved title, body, content format, author, summary, and cover. Preserve the API error, remove `--appid` and `--appsecret` from the fallback command, then perform `doctor` followed immediately by `daemon status` and run browser mode with `--site-session persistent --keep-tab true`. Do not ask for confirmation between the two attempts.
- Browser mode fills the WeChat editor and saves through the logged-in browser session. `--content-format html` uses the browser's native rich-text clipboard paste path, which preserves supported inline styles, headings, lists, tables, links, and images. `--content-format html-text` keeps text and paragraph structure while discarding HTML styling. If fallback browser mode succeeds, report `draft saved` together with the preceding API failure context. If it also fails, report both failures and stop; never retry either mode or fall back from browser to API.
- `--dry-run true` is the safety exception: always use browser mode directly, even when both environment variables are set, because API mode creates a real draft. Its only success status is `draft ready`.

HTML input rules:

- Use `--content-file '<article.html>' --content-format html` for a complete HTML article. Local image paths are resolved relative to the HTML file's directory and uploaded before insertion; remote HTTPS images may remain remote in browser mode. API mode requires body images to be local files so it can upload them as material before `draft/add`.
- The HTML pipeline removes unsafe tags, event handlers, scripts, unsupported URL schemes, and unsafe style declarations. A missing, unreadable, empty, unsupported, or unuploadable image is an argument or execution failure, not a successful draft.
- A requested cover is uploaded into the article body before it is selected as the cover in browser mode. If the requested cover cannot be confirmed, or the editor does not expose a positive save confirmation, return `COMMAND_EXEC` and no success record.

Success statuses are `draft saved` for a browser save, `draft ready` for browser dry-run, and `draft created` for official API mode. Do not report success based only on navigation, a filled editor, or an HTTP request that was not confirmed by the command result.

`download-publish-data` accepts an exact article URL or title. Title comparison trims and collapses whitespace but otherwise requires complete equality; title substrings are not matches. If a title matches multiple records, do not guess: rerun with the complete URL or add `--date YYYY-MM-DD` using a user-provided or already-known publication date. An absolute query URL that is not a trusted `https://mp.weixin.qq.com/s...` article URL is rejected before authentication.

`download` accepts only a trusted `https://mp.weixin.qq.com/s...` article URL or `https://weixin.sogou.com/link?...` result URL. Preserve both returned `source_url` and `resolved_url`; the former records what the user or search supplied and the latter is the trusted WeChat article actually downloaded. 无效 URL 会返回参数或执行错误；never treat an “invalid URL” row as a successful result.

## Terminal-state precedence

Apply the first matching row from top to bottom. These Weixin-specific terminal actions override the parent skill's generic recovery rules.

| Priority | Observed state | Required action |
|---:|---|---|
| 0 | The environment-selected official API attempt for `create-draft` returns anything other than `status: draft created` | Preserve the API error and automatically execute exactly one browser fallback with no `--appid` or `--appsecret`. Run browser preflight only at this point. If browser mode also fails, report both outcomes and stop. This one-way fallback overrides generic typed-error, IP-whitelist, authentication-source, timeout, and AutoFix handling for the first API attempt. |
| 1 | An approved `download-publish-data` diagnostic rerun returned any non-success outcome, or the original command's diagnostic retry budget has already been consumed | Preserve every returned row, artifact, error, and retained trace. The rerun result is terminal; do not offer or perform another retry. For an authentication or verification outcome, freeze the browser context and report the human gate, but do not resume the original command after confirmation. |
| 2 | `RATE_LIMITED`, or a legacy `COMMAND_EXEC` whose normalized message or combined primary context contains `freq control` or `rate limited` | Only the adapter-owned Sogou fallback may run, and only within the same command invocation under the identity rules above. Once the command returns this state, preserve it and stop. Do not run a trace rerun, do not enter AutoFix, refresh, switch authentication sources, independently call `sougousearch`, or retry by changing `--limit` or `--max-pages`. |
| 3 | The login-gate rerun has already been consumed: the single post-confirmation login-gate rerun returned `AUTH_REQUIRED`, login `TIMEOUT` / exit code 75, a login page, CAPTCHA, or environment verification | Preserve the browser context, report the exact authentication or verification outcome, and stop. Do not ask for another confirmation or rerun the command again. |
| 4 | `AUTH_REQUIRED`, login `TIMEOUT` / exit code 75, login page, CAPTCHA, or environment verification from an execution whose diagnostic retry and login-gate rerun budgets are both unused | Freeze the workflow and wait for the user under the login gate below. |
| 5 | Public fallback is requested but the exact nickname is absent, unverified, mismatched, or ambiguous | Ask for identity clarification and validate it with `accounts`, or keep the command backend-only. Do not guess, merge, or classify the identity failure as an empty result. |
| 6 | Valid `EMPTY_RESULT` | Report the completed empty scope. Do not enter AutoFix, change intent, or switch acquisition methods. |
| 7 | `download-publish-data` returned `status: partial` or `status: failed` | Preserve all returned artifact metadata and errors; the row is terminal, so do not retry automatically. |
| 8 | Top-level `TIMEOUT` with no terminal item row or artifact metadata from `download-publish-data`, already determined not to be a login or verification timeout, and its diagnostic retry budget is unused | Report the uncertain outcome and offer one diagnostic retry only after explicit user approval. If approval is declined or absent, report the original timeout as terminal and stop. |
| 9 | Another typed byCLI failure | Follow its existing typed-error mapping; use AutoFix only when that mapping explicitly permits it. |

An `EMPTY_RESULT` in this table is the final command result after any eligible adapter-owned fallback has already run. Public fallback identity requirements take precedence over an empty backend result only when the user has requested that fallback; otherwise the empty result remains terminal. Track diagnostic and login-gate rerun budgets per original command, not per shell invocation. Apply rate-limit priority 2 before interpreting exit code 75 as a login timeout at priority 4 or delegating to generic typed-error handling at priority 9. `ret=200013` alone is not sufficient to identify frequency control: `err_msg: invalid credential` remains `AUTH_REQUIRED`, while the rate-limit terminal requires `err_msg: freq control`, `RATE_LIMITED`, or the normalized `rate limited` message.

## Published-data spreadsheet downloads

- When `published` has already returned an article URL and publication date, use **精确 URL + `--date`**; do not replace it with a title. A title is only a fallback when the URL is unavailable.
- Interpret `download-publish-data` terminal status exactly: `status: downloaded` means both `markdownPath`/`markdownSize` and `dataPath`/`dataSize` passed the command's readable, non-empty regular-file validation; `status: partial` means exactly one artifact passed validation and its path/size must be preserved with the other artifact's error; `status: failed` means neither artifact passed validation. Check every non-null returned path for readability, but do not claim a missing artifact exists.
- For multiple `download-publish-data` requests in the same authenticated browser session, commands 必须串行执行. Wait for each command to return one terminal status and verify every returned non-null artifact path before starting the next; never use parallel shell jobs, `Promise.all`, or another concurrent batch mechanism. Persistent Weixin adapter commands share an adapter-managed TAB.
- A returned `status: partial` or `status: failed` row is terminal even when its `error` mentions a timeout. Preserve every returned path, size, and error and do not rerun it automatically; rerunning can create duplicate artifacts.
- Only a top-level `TIMEOUT` that returns no terminal item row or artifact metadata is retry-eligible while the original command's diagnostic retry budget is unused. Report that the outcome is uncertain and ask for explicit user approval. If approval is declined or absent, report the original timeout as terminal and stop. After approval and before launching the rerun, mark the original command's diagnostic retry budget as consumed, then rerun exactly once with `--trace retain-on-failure`, preserving the identical query and all other options. This diagnostic retry is allowed at most once per original command and consumes that command's retry budget; every result from it, including another top-level `TIMEOUT`, is terminal and must not offer or perform another retry. If the trace reaches `appmsganalysis?action=detailpage`, classify it as a download-observation failure rather than a login timeout, retain the trace, and report that no matching Chrome 下载事件 was observed. Inspect the OpenClaw browser's installed byCLI extension version, `downloads` permission, and Chrome download state before proposing adapter changes; do not try a different query.

## Browser session

- Use browser authentication by default. Every browser-backed Weixin command must include `--site-session persistent --keep-tab true`.
- Before browser commands, complete the main skill's `doctor` and `daemon status` checks. Reuse the Chrome session for `mp.weixin.qq.com` and `weixin.sogou.com`.
- A newly leased adapter tab may begin at `about:blank`. An `mp.weixin.qq.com`-backed command navigates there and then re-reads page state; if existing cookies redirect it to an authenticated `/cgi-bin/` URL with a non-empty token, continue the command. `sougousearch` navigates to `weixin.sogou.com` instead. Do not reproduce either check with `bycli browser`.
- If navigation reaches an authenticated `/wxamp/` URL, the connected session is a Mini Program account, not the Official Account backend required by these commands. Report the account-type mismatch and ask the user to switch to an Official Account in the same browser profile; do not call it an unauthenticated QR-login state or invoke an Official Account data endpoint.
- Only `accounts`, `articles`, and `save-articles` support `--auth-source env`. Other Weixin commands require Browser Bridge and the logged-in browser session, except the first `create-draft` attempt selected from non-empty `WECHAT_APPID` and `WECHAT_APPSECRET` when structured help reports `browser: conditional`. Its automatic fallback is browser-backed.
- Pass only options shown by that command's structured help. In particular, `accounts`, `articles`, `sougousearch`, `collections`, `collection-detail`, `download`, and `save-articles` do not support `--timeout`; never add a generic `--timeout 180` to them.
- Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser, login, or verification failure.

Backend-only examples omit `--name` unless the unique identity proof described below is complete:

```bash
bycli weixin accounts "<account name>" --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin articles '<fakeid>' --limit <n> --max-pages <n> --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin sougousearch '<query>' --page 1 --limit <n> --site-session persistent --keep-tab true -f json
bycli weixin collections --limit <n> --max-pages <n> --site-session persistent --keep-tab true -f json
bycli weixin collection-detail '<collectionId>' --max-pages <n> --site-session persistent --keep-tab true -f json
bycli weixin drafts --limit <n> --timeout 60 --site-session persistent --keep-tab true -f json
bycli weixin published '<optional title or URL>' --limit <n> --max-pages <n> --timeout 30 --site-session persistent --keep-tab true -f json
bycli weixin download --url '<article-url>' --output '<directory>' --download-images true --site-session persistent --keep-tab true -f json
bycli weixin save-articles '<fakeid>' --limit <n> --max-pages <n> --output '<directory>' --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin download-publish-data '<exact article URL>' --date YYYY-MM-DD --output '<directory>' --max-pages <n> --timeout 60 --site-session persistent --keep-tab true -f json
bycli weixin download-publish-data '<exact article title>' --output '<directory>' --max-pages <n> --timeout 60 --site-session persistent --keep-tab true -f json
bycli weixin create-draft --title '<title>' --content-file '<article.html>' --content-format html --author '<author>' --cover-image '<cover.jpg>' --summary '<summary>' --site-session persistent --keep-tab true -f json
bycli weixin create-draft '<text body>' --title '<title>' --cover-image '<cover.jpg>' --dry-run true --site-session persistent --keep-tab true -f json
# API mode: inject these variables locally without echoing their values.
bycli weixin create-draft --title '<title>' --content-file '<article.html>' --content-format html --cover-image '<cover.jpg>' --appid "$WECHAT_APPID" --appsecret "$WECHAT_APPSECRET" -f json
```

Only after `accounts` proves one unique nickname-to-`fakeid` binding for the selected `fakeid` may the corresponding account-history command include `--name` and enable the adapter-owned public fallback:

```bash
bycli weixin articles '<fakeid>' --name '<proven exact account name>' --limit <n> --max-pages <n> --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin save-articles '<fakeid>' --name '<proven exact account name>' --limit <n> --max-pages <n> --output '<directory>' --auth-source browser --site-session persistent --keep-tab true -f json
```

Omit optional placeholders and their flags rather than passing empty strings. `--author` is limited to 8 Unicode characters and `--title` to 64 Unicode characters; oversized values return `ARGUMENT` before mode dispatch. `--cover-image` must be a readable, non-empty jpg, jpeg, png, gif, or webp file. Browser mode uploads it into the article body before selecting it as the cover; API mode uploads it as permanent image material and uses the returned media ID. A browser cover-confirmation failure returns `COMMAND_EXEC`.

## Login and verification gate

An article-index `RATE_LIMITED`, or a legacy `COMMAND_EXEC` that reports `freq control` or “rate limited”, is 微信限频，不是认证失败. With browser authentication and an exact `--name`, `articles` and `save-articles` may perform their single built-in Sogou fallback as part of the same command; outside that adapter-owned fallback, the executor 不得立即重试, independently call `sougousearch`, refresh, switch authentication sources, run trace/AutoFix, or change request-size options. If the command still returns the rate-limit error (including combined primary/fallback context), preserve it and stop the affected flow.

After the adapter's post-navigation check, treat login `AUTH_REQUIRED` / exit code 77, a login `TIMEOUT` / exit code 75, anti-bot prompts, CAPTCHAs, sliders, SMS/security checks, and WeChat environment-verification pages as a required human gate. This includes “环境异常，完成验证后即可继续访问” and its “去验证” button. These are not Adapter defects; do not enter AutoFix or modify Adapter code. A download-observation timeout follows the published-data spreadsheet rule above instead of this gate.

An authentication outcome from an already-consumed diagnostic rerun follows terminal priority 1: freeze and preserve the browser context for the user, but do not rerun the original `download-publish-data` command after confirmation. A later execution requires a new explicit user request and starts a new original-command state; it is not a continuation of the consumed diagnostic retry.

Verified for byCLI 2.1.35: browser-mode `create-draft` session failures return `AUTH_REQUIRED`; both a missing backend token and an editor page that indicates an expired session enter this gate. Official API mode reports token, material-upload, and draft-creation failures as typed execution errors. For another installed version, follow its structured command help and typed output rather than assuming forward compatibility. Field, cover, and save-confirmation failures remain `COMMAND_EXEC` and follow their typed execution-error path.

1. Stop all tool execution immediately. Do not click, bypass, refresh, retry, navigate, focus another page, switch authentication source, or use another acquisition method.
2. Freeze the current browser context. Do not issue another Weixin, raw browser, doctor, daemon, or browser-lifecycle command; keep the current tab and processes available for the user.
3. Ask the user to complete verification in the already open tab and explicitly confirm completion. The user—not the agent—clicks “去验证”. End the current turn.
4. While waiting, do not inspect page state or run a status check.
5. After the user's next explicit confirmation and before launching the rerun, mark the original command's login-gate rerun budget as consumed. Then rerun the interrupted command exactly once with `--site-session persistent --keep-tab true`; do not perform a preflight check.
6. If that single rerun still returns an authentication error, report the exact error and stop.

On the first login `TIMEOUT`, follow this gate immediately. Do not change `BYCLI_BROWSER_COMMAND_TIMEOUT`, open a second login page, inspect a retained `about:blank` tab, or issue another command before confirmation. After confirmation, the rerun reads the token from the authenticated backend URL and obtains domain cookies, including HttpOnly cookies, through Browser Bridge.

## Returned records and local files

- Preserve the complete structured output for the requested scope; do not silently discard fields that are not displayed in the default table format.
- Preserve partial successes. Return completed records and identify each failed or incomplete record with its original Adapter `status`, `stage`, and `error` where available.
- For local-file commands, return the resolved `saved`, `path`, `markdownPath`, or `dataPath`, together with its corresponding `size`, `markdownSize`, or `dataSize` and status, alongside the record. Never claim a file exists unless every non-null returned path relevant to that record is readable.
- For `articles`, return the 完整文章索引 for the requested `--limit` / `--max-pages` scope. Preserve title, URL, author, digest, publish time, `source`, and `coverage`. `source: sogou` means the authenticated index failed or was empty and the adapter used exact-account Sogou fallback. `coverage: max-pages-reached` is bounded coverage, not a complete-history claim.
- For `sougousearch`, preserve `rank`, `page`, `title`, `account`, `url`, `summary`, and `publish_time`. Its records are article search results, not official-account identity records; never treat `account` as a substitute for an `accounts` result or invent a `fakeid` from it.
- For `save-articles`, return the saved 正文, each `path` (the current equivalent of legacy `fileName` metadata), `source`, and `coverage` alongside the corresponding record. Preserve `stage: resolve` failures from Sogou links and all readable files from successful rows. Do not redownload records already returned with a readable saved file.
- For a requested article that has not been saved, use `weixin download --url '<article-url>'`; this may be a direct WeChat URL or the Sogou `/link` URL returned by `sougousearch`. Preserve `source_url` and `resolved_url`. Only after the returned `saved` path is readable, read that Markdown file and return its body together with the file metadata.
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

Never use `--auth-source env` for `sougousearch`, `collections`, `collection-detail`, `drafts`, `published`, `download`, `download-publish-data`, or `create-draft`; those commands do not expose that option. `create-draft --appid/--appsecret` is a separate official-API mode, not Weixin environment authentication.

`WECHAT_APPID` and `WECHAT_APPSECRET` are local routing inputs only for `create-draft`. Check presence and trimmed non-emptiness without displaying values. Do not unset or modify them. Pass both only when both are valid; otherwise pass neither. Never copy their literal values into chat, traces, fixtures, committed files, or shell history.

For `WECHAT_TOKEN`, `WECHAT_COOKIE`, and `WECHAT_FINGERPRINT`, never mix browser-derived and environment-derived values. If variables are missing, name them without displaying their values. If the complete set exists but authentication fails, ask the user to replace that same-session set because it may be expired or mixed across sessions. This replacement rule does not apply to `WECHAT_APPID` / `WECHAT_APPSECRET`; their failed API attempt follows the automatic browser fallback above.

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
