-- V0.6.0 数字员工组增量 DDL（OpenGauss）。
-- 数字员工组仍复用 ss_resource / ss_res_ext_dig_employee / ss_resource_version，
-- 成员关系复用 ss_resource_rel_detail，因此无需新增业务表。
SET search_path TO byai;

-- 创建唯一索引前先阻断脏数据，避免静默删除或覆盖用户已有关系。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM byai.ss_resource_rel_detail
        WHERE rel_type_name = 'DIG_EMPLOYEE_GROUP_MEMBER'
          AND rel_status = 1
        GROUP BY resource_id, rel_resource_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate active DIG_EMPLOYEE_GROUP_MEMBER relationships exist';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uk_ss_resource_rel_dig_employee_group_member
    ON byai.ss_resource_rel_detail (resource_id, rel_resource_id)
    WHERE rel_type_name = 'DIG_EMPLOYEE_GROUP_MEMBER' AND rel_status = 1;

CREATE INDEX IF NOT EXISTS idx_ss_resource_version_active_resource
    ON byai.ss_resource_version (resource_id, version_status, resource_version_id);
