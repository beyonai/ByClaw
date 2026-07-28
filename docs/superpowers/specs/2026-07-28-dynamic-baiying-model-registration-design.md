# Dynamic Baiying Model Registration Design

## Goal

Make the current `baiying-enhance` plugin dynamically register Baiying model providers and model metadata from the existing Redis Cluster data source, matching the model-registration behavior already present on `develop`, and remove hard-coded model credentials from `openclawConfig/openclaw.json`.

## Scope

- Port only the model configuration, provider runtime authentication, and managed-agent model merge path needed by `baiying-enhance`.
- Preserve the current branch's Redis Cluster compatibility implementation and existing digital-employee synchronization behavior.
- Keep OpenClaw's static config valid when Redis has not yet supplied a model snapshot; do not invent a fallback credential.
- Remove the static default provider/model and API key from the checked-in OpenClaw config.

## Data flow

1. `baiying-enhance` reads the model-management Redis hash/snapshot using the existing Redis JSON store and cluster-aware connection settings.
2. The model adapter normalizes provider name, model id, API protocol, endpoint, capabilities, and token reference into an OpenClaw-compatible provider bundle.
3. Managed-agent config merging removes stale `baiying-m-*` entries and adds the currently authorized model providers/models.
4. The provider runtime resolves the current model token from the Redis-backed auth cache without writing credentials into `openclaw.json`.
5. Existing agent synchronization continues to update `agents.list`; the default model is selected from the synchronized model data only when a valid Redis model snapshot exists.

## Error handling

- Ignore malformed or incomplete model records with a diagnostic warning.
- Preserve unrelated providers and agents.
- If Redis/model data is unavailable, retain a valid config without static credentials and let OpenClaw report model availability at request time.
- Never log API keys, bearer tokens, or secret references containing credential material.

## Verification

- Unit tests cover parsing, provider/model generation, stale managed-provider cleanup, missing-data behavior, and cluster-compatible Redis access.
- Validate `openclawConfig/openclaw.json` parses and contains no hard-coded model credential/provider block.
- Start the pulled OpenClaw image with the config mounted as a writable directory, confirm plugin startup and Redis Cluster detection, and run a byai-channel SDK request/response round trip.
