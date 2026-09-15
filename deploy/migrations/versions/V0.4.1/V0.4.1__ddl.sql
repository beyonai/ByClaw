
ALTER TABLE byai.po_user_mail_account
    ALTER COLUMN imap_host DROP NOT NULL,
    ALTER COLUMN imap_port DROP NOT NULL,
    ALTER COLUMN smtp_host DROP NOT NULL,
    ALTER COLUMN smtp_port DROP NOT NULL;

UPDATE byai.po_user_mail_account
SET provider_code = COALESCE(provider_code, 'custom-imap'),
    auth_type = COALESCE(auth_type, 'APP_PASSWORD')
WHERE delete_flag = '0' AND (provider_code IS NULL OR auth_type IS NULL);

CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_user_provider
    ON byai.po_user_mail_account (user_id, provider_code, delete_flag);
CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_credential_ref
    ON byai.po_user_mail_account (credential_ref)
    WHERE credential_ref IS NOT NULL AND delete_flag = '0';
CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_connector
    ON byai.po_user_mail_account (user_id, connector_id, delete_flag);

-- Reusable project data sources. Release administrator owns the initdb merge.
CREATE TABLE IF NOT EXISTS byai.byai_datasource (
    datasource_id BIGINT PRIMARY KEY,
    datasource_name VARCHAR(128) NOT NULL,
    description VARCHAR(2000),
    datasource_type VARCHAR(32) NOT NULL,
    connection_config TEXT NOT NULL,
    password_cipher TEXT NOT NULL,
    create_by BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT NOT NULL,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS byai.byai_project_datasource (
    project_id BIGINT NOT NULL,
    datasource_id BIGINT NOT NULL,
    create_by BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, datasource_id)
);
CREATE INDEX IF NOT EXISTS idx_project_datasource_source ON byai.byai_project_datasource (datasource_id);
COMMENT ON TABLE byai.byai_datasource IS 'Reusable data source configuration with encrypted credentials';
COMMENT ON COLUMN byai.byai_datasource.datasource_type IS 'Configuration provider key, initially opengauss';
COMMENT ON COLUMN byai.byai_datasource.connection_config IS 'Provider-validated non-secret JSON configuration';
COMMENT ON TABLE byai.byai_project_datasource IS 'Many-to-many project to data source bindings';
