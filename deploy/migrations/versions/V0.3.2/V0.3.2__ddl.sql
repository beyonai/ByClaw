-- V0.3.2 增量 DDL：增加 refresh-aware 连接器凭证生命周期元数据。
-- CLI 管理的 access token、refresh token 仍只保存在用户隔离 native-home，本迁移不保存任何 token 值。
SET search_path TO byai;

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

SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'access_expire_time', 'TIMESTAMP');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'refresh_expire_time', 'TIMESTAMP');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'credential_state', 'VARCHAR(32)');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'renewal_mode', 'VARCHAR(32)');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'last_verified_at', 'TIMESTAMP');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

UPDATE byai.byai_connector_auth
SET access_expire_time = expire_time
WHERE access_expire_time IS NULL
  AND expire_time IS NOT NULL;

UPDATE byai.byai_connector_auth AS auth
SET credential_state = COALESCE(auth.credential_state, 'UNKNOWN'),
    renewal_mode = COALESCE(
        auth.renewal_mode,
        CASE info.provider_code
            WHEN 'dws-dingtalk' THEN 'REFRESH_TOKEN'
            WHEN 'wecom-cli' THEN 'PROBE_ONLY'
            ELSE 'NONE'
        END
    )
FROM byai.byai_connector_info AS info
WHERE info.connector_id = auth.connector_id
  AND (auth.credential_state IS NULL OR auth.renewal_mode IS NULL);

UPDATE byai.byai_connector_auth
SET credential_state = COALESCE(credential_state, 'UNKNOWN'),
    renewal_mode = COALESCE(renewal_mode, 'NONE')
WHERE credential_state IS NULL OR renewal_mode IS NULL;

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN credential_state SET DEFAULT 'UNKNOWN',
    ALTER COLUMN credential_state SET NOT NULL,
    ALTER COLUMN renewal_mode SET DEFAULT 'NONE',
    ALTER COLUMN renewal_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_state
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, credential_state);

COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '兼容字段：当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.access_expire_time IS '当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.refresh_expire_time IS 'refresh token 或等价长期续期能力到期时间，不保存 token 值';
COMMENT ON COLUMN byai.byai_connector_auth.credential_state IS '凭证状态：READY、REFRESH_NEEDED、EXPIRING、REAUTH_REQUIRED、UNKNOWN';
COMMENT ON COLUMN byai.byai_connector_auth.renewal_mode IS '续期模式：REFRESH_TOKEN、CREDENTIAL_REISSUE、PROBE_ONLY、NONE';
COMMENT ON COLUMN byai.byai_connector_auth.last_verified_at IS 'Provider 最近一次权威凭证验证时间';
