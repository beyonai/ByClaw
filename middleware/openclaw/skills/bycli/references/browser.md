# Browser 驱动参考

The first reader of this CLI is an agent, not a human. Every subcommand returns a structured envelope that tells you exactly what matched, how confident the match is, and what to do if it didn't. Lean on those envelopes — do not guess.

This reference is for **driving a live browser** to accomplish an agent task. If you are building a reusable adapter under `~/.bycli/clis/<site>/` see [adapter-author.md](./adapter-author.md) instead.

> **浏览器生命周期（冷启动 / 关闭 / Login 例外 / Kill-all-Chrome）** 已在 [SKILL.md](../SKILL.md) 主文件中详述，此处不重复。本文件聚焦命令参考和操作细节。

---

## Session 补充说明

- `bycli browser *` commands require a `<session>` positional immediately after `browser`. Use the same session name for a multi-step flow; use a different name to isolate parallel browser work.
- Owned browser sessions keep a tab lease alive between calls. Release it with `bycli browser <session> close` or let the idle timeout expire.
- `bycli browser <session> bind` binds the Chrome tab you already have open to that session. Use this for logged-in pages, SSO flows, or pages you manually positioned before handing control to the agent.
- `--window foreground|background` chooses whether byCLI creates/focuses a foreground browser window or uses a background one.

### Bind Tab

```bash
bycli browser gmail bind
bycli browser gmail state
bycli browser gmail click "Search"
bycli browser gmail unbind
```

Binding never owns the user window. Navigation is allowed; tab mutation (`tab new`, `tab select`, `tab close`) is blocked. Bound sessions have no idle-close timer — binding lasts until `unbind`, tab close, window close, or daemon restart.

---

## Mental model

1. **Selector-first target contract.** Every interaction command takes one `<target>`: a numeric ref from `state`/`find` OR a CSS selector. Use `--nth <n>` to disambiguate.
2. **Every envelope reports `matches_n` and `match_level`.** Levels: `exact`, `stable`, `reidentified`.
3. **Compact output first, full payload on demand.** `state` is budget-aware; `network` returns previews; `--detail <key>` fetches one body.
4. **Structured errors are machine-readable.** Branch on `error.code`, not message strings.

---

## Critical rules

1. **Always inspect before you act.** Run `state` or `find` first. Never hard-code a ref or selector from memory across sessions — indices are per-snapshot.
2. **Prefer site adapters before raw browser driving.** If `bycli <site> <command>` already covers the task, use it first. Use `bycli browser ...` only for gaps, debugging, or one-off UI flows.
3. **Prefer numeric ref over CSS once you have it.** Numeric refs survive mild DOM shifts because the CLI fingerprints each tagged element.
4. **Read `match_level` after every write.** `exact` = proceed. `stable` = proceed but re-check if needed. `reidentified` = double-check you hit the right element.
5. **Use the `compound` field for form controls.** Do not regex-guess a date format, do not `state` twice for `<select>` options. The compound envelope has format string, option list, `accept`/`multiple`.
6. **Verify writes that matter.** After `type`, run `get value`. Autocomplete widgets, React controlled inputs, and masked fields silently eat characters.
7. **`state` → action → `state` after a page change.** Navigations, form submits, and SPA route changes invalidate refs. Take a fresh snapshot.
8. **Chain with `&&` when reusing freshly parsed refs.** A chained sequence runs in one shell so refs stay valid. Page changes still invalidate.
9. **`eval` is read-only.** Wrap in IIFE, return JSON. To change the page, use structured `click`/`type`/`select`/`keys`.
10. **Prefer `network` to screen-scraping.** JSON APIs are more reliable than DOM scraping. Capture once, inspect shape, then `--detail <key>`.

---

## Target contract

```
<target> ::= <numeric-ref> | <css-selector>
```

- **Numeric ref** — the `[N]` index from `state` or `find`. Cheap, resilient to soft DOM drift.
- **CSS selector** — anything `querySelectorAll` accepts. Must be unambiguous on write ops, or pair with `--nth <n>`.

### match_level

