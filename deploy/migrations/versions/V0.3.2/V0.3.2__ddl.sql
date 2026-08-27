-- V0.3.2 增量 DDL：增加 refresh-aware 连接器凭证生命周期元数据。
-- CLI 管理的 access token、refresh token 仍只保存在用户隔离 native-home，本迁移不保存任何 token 值。
SET search_path TO byai;

-- 补偿部分历史环境未执行 V0.2.0 后续字段扩容的问题；机器人渠道配置为 JSON，可能超过 500 字符。
ALTER TABLE byai.ss_res_ext_dig_employee
    ALTER COLUMN machine_channel TYPE text;

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
SELECT byai.add_column_if_missing(
    'byai', 'byai_connector_auth', 'credential_state',
    'VARCHAR(32) DEFAULT ''UNKNOWN'' NOT NULL'
);
SELECT byai.add_column_if_missing(
    'byai', 'byai_connector_auth', 'renewal_mode',
    'VARCHAR(32) DEFAULT ''NONE'' NOT NULL'
);
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'last_verified_at', 'TIMESTAMP');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN credential_state SET DEFAULT 'UNKNOWN';

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN credential_state SET NOT NULL;

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN renewal_mode SET DEFAULT 'NONE';

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN renewal_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_state
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, credential_state);

COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '兼容字段：当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.access_expire_time IS '当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.refresh_expire_time IS 'refresh token 或等价长期续期能力到期时间，不保存 token 值';
COMMENT ON COLUMN byai.byai_connector_auth.credential_state IS '凭证状态：READY、REFRESH_NEEDED、EXPIRING、REAUTH_REQUIRED、UNKNOWN';
COMMENT ON COLUMN byai.byai_connector_auth.renewal_mode IS '续期模式：REFRESH_TOKEN、CREDENTIAL_REISSUE、PROBE_ONLY、NONE';
COMMENT ON COLUMN byai.byai_connector_auth.last_verified_at IS 'Provider 最近一次权威凭证验证时间';

-- 钉钉外部用户绑定去重，并保证同一来源、同一 union_id 只有一条绑定记录。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM byai.po_user_external_system
        WHERE union_id IS NOT NULL
          AND btrim(union_id) <> ''
        GROUP BY source_type, union_id
        HAVING COUNT(DISTINCT COALESCE(user_id::text, '<null>')) > 1
    ) THEN
        RAISE EXCEPTION
            'Conflicting po_user_external_system bindings must be reviewed before adding the unique index';
    END IF;

    DELETE FROM byai.po_user_external_system AS binding
    USING (
        SELECT ctid,
               ROW_NUMBER() OVER (
                   PARTITION BY source_type, union_id, user_id
                   ORDER BY binding_time DESC NULLS LAST, id DESC NULLS LAST
               ) AS duplicate_rank
        FROM byai.po_user_external_system
        WHERE union_id IS NOT NULL
          AND btrim(union_id) <> ''
    ) AS duplicate
    WHERE binding.ctid = duplicate.ctid
      AND duplicate.duplicate_rank > 1;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_external_system_source_union
    ON byai.po_user_external_system (source_type, union_id)
    WHERE union_id IS NOT NULL AND btrim(union_id) <> '';
