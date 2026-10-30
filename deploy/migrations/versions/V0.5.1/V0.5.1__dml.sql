-- 只标记尚无逐组织目标的历史更新申请；重跑时不改变新建申请的类型。
UPDATE byai.digital_employee_publication p
SET scope_update = TRUE
WHERE official_id IS NOT NULL AND status IN ('DRAFT', 'PENDING', 'APPLYING', 'FAILED', 'REJECTED', 'WITHDRAWN')
  AND scope_update = FALSE
  AND NOT EXISTS (
      SELECT 1 FROM byai.digital_employee_publication_target t
      WHERE t.tenant_id = p.tenant_id AND t.request_id = p.request_id
  );

-- 历史发布均保留全公司范围；仅登记历史语义，不扩大或重写既有授权名单。
INSERT INTO byai.digital_employee_publication_target
    (target_id, tenant_id, request_id, org_id, org_name, status, revision,
     reviewer_id, reviewer_name, reviewed_at, comment, created_at)
SELECT p.request_id, p.tenant_id, p.request_id, -1, '全公司',
       CASE WHEN p.status = 'PUBLISHED' THEN 'APPROVED'
            WHEN p.status = 'REJECTED' THEN 'REJECTED' ELSE 'PENDING' END,
       0, p.reviewer_id, p.reviewer_name, p.reviewed_at, p.comment, p.created_at
FROM byai.digital_employee_publication p
WHERE NOT EXISTS (
    SELECT 1 FROM byai.digital_employee_publication_target t
    WHERE t.tenant_id = p.tenant_id AND t.request_id = p.request_id
);

INSERT INTO byai.digital_employee_publish_scope (scope_id, tenant_id, resource_id, org_id, request_id, created_at)
SELECT r.resource_id, r.com_acct_id, r.resource_id, -1, r.publication_request_id,
       COALESCE(r.publish_time, r.create_time, CURRENT_TIMESTAMP)
FROM byai.ss_resource r
WHERE r.resource_biz_type = 'DIG_EMPLOYEE' AND r.owner_type = 'enterprise'
  AND r.com_acct_id IS NOT NULL AND r.publication_source_id IS NOT NULL
  AND r.resource_id != r.publication_source_id
  AND NOT EXISTS (
      SELECT 1 FROM byai.digital_employee_publish_scope s
      WHERE s.tenant_id = r.com_acct_id AND s.resource_id = r.resource_id
  );