| level | meaning | action |
|-------|---------|--------|
| `exact` | Fingerprint agreed | Proceed |
| `stable` | Tag + strong IDs agree, soft attrs drifted | Proceed, verify if needed |
| `reidentified` | Original ref gone, unique replacement found | Double-check before chaining |

### Structured error codes

| code | meaning |
|------|---------|
| `not_found` | Numeric ref not in DOM. Re-`state`. |
| `stale_ref` | Ref exists but element changed. Re-`state`. |
| `invalid_selector` | CSS rejected by `querySelectorAll`. |
| `selector_not_found` | CSS matches 0 elements. |
| `selector_ambiguous` | CSS matches >1, no `--nth`. |
| `option_not_found` | `select` option not found. Envelope has `available[]`. |
| `extension_not_connected` | Chromium not running. Start browser first. |

---

## Command reference

### Inspect

| command | purpose |
|---------|---------|
| `browser state` | Snapshot: text tree with `[N]` refs, scroll hints, hidden-interactive hints, `compounds (N):` sidecar |
| `browser state --source ax` | Accessibility-tree snapshot. Use for custom controls, portals, iframe contents. AX refs recover stale React re-renders by role/name/nth. Cross-origin iframe refs are best-effort. |
| `browser state --compare-sources` | Metrics-only DOM vs AX comparison (counts and sizes, not page text). Use before arguing AX should be default on a site. |
| `browser find --css <sel> [--limit N] [--text-max N]` | CSS query, returns entries with `{nth, ref, tag, role, text, attrs, visible, compound?}`. Allocates refs for untagged matches. |
| `browser find --role button --name Save` | Semantic locator query. Also supports `--label`, `--text`, and `--testid`. Use before raw CSS when a control has accessible labels. |
| `browser frames` | List cross-origin iframe targets. Pass the index to `--frame` on `eval`. |
| `browser screenshot [path]` | Viewport PNG. No path → base64 to stdout. Prefer `state` for structure. |
| `browser screenshot --annotate [path]` | Visual ref map. Refreshes DOM refs and overlays visible `[N]` labels. Use for icon-only controls, visual layouts, charts. |

### Get (read-only)

| command | returns |
|---------|---------|
| `browser get title` | plain text |
| `browser get url` | plain text |
| `browser get text <target> [--nth N]` | `{value, matches_n, match_level}` |
| `browser get value <target> [--nth N]` | `{value, matches_n, match_level}` |
| `browser get attributes <target> [--nth N]` | `{value: {attr: val, ...}, matches_n, match_level}` |
| `browser get text --role option --name Travel` | Semantic locator read without a prior `state` call. Same flags as `find`. |
| `browser get html [--selector <css>] [--as html\|json] [--depth N] [--children-max N] [--text-max N] [--max N]` | Raw HTML or structured tree. JSON nodes: `{tag, attrs, text, children[], compound?}`. Truncation reported via `truncated: {depth?, children_dropped?, text_truncated?}`. |

### Interact

