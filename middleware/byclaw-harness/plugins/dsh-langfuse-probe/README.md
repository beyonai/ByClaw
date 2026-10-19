# DSH Langfuse Event Probe (temporary)

Minimal side-effect-free probe for discovering the events and payload shapes available in DSH 0.1.5-rc.2 before implementing the Langfuse exporter. It makes no network calls and never changes event results.

Image builds mount only plugins that declare `dsh.bundle.patch`. This package no longer declares it, so a rebuilt sandbox profile does not include `@byclaw/dsh-langfuse-probe`.

To use it for a temporary diagnosis, restore `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` in `package.json`, install the plugin in a DSH profile, run a normal turn, a tool call, and a subagent, then search the DSH log for `[langfuse-probe]`.
