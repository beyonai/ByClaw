# Dynamic Baiying Model Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the minimal `develop` dynamic model-registration path into the current `baiying-enhance` plugin and remove static model credentials from OpenClaw config.

**Architecture:** Keep the existing agent watchdog and Redis Cluster connection layer. Add a focused model adapter/registry boundary that normalizes Redis model data into OpenClaw providers and models, then use a runtime provider hook to resolve tokens without persisting secrets. The config file contains no provider credentials; synchronization is responsible for model availability.

**Tech Stack:** TypeScript, OpenClaw plugin SDK compatibility API, ioredis-compatible Redis Cluster adapter, Vitest, JSON configuration.

## Global Constraints

- Preserve current Redis Cluster support and unrelated working-tree changes.
- Never commit API keys, bearer tokens, private URLs, or production connection strings.
- Do not replace the entire `develop` extension; port only model registration behavior.
- Use tests before production implementation for each new behavior.

---

### Task 1: Lock down model normalization and config merge behavior

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/aimodel-config.test.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/agent-registry.test.ts` if the existing test file is present; otherwise add it beside the registry implementation.

**Interfaces:**
- Test the model-record normalization contract and `mergeManagedAgentsIntoConfig` behavior without a live Redis connection.

- [ ] **Step 1: Write failing tests** for a valid model record producing a managed provider/model, malformed records being ignored, and stale `baiying-m-*` providers being removed while unrelated providers remain.
- [ ] **Step 2: Run the focused Vitest tests** and verify they fail because the dynamic model adapter/fields are not implemented.
- [ ] **Step 3: Confirm the failure is behavioral**, not a missing test setup or dependency error.

### Task 2: Implement the minimal dynamic model adapter

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/aimodel-config.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/agent-adapter.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/agent-registry.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/types.ts`

**Interfaces:**
- Provide a pure normalization function returning an OpenClaw-compatible managed provider bundle.
- Extend managed-agent/provider metadata only where required by model synchronization.

- [ ] **Step 1: Add the smallest types and parser needed by the failing tests.**
- [ ] **Step 2: Generate provider keys with the existing managed prefix**, normalize API protocol and model capabilities, and preserve secret references instead of credential values.
- [ ] **Step 3: Update config merge to add current managed providers and remove only stale `baiying-m-*` providers.**
- [ ] **Step 4: Run focused tests and verify they pass.**

### Task 3: Register dynamic provider authentication at plugin startup

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/aimodel-auth-cache.ts`
- Create: `byclaw-exe/extensions/baiying-enhance/src/aimodel-runtime-provider.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/index.ts`

**Interfaces:**
- Register one Baiying provider hook that handles managed provider ids and resolves a current token from the Redis-backed cache.
- Leave unrelated OpenClaw providers untouched.

- [ ] **Step 1: Add tests for managed provider id recognition and token lookup behavior.**
- [ ] **Step 2: Run the tests to verify the new provider hook fails before implementation.**
- [ ] **Step 3: Implement the hook and register it during plugin registration.**
- [ ] **Step 4: Run provider-focused tests and the existing plugin unit tests.**

### Task 4: Remove static model credentials from OpenClaw config

**Files:**
- Modify: `openclawConfig/openclaw.json`

**Interfaces:**
- Keep non-model gateway, plugin, channel, and agent settings unchanged.
- Remove the static model provider/default model/model alias and credential material.

- [ ] **Step 1: Parse the config and assert the model provider block is absent or empty.**
- [ ] **Step 2: Keep `${OPENCLAW_STATE_DIR}` and `${OPENCLAW_GATEWAY_TOKEN}` references intact.**
- [ ] **Step 3: Run OpenClaw config validation against a copied writable test config.**

### Task 5: End-to-end verification

**Files:**
- No production files unless verification identifies a regression.

- [ ] **Step 1: Run the focused `baiying-enhance` Vitest suite.**
- [ ] **Step 2: Run the relevant `byai-channel` SDK tests or typecheck.**
- [ ] **Step 3: Start the pulled image with `openclawConfig/.env`, a test-only gateway token, and a writable directory mount for `/by/.openclaw/openclaw.json`.**
- [ ] **Step 4: Confirm logs show plugin readiness, Redis Cluster detection, worker registration, and no config/schema failure.**
- [ ] **Step 5: Send a new SDK message and verify its Redis v2 data stream contains the expected answer event.**
- [ ] **Step 6: Run the final verification checklist and report exact modified files and test evidence.**
