# Byclaw Wiki

Bundled OpenClaw plugin that exposes one tool: `code_to_wiki`.

The plugin is intentionally narrow:

- Clone/cache a requested Git repository on demand.
- Build or refresh a CodeGraph index for fast source analysis.
- Run CodeGraph query modes for agents.
- Generate and read Zread Wiki output under `.zread/wiki`.

It does not upload generated files, send DingTalk notifications, run review
flows, publish to a knowledge base, preconfigure repositories, or run scheduled
sync jobs. Those workflow steps belong to separate skills or human-owned agent
orchestration.

## Repository handling

Every tool call provides the repository:

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "mode": "explore",
  "question": "How does login work?"
}
```

Rules:

- `repositoryUrl` is required.
- `branch` is optional. When omitted, Git uses the remote default branch.
- `gitDepth` defaults to `1`.
- The local checkout is cached under `<dataDir>/repos/<repo-name>-<hash>`.
- Cached code is reused unless the call sets `refresh: true` or uses
  `mode: "pull"`.
- Private HTTPS repositories should pass `credentialRef`, which is the name of
  an environment variable containing the Git token. Never pass the token value
  itself.

## Modes

CodeGraph modes:

- `status`: show cached checkout, CodeGraph, and Zread status.
- `pull`: clone or refresh the repository and rebuild/sync the CodeGraph index.
- `explore`: best default for architecture and "how does this work" questions.
- `query`: symbol/search query.
- `node`: inspect a file or symbol.
- `files`: list repository files.
- `callers`, `callees`, `impact`: focused graph navigation.

Zread modes:

- `wiki_status`: check Zread CLI, login/config, draft, and current wiki state.
- `wiki_generate`: run `zread generate --stdio -y`.
- `wiki_list`: list markdown pages from a generated wiki version.
- `wiki_read`: read one generated markdown page.
- `wiki_clear_draft`: delete `.zread/wiki/drafts`.

`wiki_generate` and `wiki_clear_draft` require `yes: true` because they mutate
local Zread state or may run for a long time.

## Zread LLM model config

For server deployments, byclaw-wiki prepares a service-level Zread config before
`wiki_status` and `wiki_generate`.

Priority:

1. Read the platform default LLM from Redis Hash `byai:aimodel:typelist`, field
   `LLM`.
2. Prefer the active model with `isDefault=1`; otherwise use the first active
   LLM.
3. Use `url`, `modelCode`, and `authToken` from the Redis model record.
4. If Redis resolution fails, use explicit `zreadLlm*` plugin config.
5. If neither Redis nor fallback config is complete, `wiki_status` reports the
   model config error and `wiki_generate` fails before running Zread.

`zreadAimodelEnabled: false` disables Redis lookup only. The plugin still uses
`zreadLlm*` fallback config when it is complete.

After resolving the model, byclaw-wiki will:

- Write `<zreadHome>/.zread/config.yaml`.
- Run the Zread CLI with `HOME=<zreadHome>`.

Redis connection defaults come from environment variables:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_USERNAME`
- `REDIS_PASSWORD`
- `REDIS_DATABASE` or `REDIS_DB`

You can also set `redisHost`, `redisPort`, `redisUsername`, `redisPassword`,
and `redisDatabase` in plugin config when the server cannot provide environment
variables.

The generated config matches Zread's expected shape:

```yaml
llm:
    provider: 'openai'
    model: 'model-code-from-redis'
    api_key: 'auth-token-from-redis'
    base_url: 'url-from-redis'
concurrency:
    max_concurrent: 1
    max_retries: 0
```

`authToken` is read from Redis at runtime and is not stored in plugin config
unless you intentionally configure the fallback `zreadLlmApiKey`. Direct API key
fallback is supported, but `zreadLlmApiKeyEnv` is preferred for server secrets.

## Example config

Most fields have defaults. Repository selection is request-level.

Minimal server config:

```json5
{
  plugins: {
    entries: {
      "byclaw-wiki": {
        enabled: true,
        config: {}
      }
    }
  }
}
```

Fallback LLM config when Redis is unavailable:

```json5
{
  plugins: {
    entries: {
      "byclaw-wiki": {
        enabled: true,
        config: {
          zreadLlmProvider: "openai",
          zreadLlmModel: "glm-5.1",
          zreadLlmBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          zreadLlmApiKeyEnv: "ZREAD_LLM_API_KEY"
        }
      }
    }
  }
}
```

Direct API key fallback is also supported:

```json5
{
  plugins: {
    entries: {
      "byclaw-wiki": {
        enabled: true,
        config: {
          zreadLlmProvider: "openai",
          zreadLlmModel: "glm-5.1",
          zreadLlmBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          zreadLlmApiKey: "replace-with-server-side-secret"
        }
      }
    }
  }
}
```

Explicit Redis connection config, if environment variables are not available:

```json5
{
  plugins: {
    entries: {
      "byclaw-wiki": {
        enabled: true,
        config: {
          redisHost: "redis.internal",
          redisPort: 6379,
          redisDatabase: 0
        }
      }
    }
  }
}
```

## Enable the plugin

```bash
cd byclaw-exe/extensions/byclaw-wiki
pnpm install
pnpm run build
openclaw plugins enable byclaw-wiki
```

Restart the OpenClaw Gateway process. After startup, check logs for:

```text
byclaw-wiki: ready (request-level repositories, CodeGraph + Zread)
```

## HTTP route

The Gateway route is fixed at `/plugins/byclaw-wiki`.

- `GET /plugins/byclaw-wiki`: cached repository statuses.
- `POST /plugins/byclaw-wiki`: prepare one repository.

Example:

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "refresh": true,
  "gitDepth": 1
}
```
