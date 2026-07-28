# byCLI Weixin executor rules

Load this reference for `bycli weixin accounts`, `articles`, `save-articles`, or `download`; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication failures from `mp.weixin.qq.com`.

This reference only defines Weixin command execution, authentication gates, session handling, and returned records. When a caller delegates the task, return the complete index, article body, and file metadata to that caller without choosing a canonical artifact name or storage layout.

## Browser session

- Use browser authentication by default. Every browser-authenticated Weixin command must include `--site-session persistent --keep-tab true`.
- Before browser commands, complete the main skill's `doctor` and `daemon status` checks. Reuse the Chrome session for `mp.weixin.qq.com`.
- A newly leased adapter tab may begin at `about:blank`. The adapter navigates to `mp.weixin.qq.com` and then re-reads page state. If existing cookies redirect it to an authenticated `/cgi-bin/` URL with a non-empty token, continue the command; do not reproduce this check with `bycli browser`.
- `weixin accounts` does not support `--timeout`; never pass `--timeout 180`.
- Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser, login, or verification failure.

```bash
bycli weixin accounts "<account name>" --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin articles '<fakeid>' --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin save-articles '<fakeid>' --limit <n> --auth-source browser --site-session persistent --keep-tab true -f json
bycli weixin download --url '<article-url>' --site-session persistent --keep-tab true -f json
```

## Login and verification gate

After the adapter's post-navigation check, treat login `AUTH_REQUIRED` / exit code 77, legacy or outer login `TIMEOUT` / exit code 75, anti-bot prompts, CAPTCHAs, sliders, SMS/security checks, and WeChat environment-verification pages as a required human gate. This includes “环境异常，完成验证后即可继续访问” and its “去验证” button. These are not Adapter defects; do not enter AutoFix or modify Adapter code.

1. Stop all tool execution immediately. Do not click, bypass, refresh, retry, navigate, focus another page, switch authentication source, or use another acquisition method.
2. Freeze the current browser context. Do not issue another Weixin, raw browser, doctor, daemon, or browser-lifecycle command; keep the current tab and processes available for the user.
3. Ask the user to complete verification in the already open tab and explicitly confirm completion. The user—not the agent—clicks “去验证”. End the current turn.
4. While waiting, do not inspect page state or run a status check.
5. After the user's next explicit confirmation, rerun the interrupted command exactly once with `--site-session persistent --keep-tab true`; do not perform a preflight check.
6. If that single rerun still returns an authentication error, report the exact error and stop.

On the first login `TIMEOUT`, follow this gate immediately. Do not change `BYCLI_BROWSER_COMMAND_TIMEOUT`, open a second login page, inspect a retained `about:blank` tab, or issue another `accounts` command before confirmation. After confirmation, the rerun reads the token from the authenticated backend URL and obtains domain cookies, including HttpOnly cookies, through Browser Bridge.

## Article execution and returned records

1. Use `accounts` to find the account and obtain its identifier.
2. Use `articles` to return the 完整文章索引. Each record should preserve the available title, URL, author, and publish time.
3. Use `save-articles --limit <n>` for the requested batch scope. Return the saved 正文 and each `fileName` or equivalent file metadata alongside the corresponding record.
4. For a requested article that has not been saved, use `weixin download --url '<article-url>'`, then return its body and file metadata. Do not redownload records already returned with a readable saved file.
5. Preserve partial successes: return completed records and identify any failed or incomplete record with the original Adapter error.

The executor response must provide a 可点击预览 for every record with a URL and its body/file status, for example:

```markdown
- [文章标题](https://mp.weixin.qq.com/s/...) — 已返回正文与文件元数据
- [另一篇文章](https://mp.weixin.qq.com/s/...) — 仅返回索引
```

If an entry lacks a URL, mark its preview unavailable and report the incomplete index while returning the remaining records.

## Environment authentication

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
