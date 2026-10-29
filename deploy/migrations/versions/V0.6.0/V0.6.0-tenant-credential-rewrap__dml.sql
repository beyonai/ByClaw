-- Opt-in offline credential rewrap; ordinary release execution is a no-op.
-- The operator decrypts with the recovered old key and re-encrypts the SAME password
-- with TenantRuntimeIdentity. Never place keys, tokens or credential payloads in this file.
-- In one transaction set application_name=byclaw-tenant-credential-rewrap and
-- byclaw.tenant_rewrap_payload to a JSON array with id, envelope, nextEnvelope,
-- oldVersion, nextVersion. Hold existing tenant provisioning leases throughout.
-- Require exactly two updated rows per tenant before commit; otherwise roll back.
-- Then CAS only DB_PASSWORD / DB_CREDENTIAL_VERSION in each TENANT_CONFIG hash.
-- Preserve private rollback evidence; deploy the new BE and recreate existing Nodes.
WITH payload AS (
    SELECT item
    FROM jsonb_array_elements(
        CASE WHEN current_setting('application_name')='byclaw-tenant-credential-rewrap'
             THEN current_setting('byclaw.tenant_rewrap_payload')::jsonb
             ELSE '[]'::jsonb END
    ) AS entries(item)
), eligible AS (
    SELECT p.item, old_password.enterprise_id
    FROM payload p
    JOIN byai.tenant_config old_password
      ON old_password.enterprise_id=(p.item->>'id')::bigint
     AND old_password.params_code='DB_PASSWORD'
     AND old_password.params_value=(p.item->>'envelope')
    JOIN byai.tenant_config old_version
      ON old_version.enterprise_id=old_password.enterprise_id
     AND old_version.params_code='DB_CREDENTIAL_VERSION'
     AND old_version.params_value=(p.item->>'oldVersion')
    JOIN byai.tenant_config state
      ON state.enterprise_id=old_password.enterprise_id
     AND state.params_code='PROVISION_STATE'
     AND state.params_value::jsonb->>'status'='READY'
    WHERE (p.item->>'nextVersion')::bigint=(p.item->>'oldVersion')::bigint+1
      AND (p.item->>'nextEnvelope') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM byai.internal_command cmd
          WHERE cmd.enterprise_id=old_password.enterprise_id AND cmd.status NOT IN ('SUCCEEDED','FAILED'))
      AND NOT EXISTS (SELECT 1 FROM byai.tenant_runtime_operation op
          WHERE op.enterprise_id=old_password.enterprise_id
            AND (op.state<>'IDLE' OR op.active_command_id IS NOT NULL))
)
UPDATE byai.tenant_config target
SET params_value=CASE target.params_code
        WHEN 'DB_PASSWORD' THEN (eligible.item->>'nextEnvelope')
        ELSE (eligible.item->>'nextVersion') END,
    params_version=target.params_version+1,
    updated_at=CURRENT_TIMESTAMP
FROM eligible
WHERE target.enterprise_id=eligible.enterprise_id
  AND ((target.params_code='DB_PASSWORD' AND target.params_value=(eligible.item->>'envelope'))
    OR (target.params_code='DB_CREDENTIAL_VERSION' AND target.params_value=(eligible.item->>'oldVersion')));
