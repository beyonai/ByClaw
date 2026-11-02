# ByClaw DSH plugin suite commit plan

1. Fix the ByClaw inbound target resolver to support authorized `agent_id`, `agent_code`, `agent_name`, and one unambiguous textual `@resource` mention; keep structured `dsh_target_session_id` routing and the main-Agent fallback unchanged. Extend the live smoke helper with the same structured target fields.
2. Commit the ByClaw Integration runtime changes, including deterministic direct child sessions, durable workspace context, compatible live-e2e options, and focused verification scripts.
3. Replace the removed `trellis-context` package with the maintained `@byclaw/dsh-trellis` workflow plugin and preserve its upstream provenance and license metadata.
4. Add the ByClaw-owned Better Sidebar package with workspace browsing, editor, terminal, Git workspaces, IDEA-style history graph, task tree, browser, and extension-service capabilities; ensure fresh default tab titles follow the DSH locale and staged/unstaged Git folders start collapsed while retaining status-color markers.
5. Add the ByClaw-owned Diff Viewer package with unified/split rendering, syntax highlighting, collapsed context, windowed large-diff rendering, and nested write/edit support.
6. Add the ByClaw-owned CodeGraph package with the `codegraph-mcp` bundle row and scoped usage policy for root and delegated Agents.
7. Update the English and Chinese repository README files, the ByClaw Integration README pair, translation hash manifests, environment example, and verification/startup commands so package ownership, direct routing, installation, and capability boundaries match the code.
8. Keep local-only `.codegraph/`, `.cursor/`, `node_modules` symlinks, generated `lib/`, Playwright reports, and the Better Sidebar tarball out of commits; keep the existing `.idea`/worktree ignore hygiene changes only if they remain part of the intended repository setup.
9. Run affected package checks (scope limited to code and documentation; the requested Playwright mount lane is intentionally omitted), `git diff --check`, inspect the staged file list, create conventional commits in the order above, push `fix/better-sidebar-initial-ui` to `origin`, and verify the remote head.

## Commit messages

- `feat(byclaw): add authorized inbound direct routing`
- `refactor(trellis): replace trellis-context with dsh-trellis`
- `feat(sidebar): add ByClaw workspace sidebar`
- `feat(diff-viewer): add ByClaw visual diff plugin`
- `feat(codegraph): add CodeGraph MCP plugin`
- `docs: update plugin suite and integration guides`
- `chore: add DSH development container` (only if the Dockerfile is confirmed as intentional)

## Verification gate

- `pnpm --dir plugins/byclaw-integration verify`
- `pnpm --dir plugins/dsh-codegraph verify`
- `pnpm --dir plugins/dsh-diff-viewer check`
- `pnpm --dir plugins/dsh-better-sidebar typecheck`
- `pnpm --dir plugins/dsh-better-sidebar test`
- `pnpm --dir plugins/dsh-trellis test`
- `git diff --check`
- `git status --short`
