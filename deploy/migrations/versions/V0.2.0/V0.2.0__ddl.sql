-- 个人中心-个人邮箱账号表
-- 用于保存当前用户的多个邮箱账号配置；授权码只保存加密值，接口不返回明文。
CREATE TABLE IF NOT EXISTS byai.po_user_mail_account (
    account_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    account_name VARCHAR(64) NOT NULL,
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(128),
    default_flag CHAR(1) NOT NULL DEFAULT 'N',
    imap_host VARCHAR(255) NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_encryption VARCHAR(16) NOT NULL,
    smtp_host VARCHAR(255) NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_encryption VARCHAR(16) NOT NULL,
    auth_code_cipher TEXT,
    auth_code_last4 VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    last_check_time TIMESTAMP,
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
    );



COMMENT ON TABLE byai.po_user_mail_account IS '个人中心-个人邮箱账号表';


COMMENT ON COLUMN byai.po_user_mail_account.account_id IS '邮箱账号主键ID';


COMMENT ON COLUMN byai.po_user_mail_account.user_id IS '所属用户ID';


COMMENT ON COLUMN byai.po_user_mail_account.account_name IS '邮箱账号名称，如QQ邮箱、Gmail';


COMMENT ON COLUMN byai.po_user_mail_account.email IS '邮箱地址';


COMMENT ON COLUMN byai.po_user_mail_account.display_name IS '发件展示名称';


COMMENT ON COLUMN byai.po_user_mail_account.default_flag IS '是否默认邮箱账号，Y是，N否';


COMMENT ON COLUMN byai.po_user_mail_account.imap_host IS 'IMAP服务器地址';


COMMENT ON COLUMN byai.po_user_mail_account.imap_port IS 'IMAP服务器端口';


COMMENT ON COLUMN byai.po_user_mail_account.imap_encryption IS 'IMAP加密方式，如tls、ssl、starttls、none';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_host IS 'SMTP服务器地址';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_port IS 'SMTP服务器端口';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_encryption IS 'SMTP加密方式，如tls、ssl、starttls、none';


COMMENT ON COLUMN byai.po_user_mail_account.auth_code_cipher IS '邮箱授权码密文';


COMMENT ON COLUMN byai.po_user_mail_account.auth_code_last4 IS '邮箱授权码后四位，用于前端提示';


COMMENT ON COLUMN byai.po_user_mail_account.status IS '账号状态，NORMAL正常';


COMMENT ON COLUMN byai.po_user_mail_account.last_check_time IS '最近一次连通性检查时间，当前阶段预留';


COMMENT ON COLUMN byai.po_user_mail_account.create_by IS '创建人ID';


COMMENT ON COLUMN byai.po_user_mail_account.create_time IS '创建时间';


COMMENT ON COLUMN byai.po_user_mail_account.update_by IS '更新人ID';


COMMENT ON COLUMN byai.po_user_mail_account.update_time IS '更新时间';


COMMENT ON COLUMN byai.po_user_mail_account.delete_flag IS '逻辑删除标识，0未删除，1已删除';



CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_user
    ON byai.po_user_mail_account (user_id, delete_flag, update_time DESC);



CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_mail_account_default
    ON byai.po_user_mail_account (user_id)
    WHERE default_flag = 'Y' AND delete_flag = '0';



-- 删除生态采集不用的库表脚本（功能代码已经删掉）
DROP TABLE IF EXISTS byai.bykc_ec_import_record CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact_signal CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run_step CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_task CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connection CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_collector_agent CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connector CASCADE;

ALTER TABLE byai.byai_aimodel ADD COLUMN model_protocol VARCHAR(64) DEFAULT null;

