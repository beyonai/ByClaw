-- OpenClaw sandbox_service_spec 从 Docker/minio-mount 升级到 K3s/Longhorn 兼容
-- 基于 docs/reports/openclaw.sql，去掉 minio 残留、参数化镜像与密钥
-- 执行前请替换占位环境变量；幂等：ON CONFLICT DO UPDATE

ALTER TABLE "byai"."sandbox_service_spec"
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(128),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS enabled INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_profile_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS autoscale_enabled INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS "byai"."sandbox_service_profile" (
  id BIGINT NOT NULL DEFAULT nextval('byai.seq_any_table'::regclass),
  service_type VARCHAR(128) NOT NULL,
  profile_key VARCHAR(64) NOT NULL,
  resource_requests JSONB,
  resource_limits JSONB,
  template_patch_json JSONB,
  resize_enabled INTEGER DEFAULT 0,
  resize_strategy VARCHAR(32) DEFAULT 'IN_PLACE',
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT pg_systimestamp(),
  CONSTRAINT pk_sandbox_service_profile PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sandbox_service_profile_type_key
  ON "byai"."sandbox_service_profile" (service_type, profile_key);

INSERT INTO "byai"."sandbox_service_spec" ("service_key", "service_type", "display_name", "enabled", "default_profile_key", "autoscale_enabled", "spec_json", "template_json", "updated_at")
VALUES (
  'openclaw',
  'openclaw',
  'OpenClaw',
  1,
  'xs',
  1,
  '{
    "env": {
      "TZ": "Asia/Shanghai",
      "LANG": "zh_CN",
      "MODEL_ID": "${MODEL_ID}",
      "NODE_ENV": "production",
      "USER_CODE": "${user_code}",
      "MODEL_NAME": "${MODEL_NAME}",
      "REDIS_HOST": "${REDIS_HOST}",
      "REDIS_PORT": "${REDIS_PORT}",
      "DEMO_SCHEMA": "${DEMO_SCHEMA}",
      "GBRAIN_HOME": "/by/.openclaw/gbrain",
      "MODEL_ALIAS": "${MODEL_ALIAS}",
      "OPENCLAW_TZ": "Asia/Shanghai",
      "BEYOND_TOKEN": "${BEYOND_TOKEN}",
      "GBRAIN_MODEL": "openai:qwen-turbo",
      "NODE_OPTIONS": "--max-old-space-size=4096",
      "BE_DOMAINNAME": "ByaiService",
      "MODEL_API_KEY": "${MODEL_API_KEY}",
      "DWS_CONFIG_DIR": "/by/.openclaw/.dws",
      "MODEL_BASE_URL": "${MODEL_BASE_URL}",
      "OPENAI_API_KEY": "${OPENAI_API_KEY}",
      "OPENAI_BASE_URL": "${OPENAI_BASE_URL}",
      "REDIS_DATABASE": "${REDIS_DATABASE}",
      "REDIS_PASSWORD": "${REDIS_PASSWORD}",
      "REDIS_USERNAME": "${REDIS_USERNAME}",
      "BAIYING_SESSION": "${BAIYING_SESSION}",
      "DATACLOUD_DB_HOST": "${DB_HOST}",
      "DATACLOUD_DB_PASS": "${DB_PASS}",
      "DATACLOUD_DB_PORT": "${DB_PORT}",
      "DATACLOUD_DB_TYPE": "${DB_TYPE}",
      "DATACLOUD_DB_USER": "${DB_USER}",
      "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}",
      "OPENCLAW_STATE_DIR": "/by/.openclaw",
      "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}",
      "DATACLOUD_DB_DATABASE": "${DB_DATABASE}",
      "DATACLOUD_DB_PASSWORD": "${DB_PASS}",
      "GBRAIN_EMBEDDING_MODEL": "openai:text-embedding-v4",
      "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}",
      "GBRAIN_EMBEDDING_DIMENSIONS": "1024",
      "BYCLAW_SANDBOX_FILE_VOLUME_ROOT": "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
    },
    "image": "${IMAGE_OPENCLAW}",
    "ports": [
      {"port": 8080, "instance": "openclaw", "protocol": "http"},
      {"port": 8081, "instance": "vnc", "protocol": "http"},
      {"port": 8082, "instance": "filebrowser", "protocol": "http"},
      {"port": 9222, "protocol": "http"}
    ],
    "startup": {"entrypoint": ["/usr/local/bin/startAll.sh"]},
    "volumes": [
      {
        "key": "base",
        "scope": "PRIVATE",
        "subPath": "byclaw-${user_code}/by",
        "hostPath": "${FILE_STORAGE_LOCAL_PATH}",
        "readOnly": false,
        "mountPath": "/by"
      }
    ],
    "bootstrap": {"copyTemplate": {"copyIfMissing": true, "targetVolumeKey": "base"}},
    "sandboxType": "byclaw",
    "servicePort": 8080,
    "resourceLimits": {"cpu": "2", "memory": "4Gi"}
  }',
  COALESCE(
    (SELECT template_json FROM "byai"."sandbox_service_spec" WHERE service_key = 'openclaw'),
    '{}'
  ),
  CURRENT_TIMESTAMP
)
ON CONFLICT (service_key) DO UPDATE SET
  service_type = EXCLUDED.service_type,
  display_name = EXCLUDED.display_name,
  enabled = EXCLUDED.enabled,
  default_profile_key = EXCLUDED.default_profile_key,
  autoscale_enabled = EXCLUDED.autoscale_enabled,
  spec_json = EXCLUDED.spec_json,
  updated_at = CURRENT_TIMESTAMP;
  -- template_json 不在冲突时覆盖，避免误删生产自定义配置

INSERT INTO "byai"."sandbox_service_profile" (
  service_type, profile_key, resource_requests, resource_limits,
  resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
VALUES
  ('openclaw', 'xs', '{"cpu":"250m","memory":"765Mi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 10, CURRENT_TIMESTAMP),
  ('openclaw', 's', '{"cpu":"500m","memory":"1Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 20, CURRENT_TIMESTAMP),
  ('openclaw', 'm', '{"cpu":"1","memory":"2Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 30, CURRENT_TIMESTAMP),
  ('openclaw', 'l', '{"cpu":"2","memory":"4Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 40, CURRENT_TIMESTAMP)
ON CONFLICT (service_type, profile_key) DO UPDATE SET
  resource_requests = EXCLUDED.resource_requests,
  resource_limits = EXCLUDED.resource_limits,
  resize_enabled = EXCLUDED.resize_enabled,
  resize_strategy = EXCLUDED.resize_strategy,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order,
  updated_at = CURRENT_TIMESTAMP;

-- 若需同步更新 template_json 中硬编码密钥，请单独审查 langfuse Authorization 等字段后执行：
-- UPDATE "byai"."sandbox_service_spec" SET template_json = ... WHERE service_key = 'openclaw';
