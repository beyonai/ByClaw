# ByAI Channel Language Enforcement Design

## Goal

Strengthen direct `byai-channel` conversations so the normalized channel language is always injected as a highest-priority system instruction. The change must remain small, must not introduce ACP behavior, and must preserve the existing `zh_CN` / `en_US` language templates.

## Current Behavior and Gap

The plugin already defines strong Chinese and English channel-language prompts in `src/i18n.ts`. The SDK reads `metadata.language`, normalizes it, and stores the result on the active request.

Two conditions can still weaken enforcement:

1. `resolveInboundLanguage` currently checks the container `LANG` before `metadata.language`, so an environment value can override the language explicitly supplied by the channel.
2. `before_prompt_build` injects the language prompt only when `languageProvided` is true. When neither channel metadata nor `LANG` is present, normalization selects `zh_CN`, but the corresponding mandatory system prompt is omitted.

## Design

### Language Resolution

`resolveInboundLanguage` will use this precedence:

1. A non-empty `metadata.language` value from the current channel request.
2. A non-empty `process.env.LANG` value as a compatibility fallback.
3. `zh_CN` as the existing normalized default.

`languageProvided` remains a provenance flag. It is true when either channel metadata or the environment supplied a non-empty value, and false only when the default was used.

### Prompt Injection

For an active `byai-channel` request, `before_prompt_build` will always append `buildLanguagePrompt(request.language)`.

The existing prompt text and its explicit-user-language exception remain unchanged. This design does not infer language from message text and does not add language instructions to unrelated channels.

### Scope

Production changes are limited to:

- `byclaw-exe/extensions/byai-channel/src/i18n.ts`
- `byclaw-exe/extensions/byai-channel/src/hooks.ts`

A focused test file will cover resolution precedence and prompt injection behavior. No ACP modules, prompt-snapshot infrastructure, Redis schema, model-loading logic, or OpenClaw configuration format will be changed.

## Error and Compatibility Behavior

- Unknown non-empty locale values continue to normalize to `zh_CN`.
- Empty and whitespace-only metadata values fall back to `LANG`, then `zh_CN`.
- The existing `languageProvided` field is retained so other code can still distinguish an explicit source from the default.
- Explicit user instructions to switch language remain the sole exception defined by the existing system prompt.

## Verification

### Automated

Use test-driven development to prove:

1. Channel metadata wins when `metadata.language` conflicts with `LANG`.
2. `LANG` remains a fallback when channel metadata is absent.
3. No metadata and no `LANG` normalize to `zh_CN`.
4. An active request with `languageProvided=false` still receives the mandatory Chinese language prompt.
5. An active English request receives the mandatory English language prompt.

Run the focused tests, the plugin test suite that is executable in the current environment, and the plugin build.

### OpenClaw Integration

Use the existing local D0.0.5 image and bind-mount the updated plugin and `openclawConfig`:

1. Send an English query with channel language `zh_CN`; verify the visible response is Chinese.
2. Send a Chinese query with channel language `en_US`; verify the visible response is English.
3. Call `baiying-agent-10000235` and require a real `baiying_call` knowledge-base invocation.
4. Verify dynamic model switching from `MiniMax-M3` to `MiniMax-M3-2000`, then restore `MiniMax-M3`.
5. Confirm Redis ends with exactly one default LLM model, `MiniMax-M3`.

## Non-Goals

- Backporting ACP language metadata or ACP tools.
- Backporting develop's prompt-injection snapshot, chat-room, multi-agent, or session architecture.
- Changing the wording of the existing Chinese or English mandatory-language prompts.
- Inferring response language from user message content.
