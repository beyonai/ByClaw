# ByClaw DSH plugin ownership implementation plan

1. Add failing ByClaw session-context checks that reject runtime-capability and CodeGraph text.
2. Remove CodeGraph discovery, prompt registration, and runtime-capability rendering from `byclaw-integration` while preserving session workspace inheritance.
3. Import the deployed upstream source revisions for Trellis, better sidebar, and diff viewer; re-scope package identities and bundle rows to `@byclaw/*` without changing their feature behavior.
4. Add `@byclaw/dsh-codegraph` with focused tests for dynamic prompt registration and a bundle patch that composes the MCP client.
5. Update repository and package documentation, package metadata, and verification commands.
6. Replace the Web profile bundles and remove its hand-written `mcp-codegraph` row.
7. Build and test all affected packages, inspect the effective profile tree, and run the ByAI inbound end-to-end scenario.
