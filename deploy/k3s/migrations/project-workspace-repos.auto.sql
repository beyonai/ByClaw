-- Keep the project/repository schema compatible with the BE project workspace flow.
-- This file is intentionally idempotent because deploy/k3s/deploy.sh applies all
-- *.auto.sql files on every update, including against an existing database.

ALTER TABLE byai.byai_project ADD COLUMN IF NOT EXISTS init_status VARCHAR(16);
ALTER TABLE byai.byai_project ADD COLUMN IF NOT EXISTS build_index VARCHAR(4) NOT NULL DEFAULT 'N';
ALTER TABLE byai.byai_project ADD COLUMN IF NOT EXISTS index_skills VARCHAR(512);
ALTER TABLE byai.byai_project ADD COLUMN IF NOT EXISTS init_session_id BIGINT;
ALTER TABLE byai.byai_project ADD COLUMN IF NOT EXISTS init_fail_reason VARCHAR(500);

ALTER TABLE byai.byai_project_repo ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE byai.byai_project_repo ADD COLUMN IF NOT EXISTS repo_type VARCHAR(16) NOT NULL DEFAULT 'code';
ALTER TABLE byai.byai_project_repo ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'github';
