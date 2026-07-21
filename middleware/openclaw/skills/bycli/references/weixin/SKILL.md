# byCLI Weixin authentication and article collection

Load this reference for `bycli weixin accounts`, `articles`, `save-articles`, or `download`; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication failures from `mp.weixin.qq.com`.

## 1. Browser authentication and session

- Use browser authentication by default. Every browser-authenticated Weixin command must include `--site-session persistent --keep-tab true`.
- Before browser commands, complete the main skill's `doctor` and `daemon status` checks. Reuse the Chrome session for `mp.weixin.qq.com`.
- Treat the 180-second QR-code wait as internal behavior. `weixin accounts` does not support `--timeout`; never pass `--timeout 180`.
- Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser, login, or verification failure.
- Never expose, mix, or retain authentication credentials.

```bash
bycli weixin accounts "<account name>" --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin articles '<fakeid>' --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin save-articles '<fakeid>' --limit 10 --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin download --url '<article-url>' --site-session persistent --keep-tab true -f json
```

## 2. Human-verification gate

Treat login `TIMEOUT` / exit code 75, `AUTH_REQUIRED` / exit code 77, anti-bot prompts, CAPTCHAs, sliders, SMS/security checks, and WeChat environment-verification pages or buttons as a required human-verification gate. This includes the page saying “环境异常，完成验证后即可继续访问” with a “去验证” button. These are not adapter defects; do not enter AutoFix or modify adapter code.

1. Stop all tool execution immediately. Do not click the verification button, solve or bypass the challenge, refresh/retry, navigate, focus another page, switch to `web read`, change authentication source, or fall back to another acquisition method.
2. Freeze the current browser context. Do not invoke any further `bycli weixin`, `bycli browser`, `bycli doctor`, daemon, or browser-lifecycle command; do not close the tab, clean up the session, or stop/restart the daemon or browser.
3. Ask the user to complete the verification in the already open tab and explicitly confirm completion. For the “环境异常” page, the user—not the agent—clicks “去验证”.
4. Only after that confirmation, rerun the interrupted command with `--site-session persistent --keep-tab true`.

For QR-code login, let byCLI open and focus the Official Accounts login page and wait internally for up to 180 seconds. After successful login, byCLI reads the `token` from the authenticated backend URL and obtains domain cookies, including HttpOnly cookies, through Browser Bridge.

## 3. Collection workflow

1. Use `accounts` to find the account, then `articles` to obtain the complete article index.
2. Write the index to the collection directory's `bycli-output.json`. Each `items[]` entry contains at least `title`, `url`, `author`, and `publish_time`; add `markdown` and `fileName` after its body is saved.
3. Run `save-articles` with `--limit 10`. Save Markdown bodies for at most the first 10 articles, and update their JSON entries with `markdown` and `fileName`. Keep every remaining article indexed only.
4. When the user chooses **入库** or **知识整理**, use the selected scope and `bycli-output.json` as the source of truth. For each selected article not already saved, run `weixin download --url '<article-url>'`, append its Markdown and `fileName` to the index, then hand off only the selected local files.

Do not download unselected remaining articles or re-download the initial 10.

## 4. Collection response

Before sending a completed collection response, build its article list from `bycli-output.json`. Every reported entry with a URL must include a title, clickable preview URL, and body status:

```markdown
- [文章标题](https://mp.weixin.qq.com/s/...) — 已预下载 Markdown
- [另一篇文章](https://mp.weixin.qq.com/s/...) — 仅建立索引
```

The preview list must appear before any collection summary, cleanup notice, or 「入库 / 知识整理 / 跳过」 follow-up question. The follow-up question supplements the list; it never replaces it. If an entry lacks a URL, mark its preview unavailable and report the incomplete index, while continuing to deliver the remaining articles and follow-up question.

## 5. Environment authentication

Use `--auth-source env` only when the user explicitly requests it or Browser Bridge is unavailable in CI/headless automation:

| Command | Complete same-session credential set |
|---|---|
| `articles`, `save-articles` | `WECHAT_TOKEN` + `WECHAT_COOKIE` |
| `accounts` | `WECHAT_TOKEN` + `WECHAT_COOKIE` + `WECHAT_FINGERPRINT` |

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
