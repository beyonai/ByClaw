# Recorder stop control layout

## Context

During an active A/B recording, `CaptureStep` gives each preview implementation a fixed height. The stop button follows the preview in normal document flow, so it can fall below the visible workbench area on common laptop viewports.

## Decision

Use an in-card flexible recording layout:

- The recording card and its body form a vertical flex container that can shrink within the workbench.
- The preview host consumes remaining space through flex layout. It has no fixed pixel height.
- VNC, embedded-iframe, and projection previews fill their host using `height: 100%` and `min-height: 0` where needed.
- The stop action occupies a sticky footer at the bottom of the recording card. It remains visible while the preview region scrolls or shrinks.
- Non-recording states keep the existing document-flow layout. Narrow layouts retain normal page scrolling.

## Alternatives considered

1. Reduce a fixed preview height: minimal change, but fails at other viewport sizes.
2. Use a card-local flexible preview with sticky stop footer: selected because the action remains visible without a magic height.
3. Fix the action to the browser viewport: rejected because it breaks card context and can cover unrelated content.

## Verification

- Add a focused component test for the recording layout and stop action.
- Run the targeted Jest test, frontend lint checks, and production build.
- Manually verify all three preview modes at desktop and narrow viewport sizes.
