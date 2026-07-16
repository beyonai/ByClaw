# byCLI Weixin authentication

Load this reference for `bycli weixin accounts`, `articles`, or `save-articles`; `--auth-source`; `WECHAT_TOKEN`, `WECHAT_COOKIE`, or `WECHAT_FINGERPRINT`; and authentication failures from `mp.weixin.qq.com`.

## Authentication choice

Prefer the default browser authentication. It keeps credentials out of arguments and agent-visible output:

```bash
bycli weixin accounts "<account name>" --auth-source browser -f json
bycli weixin articles '<fakeid>' --auth-source browser -f json
bycli weixin save-articles '<fakeid>' --auth-source browser -f json
```

Before browser-backed commands, follow the main skill's `doctor` and `daemon status` checks. byCLI reuses the Chrome session for `mp.weixin.qq.com`. If it is not authenticated, it opens and focuses the Official Accounts login page and waits up to 180 seconds for the user to scan the QR code. It then reads the `token` from the authenticated backend URL and obtains domain cookies through Browser Bridge, including HttpOnly cookies.

Do not ask the user to extract credentials when browser authentication can satisfy the request. Do not silently switch to environment authentication after a browser or login failure.

Use `--auth-source env` only when the user explicitly requests it or the task runs in CI/headless automation without Browser Bridge:

| Command | Complete same-session credential set |
|---|---|
| `articles`, `save-articles` | `WECHAT_TOKEN` + `WECHAT_COOKIE` |
| `accounts` | `WECHAT_TOKEN` + `WECHAT_COOKIE` + `WECHAT_FINGERPRINT` |

Never mix browser-derived and environment-derived credential values.

## Tell the user how to obtain environment credentials

The agent must not request that credential values be pasted into chat. Tell the user to perform these steps locally:

1. Sign in to `https://mp.weixin.qq.com/` in Chrome and enter an authenticated `/cgi-bin/` backend page.
2. Open DevTools **Network**, then refresh or perform the relevant account/article action.
3. Select an authenticated request whose origin is exactly `https://mp.weixin.qq.com`.
4. Set `WECHAT_TOKEN` from that request URL's non-empty `token` query parameter.
5. Set `WECHAT_COOKIE` from the request's complete `Cookie` request-header value. Do not use `document.cookie`; it omits HttpOnly cookies required by the session.
6. For `accounts`, set `WECHAT_FINGERPRINT` from the `fingerprint` query parameter of the matching `search_biz` request.
7. Ensure all values came from the same current login session. Re-export the complete set when the session expires.

The user should inject these values locally through a secret manager or hidden shell input. Do not recommend placing literal values in command arguments, shell history, committed `.env` files, fixtures, logs, traces, or skill files. A safe temporary interactive pattern is:

```bash
IFS= read -r -s WECHAT_TOKEN
IFS= read -r -s WECHAT_COOKIE
export WECHAT_TOKEN WECHAT_COOKIE
bycli weixin articles '<fakeid>' --auth-source env -f json
unset WECHAT_TOKEN WECHAT_COOKIE
```

For `accounts`, collect and export `WECHAT_FINGERPRINT` the same way and unset it afterward. Never print the variables to verify them.

## Authentication failures

`AUTH_REQUIRED` / exit code 77 is not an adapter defect. Do not enter AutoFix or change adapter code.

- Browser mode: keep a login/QR page open, report that user action is required, and resume only after login succeeds. Do not close the authentication session.
- Environment mode: name the missing variables without displaying their values. If all are set, explain that the values may be expired or from different sessions and ask the user to replace the complete same-session set.
- Never echo, inspect, serialize, retain, or return token, Cookie, fingerprint, or sensitive Cookie values.
