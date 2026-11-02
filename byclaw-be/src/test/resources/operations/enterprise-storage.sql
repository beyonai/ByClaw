CREATE SCHEMA byai;
CREATE TABLE byai.byai_project (
    project_id BIGINT PRIMARY KEY, project_name VARCHAR(100), cloud_resource_id BIGINT,
    enterprise_id BIGINT, project_type VARCHAR(32), delete_flag VARCHAR(1)
);
CREATE TABLE byai.ss_resource (resource_id BIGINT PRIMARY KEY, resource_code VARCHAR(100), resource_biz_type VARCHAR(32) DEFAULT 'KG_CLOUD');
CREATE TABLE byai.byai_session (
    session_id BIGINT PRIMARY KEY, project_id BIGINT, enterprise_id BIGINT,
    session_type VARCHAR(32), state VARCHAR(32)
);
CREATE TABLE byai.po_users (user_id BIGINT PRIMARY KEY, user_code VARCHAR(64), state VARCHAR(1), is_locked VARCHAR(1));
CREATE TABLE byai.tenant_user_membership (user_id BIGINT, enterprise_id BIGINT, status VARCHAR(16));

-- HACU 项目无需共享库会话，兼容 Node；历史普通项目仅通过本企业 hs_as 关联纳入。
INSERT INTO byai.byai_project VALUES
    (1, 'Node workgroup', 101, 42, 'hacu', '0'),
    (2, 'Retained dissolved workgroup', 102, 42, 'hacu', '0'),
    (3, 'Other enterprise', 103, 43, 'hacu', '0'),
    (4, 'Deleted project', 104, 42, 'hacu', '1'),
    (5, 'Ordinary project', 105, 42, 'normal', '0'),
    (6, 'Legacy workgroup', 106, 42, 'normal', NULL),
    (7, 'Wrong enterprise session', 107, 42, 'normal', '0'),
    (8, 'Missing resource binding', 108, 42, 'hacu', '0');
INSERT INTO byai.ss_resource(resource_id,resource_code) VALUES (101,'a'),(102,'b'),(103,'c'),(104,'d'),(105,'e'),(106,'f'),(107,'g');
INSERT INTO byai.byai_session VALUES
    (22,2,42,'hs_as','GROUP_DISSOLVED'),(26,6,42,'hs_as','ACTIVE'),(27,7,43,'hs_as','ACTIVE');
INSERT INTO byai.po_users VALUES (7,'member','A','N'),(8,'disabled','X','N'),(9,'removed','A','N'),(10,'adminvip','A','N');
INSERT INTO byai.tenant_user_membership VALUES (7,42,'ACTIVE'),(8,42,'ACTIVE'),(9,42,'DISABLED');

-- 大小写锁定标记均拒绝，不以有效企业关系绕过账号锁定。
INSERT INTO byai.po_users VALUES (11,'locked-upper','A','Y'),(12,'locked-lower','A','y');
INSERT INTO byai.tenant_user_membership VALUES (11,42,'ACTIVE'),(12,42,'ACTIVE');

CREATE TABLE byai.tenant_config (enterprise_id BIGINT, params_code VARCHAR(64), params_value VARCHAR(128));
INSERT INTO byai.tenant_config VALUES (42,'COMMERCIAL_MANAGED','true');
