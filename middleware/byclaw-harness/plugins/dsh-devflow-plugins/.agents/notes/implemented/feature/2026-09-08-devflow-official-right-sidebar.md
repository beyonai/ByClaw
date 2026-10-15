# Agent Note: devflow — adopt the official Harness right Sidebar

Status: implemented

## Problem

The Devflow board originally had to supply its own navigation surface because Harness did not have one. It later preferred `dsh-better-sidebar` when that external foundation was installed and otherwise rendered a floating conversation control. Current Harness Web now owns a first-party right Sidebar, a guide that opens tab types, and a keyed body slot for those tabs. Keeping the compatibility chooser would leave two competing navigation systems, an extra installation step, and substantial code whose only purpose was supporting an obsolete host boundary.

## Decision

Devflow targets the official right Sidebar in Harness `0.1.3-alpha.2`. It registers one `devflow` tab type through `ctx.sidebarRightTabs` and registers the body under its implementation id in `sidebar.right.pane.tab`. The slot's `sessionId` scopes the board binding, and the tab's live `visible` fact gates fetching. Harness owns the start-page entry, tab lifecycle, pane sizing, close behavior, and fullscreen state. Normal presentation uses the existing stacked detail flow; fullscreen uses the existing side-by-side board and detail layout.

The floating action, optional foundation adapter, dynamic surface chooser, badge and availability callbacks, and persisted foundation-specific split setting are removed. There is one surface and one lifecycle.

The official `@deepseek-ai/dsh-client-ui-sidebar-right` source exists in Harness but is not yet published to npm. This standalone plugin therefore restates only the registry and keyed-slot type slice that it consumes, just as its earlier external integration restated a service boundary. It neither imports nor declares the unpublished package. Runtime behavior remains owned by Harness, and tests pin the copied type boundary to the registration and slot shapes used by the current source.

This decision supersedes the host-integration part of [the two-surface note](2026-08-26-devflow-board-sidebar-surface.md). Its surface-neutral view and per-session binding decisions remain in force, as does the [stage-centric Kanban](2026-08-31-devflow-stage-centric-kanban.md).

## Alternatives considered

- **Keep `dsh-better-sidebar` as a fallback** — rejected because the supported Harness already provides the host, and fallback would preserve a second navigation system and installation matrix.
- **Keep the floating control when the official service is absent** — rejected because silently changing the information architecture hides a composition error. The plugin now fails its declared injection when installed into an unsupported Harness.
- **Depend on the official package directly** — rejected until it is actually published to npm; doing so today makes an otherwise valid standalone install impossible.
- **Vendor the official implementation** — rejected because tab state, layout, and host UI must have one owner. Devflow consumes the extension boundary only.

## Verification

- Browser component tests run the actual Cordis context and SlotRegistry while substituting only the unpublished official registry boundary. They pin registration, keyed body mounting, session isolation, visibility-gated reads, fullscreen-state propagation, and disposal.
- All 19 packed Devflow packages were installed into a real Harness `0.1.3-alpha.2` Web profile after removing `dsh-better-sidebar`. The running browser exposed Devflow on the official Sidebar guide and tab strip; the real board, card detail, and return navigation were exercised there, and the former floating action was absent.
- The official Sidebar package cannot yet participate in a portable automated composition test because it is not published or present in this repository. The real-profile check above is therefore the compatibility evidence for that host-owned half; once the package is published, replace the local type restatement and add it to the automated composition fixture.

## Consequences

Users install only `@zhchxiao123/dsh-devflow-bundle`; the Devflow entry appears in the standard right Sidebar beside Files and other first-party pages. The board no longer overlays conversation content and follows the host's tab, close, and fullscreen behavior. Removing the old compatibility path also removes its tab badge, foundation-specific availability calculation, and persisted split preference; the page toolbar still reports board counts, and fullscreen now provides the explicit wide layout.

Compatibility is intentionally scoped to Harness Web versions that compose `sidebarRightTabs` and `sidebar.right.pane.tab`. When the official package becomes publishable, the local declaration should be replaced by its exported types without changing runtime behavior. Reintroducing another surface would require a distinct product requirement and evidence that a supported Harness composition lacks the official host.
