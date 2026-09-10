-- V0.5.0 邮箱连接器迁移，内容从 V0.4.1 邮箱迁移复制而来。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='byai' AND table_name='po_user_mail_account' AND column_name='provider_code') THEN
        ALTER TABLE byai.po_user_mail_account ADD COLUMN provider_code VARCHAR(64);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='byai' AND table_name='po_user_mail_account' AND column_name='auth_type') THEN
        ALTER TABLE byai.po_user_mail_account ADD COLUMN auth_type VARCHAR(32);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='byai' AND table_name='po_user_mail_account' AND column_name='credential_ref') THEN
        ALTER TABLE byai.po_user_mail_account ADD COLUMN credential_ref VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='byai' AND table_name='po_user_mail_account' AND column_name='connector_id') THEN
        ALTER TABLE byai.po_user_mail_account ADD COLUMN connector_id BIGINT;
    END IF;
END $$;

ALTER TABLE byai.po_user_mail_account
    ALTER COLUMN imap_host DROP NOT NULL,
    ALTER COLUMN imap_port DROP NOT NULL,
    ALTER COLUMN smtp_host DROP NOT NULL,
    ALTER COLUMN smtp_port DROP NOT NULL;

UPDATE byai.po_user_mail_account
SET provider_code = COALESCE(provider_code, 'custom-imap'),
    auth_type = COALESCE(auth_type, 'APP_PASSWORD')
WHERE delete_flag = '0' AND (provider_code IS NULL OR auth_type IS NULL);

CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_user_provider ON byai.po_user_mail_account (user_id, provider_code, delete_flag);
CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_credential_ref ON byai.po_user_mail_account (credential_ref) WHERE credential_ref IS NOT NULL AND delete_flag = '0';
CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_connector ON byai.po_user_mail_account (user_id, connector_id, delete_flag);
