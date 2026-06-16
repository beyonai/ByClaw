-- OpenClaw sandbox_service_spec 从 Docker/minio-mount 升级到 K3s/Longhorn 兼容
-- 基于 docs/reports/openclaw.sql，去掉 minio 残留、参数化镜像与密钥
-- 执行前请替换占位环境变量；幂等：兼容 OpenGauss

CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
  p_schema_name TEXT,
  p_table_name TEXT,
  p_column_name TEXT,
  p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = p_schema_name
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
      || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'service_type', 'VARCHAR(128)');
SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'display_name', 'VARCHAR(128)');
SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'enabled', 'INTEGER DEFAULT 1');
SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'default_profile_key', 'VARCHAR(64)');
SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'autoscale_enabled', 'INTEGER DEFAULT 0');

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

UPDATE "byai"."sandbox_service_spec"
SET service_type = 'openclaw',
  display_name = 'OpenClaw',
  enabled = 1,
  default_profile_key = 'xs',
  autoscale_enabled = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE service_key = 'openclaw';
-- spec_json/template_json 不在更新时覆盖，避免用未渲染占位符误删生产自定义配置

INSERT INTO "byai"."sandbox_service_spec" ("service_key", "service_type", "display_name", "enabled", "default_profile_key", "autoscale_enabled", "spec_json", "template_json", "updated_at")
SELECT
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
      "LANGUAGE": "zh-CN",
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
      "OPENCLAW_LANGUAGE": "zh-CN",
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
      "FILEBROWSER_ROOT": "/by",
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
  '{}',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "byai"."sandbox_service_spec" WHERE service_key = 'openclaw');

UPDATE "byai"."sandbox_service_profile"
SET resource_requests = '{"cpu":"250m","memory":"765Mi"}'::jsonb,
  resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
  resize_enabled = 1,
  resize_strategy = 'IN_PLACE',
  enabled = 1,
  sort_order = 10,
  updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'xs';
INSERT INTO "byai"."sandbox_service_profile" (
  service_type, profile_key, resource_requests, resource_limits,
  resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'xs', '{"cpu":"250m","memory":"765Mi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 10, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "byai"."sandbox_service_profile" WHERE service_type = 'openclaw' AND profile_key = 'xs');

UPDATE "byai"."sandbox_service_profile"
SET resource_requests = '{"cpu":"500m","memory":"1Gi"}'::jsonb,
  resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
  resize_enabled = 1,
  resize_strategy = 'IN_PLACE',
  enabled = 1,
  sort_order = 20,
  updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 's';
INSERT INTO "byai"."sandbox_service_profile" (
  service_type, profile_key, resource_requests, resource_limits,
  resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 's', '{"cpu":"500m","memory":"1Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 20, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "byai"."sandbox_service_profile" WHERE service_type = 'openclaw' AND profile_key = 's');

UPDATE "byai"."sandbox_service_profile"
SET resource_requests = '{"cpu":"1","memory":"2Gi"}'::jsonb,
  resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
  resize_enabled = 1,
  resize_strategy = 'IN_PLACE',
  enabled = 1,
  sort_order = 30,
  updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'm';
INSERT INTO "byai"."sandbox_service_profile" (
  service_type, profile_key, resource_requests, resource_limits,
  resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'm', '{"cpu":"1","memory":"2Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 30, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "byai"."sandbox_service_profile" WHERE service_type = 'openclaw' AND profile_key = 'm');

UPDATE "byai"."sandbox_service_profile"
SET resource_requests = '{"cpu":"2","memory":"4Gi"}'::jsonb,
  resource_limits = '{"cpu":"2","memory":"4Gi"}'::jsonb,
  resize_enabled = 1,
  resize_strategy = 'IN_PLACE',
  enabled = 1,
  sort_order = 40,
  updated_at = CURRENT_TIMESTAMP
WHERE service_type = 'openclaw' AND profile_key = 'l';
INSERT INTO "byai"."sandbox_service_profile" (
  service_type, profile_key, resource_requests, resource_limits,
  resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
SELECT 'openclaw', 'l', '{"cpu":"2","memory":"4Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 40, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "byai"."sandbox_service_profile" WHERE service_type = 'openclaw' AND profile_key = 'l');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 若需同步更新 template_json 中硬编码密钥，请单独审查 langfuse Authorization 等字段后执行：
-- UPDATE "byai"."sandbox_service_spec" SET template_json = ... WHERE service_key = 'openclaw';