| command | notes |
|---------|-------|
| `browser click <target> [--nth N]` | Returns `{clicked, target, matches_n, match_level}`. |
| `browser click --role button --name Submit` | Semantic click. Write actions require unique match; ambiguous locators return candidates. |
| `browser hover [target] [--role R --name N] [--nth N]` | Moves mouse over element. Use for hover menus/tooltips. Returns `{hovered, target, matches_n, match_level}`. |
| `browser focus [target] [--role R --name N] [--nth N]` | Focuses element without typing. Useful before `keys`. Returns `{focused, ...}`. |
| `browser dblclick [target] [--role R --name N] [--nth N]` | Double-click via native mouse events. Returns `{dblclicked, ...}`. |
| `browser check [target] [--role R --name N] [--nth N]` | Ensures checkbox/radio is checked. Returns `{checked, changed, target, matches_n, match_level, kind}`. Prefer over blind `click` when state matters. |
| `browser uncheck [target] [--role R --name N] [--nth N]` | Ensures checkbox is unchecked. Radio buttons cannot be unchecked — select another instead. |
| `browser upload [target] <file...> [--role R --name N] [--nth N]` | Attaches file(s) to `input[type=file]` via CDP. Returns `{uploaded, files, file_names, target, matches_n, match_level, multiple?, accept?}`. |
| `browser drag [source] [target] [--from-role R --from-name N] [--to-role R --to-name N]` | Mouse-based drag between two elements. Returns `{dragged, source, target, source_matches_n, target_matches_n}`. |
| `browser type [target] <text> [--role R --name N] [--nth N]` | Clicks first, then types. Returns `{typed, text, target, matches_n, match_level, autocomplete}`. `autocomplete: true` = suggestion popup open, need `keys Enter` or click to commit. |
| `browser fill [target] <text> [--role R --name N] [--nth N]` | Exact replacement for input/textarea/contenteditable. Returns `{filled, verified, text, actual, matches_n, match_level}`. Use when you need raw text set and verified, not keyboard/autocomplete behavior. |
| `browser select [target] <option> [--role R --name N] [--nth N]` | Matches native `<select>` option by label first, then value. Use `compound` from `find`/`state` to see available labels. |
| `browser keys <key>` | `Enter`, `Escape`, `Tab`, `Control+a`, etc. Runs against focused element. |
| `browser scroll <direction> [--amount px]` | `up`/`down`. Default 500px. |

### Wait

```bash
browser wait selector "<css>" [--timeout ms]    # wait until selector matches
browser wait text "<substring>" [--timeout ms]  # wait until text appears
browser wait download [pattern] [--timeout ms]  # wait for Chrome download
browser wait time <seconds>                     # hard sleep, last resort
```

Default timeout `10000` ms. SPA routes, login redirects, lazy-loaded lists need `wait` before `state`/`get`.

`browser wait download` requires Browser Bridge extension 1.0.8+. Pass a narrow filename or URL substring (e.g. `receipt.pdf`); empty pattern waits for any download. Returns `{downloaded, filename, url, state, elapsedMs}` on success.

### Extract

| command | purpose |
|---------|---------|
| `web read --url <url>` | One-shot Markdown reader. Expands same-origin iframes. Use `--frames all-same-origin` for completeness. For AJAX shells: `--wait-for "<selector>" --wait-until networkidle --diagnose`. If value is table/API data, use `browser network` instead. |
| `browser eval <js> [--frame N]` | Run JS expression (read-only). Wrap in IIFE, return JSON. String result → raw stdout; otherwise JSON. |
| `browser extract [--selector <css>] [--chunk-size N] [--start N]` | Markdown extraction with continuation cursor. Returns `{url, title, selector, total_chars, chunk_size, start, end, next_start_char, content}`. Loop on `next_start_char` until null. Auto-scopes to `<main>`/`<article>`/`<body>`. |

### Network

```bash
browser network                        # shape preview + cache key list
browser network --detail <key>         # full body for one cached entry
browser network --filter "field1,field2"  # AND-semantics on path segments
browser network --all                  # include static resources
browser network --raw                  # full bodies inline (large)
browser network --ttl <ms>             # cache TTL (default 24h)
```

List entries: `{key, method, status, url, ct, size, shape, body_truncated?}`. Detail envelope: `{key, url, method, status, ct, size, shape, body, body_truncated?, body_full_size?, body_truncation_reason}`. Cache lives in `~/.bycli/cache/browser-network/`.

Default output keeps JSON/XML/plain-text and JS-like API responses, drops static assets and telemetry. If an expected endpoint is missing, try `--all`.

### Tabs & session

| command | purpose |
|---------|---------|
| `browser tab list` | JSON array of `{index, page, url, title, active}`. The `page` string is the tab identity for `tab select`/`tab close` and `--tab <targetId>`. |
| `browser tab new [url]` | Open new tab. Prints the new `page` string. |
| `browser tab select [targetId]` | Make a tab the default. All subcommands accept `--tab <targetId>` to target without changing default. |
| `browser tab close [targetId]` | Close by `page`. |
| `browser back` | History back on active tab. |
| `browser close` | Release current owned browser session. |
| `browser <session> bind` | Bind current Chrome tab to named session. Binding never owns user window. |
| `browser <session> unbind` | Detach bound session without closing user tab/window. |

