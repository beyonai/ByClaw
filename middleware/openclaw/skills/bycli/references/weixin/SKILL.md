# byCLI Weixin authentication

Load this reference for `bycli weixin accounts`, `articles`, or `save-articles`; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication failures from `mp.weixin.qq.com`.

## Required behavior

- Use browser authentication by default.
- Add `--site-session persistent` to every browser-authenticated Weixin command so the login tab remains leased after success or failure.
- Treat the 180-second QR-code wait as internal behavior. `weixin accounts` does not support `--timeout`; never pass `--timeout 180`.
- On login `TIMEOUT` or `AUTH_REQUIRED`, keep the login tab and browser session open, ask the user to finish logging in, then stop.
- Continue only after the user confirms login succeeded; rerun the same command with the persistent site session.
- Use environment authentication only when the user explicitly requests it or Browser Bridge is unavailable in CI/headless automation.
- Never expose, mix, or retain authentication credentials.

## Browser authentication

Run browser-backed commands with a persistent site session:

```bash
bycli weixin accounts "<account name>" --auth-source browser --site-session persistent -f json
bycli weixin articles '<fakeid>' --auth-source browser --site-session persistent -f json
bycli weixin save-articles '<fakeid>' --auth-source browser --site-session persistent -f json
```

Before running them, complete the main skill's `doctor` and `daemon status` checks. Reuse the Chrome session for `mp.weixin.qq.com`.

Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser or login failure.

### QR-code login flow

1. Let byCLI open and focus the Official Accounts login page when the Chrome session is not authenticated.
2. Let browser authentication wait internally for up to 180 seconds while checking for a successful login.
3. After login, let byCLI read the `token` from the authenticated backend URL and obtain domain cookies through Browser Bridge, including HttpOnly cookies.
4. If the wait ends with `TIMEOUT` / exit code 75 or `AUTH_REQUIRED` / exit code 77, follow the pending-login flow below. These errors are not adapter defects; do not enter AutoFix or modify adapter code.

### Pending-login flow

1. Keep the login/QR tab and browser session open. Do not run normal session cleanup.
2. Tell the user: "The WeChat Official Accounts login tab is still open. Complete QR-code login and confirm when finished; I will continue afterward."
3. Stop. Do not run another command or proceed to the next step until the user confirms login succeeded.
4. After confirmation, rerun the same command with `--site-session persistent`.

## Environment authentication

Use `--auth-source env` only for an explicit user request or CI/headless automation without Browser Bridge:

| Command | Complete same-session credential set |
|---|---|
| `articles`, `save-articles` | `WECHAT_TOKEN` + `WECHAT_COOKIE` |
| `accounts` | `WECHAT_TOKEN` + `WECHAT_COOKIE` + `WECHAT_FINGERPRINT` |

Never mix browser-derived and environment-derived values. If variables are missing, name them without displaying their values. If all variables exist but authentication fails, ask the user to replace the complete same-session set because it may be expired or mixed across sessions.

### Obtain credentials safely

Never request credential values in chat. Tell the user to obtain and inject them locally:

1. Sign in to `https://mp.weixin.qq.com/` in Chrome and enter an authenticated `/cgi-bin/` backend page.
2. Open DevTools **Network**, then refresh or perform the relevant account/article action.
3. Select an authenticated request whose origin is exactly `https://mp.weixin.qq.com`.
4. Set `WECHAT_TOKEN` from the request URL's non-empty `token` query parameter.
5. Set `WECHAT_COOKIE` from the complete `Cookie` request header. Do not use `document.cookie`; it omits required HttpOnly cookies.
6. For `accounts`, set `WECHAT_FINGERPRINT` from the `fingerprint` query parameter of the matching `search_biz` request.
7. Ensure every value came from the same current login session. Replace the complete set when the session expires.

Use a secret manager or hidden shell input. Do not place literal values in arguments, shell history, committed `.env` files, fixtures, logs, traces, or skill files:

```bash
IFS= read -r -s WECHAT_TOKEN
IFS= read -r -s WECHAT_COOKIE
export WECHAT_TOKEN WECHAT_COOKIE
bycli weixin articles '<fakeid>' --auth-source env -f json
unset WECHAT_TOKEN WECHAT_COOKIE
```

For `accounts`, collect, export, and unset `WECHAT_FINGERPRINT` the same way. Never echo, inspect, serialize, retain, or return token, Cookie, fingerprint, or sensitive Cookie values.
