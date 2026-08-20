-- Artifact publication metadata. Object bytes remain in the configured storage backend.
SET search_path TO byai;

CREATE TABLE IF NOT EXISTS byai.byai_artifact (
    artifact_id        VARCHAR(36)    NOT NULL,
    owner_user_id      BIGINT         NOT NULL,
    owner_user_code    VARCHAR(100)   NOT NULL,
    status             VARCHAR(16)    NOT NULL,
    kind               VARCHAR(20),
    storage_type       VARCHAR(32)    NOT NULL,
    storage_root       VARCHAR(500)   NOT NULL,
    storage_prefix     VARCHAR(1000)  NOT NULL,
    original_key       VARCHAR(1200)  NOT NULL,
    content_prefix     VARCHAR(1200)  NOT NULL,
    original_name      VARCHAR(500)   NOT NULL,
    display_name       VARCHAR(500),
    entry_point        VARCHAR(1000),
    content_type       VARCHAR(200),
    file_size          BIGINT         NOT NULL DEFAULT 0,
    expanded_size      BIGINT         NOT NULL DEFAULT 0,
    sha256             VARCHAR(64),
    access_key_hash    VARCHAR(64)    NOT NULL,
    warnings_json      TEXT,
    expires_at         TIMESTAMP      NOT NULL,
    create_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_artifact PRIMARY KEY (artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_owner
    ON byai.byai_artifact (owner_user_id, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_cleanup
    ON byai.byai_artifact (status, expires_at);

COMMENT ON TABLE byai.byai_artifact IS 'Agent Harness发布的限时预览与下载Artifact元数据';
COMMENT ON COLUMN byai.byai_artifact.access_key_hash IS '不记名访问密钥的SHA-256，仅上传响应返回原始密钥';
COMMENT ON COLUMN byai.byai_artifact.storage_type IS '创建时实际使用的存储后端，切换默认后仍用于读取历史Artifact';

-- Add platform-managed general-purpose JSON records for published HTML Artifacts.
CREATE TABLE IF NOT EXISTS byai.artifact_data_record (
    id               VARCHAR(36)   NOT NULL,
    artifact_id      VARCHAR(36)   NOT NULL,
    collection_name  VARCHAR(64)   NOT NULL,
    record_key       VARCHAR(36)   NOT NULL,
    data_json        JSONB         NOT NULL,
    version          INTEGER       NOT NULL DEFAULT 1,
    create_time      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_artifact_data_record PRIMARY KEY (id),
    CONSTRAINT uk_artifact_data_record_key UNIQUE (artifact_id, record_key)
);

CREATE INDEX IF NOT EXISTS idx_artifact_data_record_list
    ON byai.artifact_data_record (artifact_id, collection_name, create_time DESC);

COMMENT ON TABLE byai.artifact_data_record IS '已发布HTML Artifact持久化的通用JSON数据';
