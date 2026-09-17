---
name: invoke-baiying-capability
description: Use when a business workflow must call one pre-approved Baiying TOOL, TOOLKIT, MCP, or remote AGENT capability from a Skill script through callcli.
---

# Invoke Baiying Capability

Use the bundled script as the Skill's only public execution entry. Before enabling the Skill, read
`references/capability-contract.md` and replace its placeholders plus the matching constants in
`scripts/run.py` with values obtained from `callcli resource list` and `callcli resource describe`.

Run:

```bash
python3 scripts/run.py <session_id> <business-query>
```

Keep the assigned resource ID, type, and action fixed in the script. Pass the runtime session ID
unchanged. Do not accept or discover endpoints, tokens, cookies, Redis settings, headers, or private
parameters in this Skill.

For TOOLKIT and MCP, the script must run `callcli resource describe` on every business execution
before `callcli invoke`. Select only the fixed action when it is present in the current `actions` or
`tools` result, and construct arguments from that action's current input schema. Never skip describe,
reuse a stale discovery result, guess an action, or invoke when the configured action is absent.

Interpret success only when both the subprocess exit code is zero and output has `ok: true`. Stop on
authorization, type mismatch, unsupported resource, or protocol errors. Do not route PAGE, DOC,
OBJECT, VIEW, or ASK_PERSONAL through this Skill.
