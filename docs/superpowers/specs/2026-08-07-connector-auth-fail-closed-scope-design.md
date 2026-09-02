# Connector Authorization Fail-Closed Scope Design

## Goal

Limit fail-closed connector authorization behavior to valid `skillCode` keys that can still be safely recovered from `metadata.authConnectorList`. Invalid or oversized authorization metadata must never make every third-party connector, unrelated skill, or unrelated tool unavailable.

## Current Problem

The normal authorization prompt scopes behavior to explicit entries such as:

```json
{
  "authConnectorList": {
    "dws": true,
    "fws": false,
    "wecomcli": true
  }
}
```

Here each property name is a `skillCode`. However, invalid and overflow policies are normalized to a synthetic marker and the generated prompt says that every third-party connector is unavailable. This loses the original scope and can block unrelated work.

## Design

### Normalization

- Continue accepting only plain objects under `metadata.authConnectorList`.
- Treat a key as recoverable only when it satisfies the existing `skillCode` validation rules.
- Preserve current behavior for a fully valid policy: `true` means enabled and `false` means disabled.
- When a policy is invalid, retain the recoverable `skillCode` keys and mark only those skills fail-closed. Ignore keys that cannot be validated as skill codes.
- When a policy exceeds the safe processing limit, retain a bounded, deterministic set of recoverable `skillCode` keys. Do not infer anything about omitted or unrelated skills.
- If no valid `skillCode` can be recovered, retain the invalid-policy diagnostic but do not block any skill or tool.

### Prompt Behavior

The invalid and overflow prompt branches will:

- list the recoverable affected `skillCode` values;
- state that only those listed skills are unavailable;
- explicitly state that unlisted skills, connectors, and unrelated tools remain unaffected;
- require mixed requests to continue for unaffected subtasks;
- avoid wording such as “every third-party connector is unavailable”;
- provide the existing ByClaw connector-management guidance only when the current request actually needs an affected skill.

Chinese and English templates will express the same scope.

### Diagnostics

Existing synthetic invalid and overflow identifiers remain available for safe logs. Logs must not contain raw malformed identifiers and must not become enforcement logic.

## Error and Edge Cases

- Non-object, empty, or otherwise unscoped metadata: report an invalid policy without blocking any skill.
- Mixed valid and malformed entries: fail-close only recoverable valid `skillCode` keys.
- Duplicate keys after trimming: preserve the existing conservative collision behavior.
- More entries than the safety cap: use only the deterministic bounded recovered set and leave all unlisted skills unaffected.
- Absent `authConnectorList`: preserve legacy compatibility and inject no connector restriction prompt.

## Testing

Tests will be written before implementation and will verify:

- invalid policies restrict only recoverable `skillCode` values;
- overflow policies never claim that all third-party connectors are unavailable;
- Chinese and English prompts list the affected skills and preserve unrelated work;
- policies with no recoverable skill code do not block skills or tools;
- valid mixed enabled/disabled behavior remains unchanged;
- diagnostic markers remain stable and non-blocking.

## Scope

Changes are limited to the `byclaw-exe/extensions/byai-channel` connector authorization normalization, prompt generation, and their focused tests. No connector backend, frontend, or cross-module contract changes are required.
