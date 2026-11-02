# Atomic snapshot measurements

Measured locally on 2026-09-23 with the same installed headless Google Chrome and `PlaywrightBrowserDriver` before and after the atomic snapshot change. Each document contains 20, 100, or 200 buttons. One warmup is followed by seven serial samples per size. No model, external website, network, initial navigation, browser startup, screenshots, or action execution is timed.

The old observation performs `describeElements`, body text, blocking layers, title, structure fingerprint, and content fingerprint reads. The new observation uses `readSnapshot` to return the same information coherently. The sample p95 below is the maximum of seven samples, not a statistically robust tail-latency estimate.

| Controls | Old median | New median | Old sample p95 | New sample p95 | Median reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 | 37.373ms | 2.911ms | 46.996ms | 4.209ms | 92.2% |
| 100 | 140.746ms | 5.185ms | 211.016ms | 6.107ms | 96.3% |
| 200 | 238.795ms | 9.269ms | 256.271ms | 9.405ms | 96.1% |

Run from the plugin directory:

```sh
BROWSER_SNAPSHOT_BENCH=1 pnpm vitest run tests/snapshot-performance.spec.ts --disableConsoleIntercept
```

The benchmark supports the old driver through its legacy fallback; retain the test file when measuring a pre-change checkout. Output includes all seven samples. Ordinary verification skips this opt-in benchmark. Timing is reported, not asserted, to avoid machine-load-sensitive tests.

`browser-snapshot.spec.ts` separately asserts one warm registry evaluation for 200 controls, no locator enumeration, and no repeated registry creation. This counts public Playwright evaluations, not total wire-level CDP messages. First use creates the private registry with one extra evaluation. After actions, any lazily acquired target handles are disposed on the next observation.

These results demonstrate observation overhead reduction on a synthetic fixture only. End-to-end task latency, model tokens, and real-site completion rate were not measured. Scoped target guards and adaptive post-action waits remain separate follow-up work. The existing one-action `act` interface already combines mutation and final observation; the tool description now recommends it when fresh page state is needed.

The registry is held through a private JSHandle with no page-global name or DOM marker. This prevents page code from directly locating or overwriting a published registry, but is not isolated-world execution and does not establish a new security sandbox. Existing Playwright policy, actionability, lease, and process boundaries still apply.

## Compact/full observation comparison

Measured on 2026-09-23 using the opt-in test above, now also containing a mixed-visibility history fixture: 80 hidden buttons, 20 visible buttons, 300 history paragraphs, and 20 offscreen buttons. Both modes use the same driver/browser/document and 200-element/16,000-character outer limits. Compact mode applies its additional viewport filter and 6,000-character limit.

| Mode | Returned elements | Text characters | Serialized snapshot bytes |
| --- | ---: | ---: | ---: |
| full | 120 | 16,000 | 37,783 |
| compact | 20 | 2,976 | 6,751 |

The serialized snapshot is 82.1% smaller on this fixture. Bytes include internal snapshot metadata, not just the model-facing tool envelope, and are **not token counts**. Single-sample reads were 7.911ms/full and 5.385ms/compact; these are illustrative, not a latency guarantee. Seven-sample full-mode medians on the original button fixtures were 1.861ms/20, 5.362ms/100, and 9.488ms/200 controls in this run.

Real-browser regressions cover filter-before-cap, ancestor overflow/opacity, clipped multiline text, open shadow slots, `display:contents`, full opt-in, the compact text bound, internal and document scrolling, reverse/clamped/zero movement, invalid targets, recoverable hidden-target errors, and stale versions. Scroll offsets are immediate CSS-pixel measurements; no image stitching or complete real-site workflow benchmark is claimed. The supplied report's 13-minute/3-minute and screenshot-speed estimates remain unverified.
