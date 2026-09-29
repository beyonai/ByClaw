---
name: grok-research-agent
description: Use when an Agent needs to build a sourced business brief from current public web information and X discussions through the installed Grok search CLI.
---

# Grok Research Agent

Use `groksearchcli` as the only Web/X access path. Do not call xAI directly or request an API Key from the user.

## Workflow

1. Validate the business query and inclusive `YYYY-MM-DD` date range.
2. Use only the domains and X handles allowed by this Skill's business scope.
3. Run `groksearchcli describe research run` before coding against an unfamiliar contract.
4. Execute `scripts/run.py` once. It invokes one `research run`, not separate Web and X commands.
5. Require subprocess exit code `0`, valid JSON, and `ok: true`.
6. Return the answer with citations; distinguish verified web sources from X opinions.

Do not parse CLI help, inspect installed source, guess output variants, or add a second retry loop. The CLI owns credentials,
HTTP behavior, and safe transport retries. A `retryable: true` error is information for the caller, not authorization for this
Skill to repeat the request.

Read [`references/commands.md`](references/commands.md) for the public entry and output fields.