---

## Compound form controls

Every date/time, select, and file input carries a `compound` field. Use it — do not regex attributes.

### Date family

```json
{
  "control": "date",
  "format": "YYYY-MM-DD",
  "current": "2026-04-21",
  "min": "2026-01-01",
  "max": "2026-12-31"
}
```

`control` is one of `date | time | datetime-local | month | week`. `format` is a concrete template — type using that exact format.

### Select

```json
{
  "control": "select",
  "multiple": false,
  "current": "United States",
  "options": [
    { "label": "United States", "value": "us", "selected": true },
    { "label": "Canada", "value": "ca" }
  ],
  "options_total": 137
}
```

`options[]` capped at 50 entries. **`current` is always correct** — computed from all options, not the truncated list. If `options_total > options.length`, call `browser select <target> "<label>"` directly — CLI matches against live DOM.

### File

```json
{
  "control": "file",
  "multiple": true,
  "current": ["report.pdf", "cover.png"],
  "accept": "application/pdf,image/*"
}
```

Do not invent file paths. Respect `accept` when telling the user what to upload.

### Where compounds show up

- `browser find --css <sel>` entries: inline on each match
- `browser get html --as json` tree nodes: inline on matching nodes
- `browser state` snapshot: in `compounds (N):` sidecar keyed by numeric ref

---

## Cost guide

| command | cost | when |
|---------|------|------|
| `state` | medium | First call on page, after nav |
| `find --css <sel>` | small | Already know selector |
| `get title/url` | tiny | Sanity checks |
| `get text/value/attributes` | tiny | Verify one field |
| `get html` (raw) | huge | Avoid unbounded; use `--selector` |
| `screenshot` | large | Only for visual pages |
| `extract` | medium/chunk | Long-form reading |
| `network` (default) | small | First look at APIs |
| `network --detail` | varies | Pull one body |
| `eval` | controlled | Targeted extraction |

Rule of thumb: one `state` per page transition, one `find` per follow-up, one `get`/`click`/`type` per action. >10 calls per page = probably scraping → use `extract` or `network`.

---

## Chaining rules

**Good** — one shell, live session:
```bash
bycli browser hn open "https://news.ycombinator.com" \
  && bycli browser hn state \
  && bycli browser hn click 3
```

**Never** chain a write then immediate `state` without a `wait` if the action causes a network round-trip.

---

## Recipes

> **冷启动 / 关闭 / Kill-all-Chrome 流程** 见 [SKILL.md](../SKILL.md) "浏览器生命周期" 章节。

### Fill a login form

```bash
bycli browser login open "https://example.com/login"
bycli browser login state                          # find [N] for email, password, submit
bycli browser login type 4 "me@example.com"
bycli browser login type 5 "hunter2"
bycli browser login get value 4                    # verify (autocomplete can eat chars)
bycli browser login click 6                        # submit
bycli browser login wait selector "[data-testid=account-menu]" --timeout 15000
bycli browser login state                          # fresh refs on logged-in page
# If still on login page (MFA), keep session alive — don't close.
```

### Pick from a long native dropdown

```bash
bycli browser form state                          # [12] <select name=country>
bycli browser form find --css "select[name=country]"
# compound.options_total is 137, compound.current is "" — unselected
bycli browser form select 12 "Uruguay"
bycli browser form get value 12                   # { value: "uy", match_level: "exact" }
```

### Pick from custom React dropdown

For Radix, shadcn, Material UI, or any non-native `<select>`:

```bash
bycli browser mercury state                       # find trigger ref
bycli browser mercury state --source ax           # use AX if unclear
bycli browser mercury click 7                     # click trigger
bycli browser mercury state --source ax           # fresh refs after portal opens
bycli browser mercury click 12                    # click option
bycli browser mercury get text 7                  # verify selected label
```

