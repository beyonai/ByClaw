-- V0.3.2 增量 DML：回填 refresh-aware 连接器凭证生命周期字段。
-- 不保存任何 token 值；仅补全状态与续期模式元数据。
SET search_path TO byai;

UPDATE byai.byai_connector_auth
SET access_expire_time = expire_time
WHERE access_expire_time IS NULL
  AND expire_time IS NOT NULL;

UPDATE byai.byai_connector_auth AS auth
SET credential_state = COALESCE(auth.credential_state, 'UNKNOWN'),
    renewal_mode = CASE info.provider_code
        WHEN 'dws-dingtalk' THEN 'REFRESH_TOKEN'
        WHEN 'lark-cli' THEN 'REFRESH_TOKEN'
        WHEN 'wecom-cli' THEN 'PROBE_ONLY'
        ELSE COALESCE(auth.renewal_mode, 'NONE')
    END
FROM byai.byai_connector_info AS info
WHERE info.connector_id = auth.connector_id
  AND (
      auth.credential_state IS NULL
      OR auth.renewal_mode IS NULL
      OR (info.provider_code IN ('dws-dingtalk', 'lark-cli') AND auth.renewal_mode <> 'REFRESH_TOKEN')
      OR (info.provider_code = 'wecom-cli' AND auth.renewal_mode <> 'PROBE_ONLY')
  );

UPDATE byai.byai_connector_auth
SET credential_state = COALESCE(credential_state, 'UNKNOWN'),
    renewal_mode = COALESCE(renewal_mode, 'NONE')
WHERE credential_state IS NULL OR renewal_mode IS NULL;