Do NOT use `browser select` on custom dropdowns. Drive with `state → click trigger → state → click option → verify`.

### Compare DOM vs AX

```bash
bycli browser compare state --compare-sources
```

Report `sources.dom.refs`, `sources.ax.refs`, `frame_sections`, `approx_tokens`, `elapsed_ms`. Use before arguing AX should be default.

### Scrape via network

```bash
bycli browser hn open "https://news.ycombinator.com"
bycli browser hn network --filter "title,score"
# find the entry, note its key
bycli browser hn network --detail topstories-a1b2
```

### Read a long article in chunks

```bash
bycli browser article open "https://blog.example.com/long-post"
bycli browser article extract --chunk-size 8000
# -> content + next_start_char: 8000
bycli browser article extract --start 8000 --chunk-size 8000
# ...until next_start_char is null
```

### Cross-origin iframe

```bash
bycli browser checkout frames
# -> [{"index": 0, "url": "https://checkout.stripe.com/...", ...}]
bycli browser checkout eval "(() => document.querySelector('input[name=cardnumber]')?.value)()" --frame 0
```

`state --source ax` may omit cross-origin iframe contents. Use `frames` + `eval --frame`, normal DOM `state`, or navigate directly to iframe URL.

---

## Pitfalls

> **生命周期相关的 pitfalls**（close 不停 daemon、daemon stop 不停 Chromium、cold-start 行为、Login 例外）见 [SKILL.md](../SKILL.md) "浏览器生命周期" 章节。

- **Do not submit forms via `eval "document.forms[0].submit()"`.** Modern sites intercept with JS handlers and silently drop. Use `click` on the submit button.
- **Do not reuse refs across a page transition.** `wait` for new state, then re-`state`. Old refs will 404 or `reidentify` onto a wrong element.
- **`match_level: reidentified` is a warning, not an error.** Action went through, but verify with `get text`/`get value` before chaining more writes.
- **Budget-aware commands silently cap.** `get html --as json` returns `truncated: {...}`. Raise `--depth`/`--children-max` or tighten selector if needed.
- **`autocomplete: true` on `type` response is not an error.** Suggestion popup is open. `keys Enter` to accept, or `click` the one you want.
- **`network --filter` is AND-semantics on path segments.** `--filter "title,score"` keeps entries whose body shape contains BOTH as path segments at any depth. Not a regex.
- **Screenshots are for humans, not agents.** Use `state` + `find` unless page is genuinely visual (captcha, chart). Screenshots burn tokens.

---

## Troubleshooting

| symptom | fix |
|---------|-----|
| `bycli doctor` red: "Browser not connected" | 见 SKILL.md 冷启动流程：`openclaw browser --browser-profile openclaw start` |
| `Browser profile "<id>" is not connected` | 同上，Chromium 未运行 |
| `Extension: connected` but `Connectivity: failed` | Race during cold start. Re-run `bycli doctor` after a few seconds; if persistent, `bycli daemon restart`. |
| `attach failed: chrome-extension://...` | Disable 1Password / other CDP-hungry extensions temporarily. |
| `selector_not_found` right after `state` | Page mutated. `wait selector "..."` then retry. |
| `stale_ref` across every command | Reusing refs from prior page. Re-`state`. |
| `click` succeeds but nothing happens | Decorative wrapper stealing clicks. `find --css "..."` with narrower selector on inner element. |
| `type` appears to finish but value is wrong | Autocomplete, masked input, or React controlled re-render. `get value` + re-type or `keys Enter`. |
| Giant `get html` output | Pass `--selector` + `--as json --depth 3 --children-max 20 --text-max 200`. |
| Network cache seems stale | Bump `--ttl` down, or let expire. Cache at `~/.bycli/cache/browser-network/`. |
| `daemon stop` slow / hangs | Daemon waiting for extension to release CDP socket. Close byCLI-owned tab first (`browser <session> close`), then retry. |

---

## See also

- [adapter-author.md](./adapter-author.md) — turning browser discoveries into a reusable adapter
- [autofix.md](./autofix.md) — when an existing adapter breaks
