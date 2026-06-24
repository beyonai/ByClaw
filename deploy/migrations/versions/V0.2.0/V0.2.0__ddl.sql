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

-- 技能扩展表
CREATE TABLE byai.ss_res_ext_skill (
    resource_id int8 NOT NULL,
    skill_type varchar(32) NOT NULL DEFAULT 'hub',
    source_type varchar(64) NOT NULL,
    version varchar(50) NOT NULL DEFAULT 'v0.1',
    skill_url varchar(500) ,
    skill_package_format varchar(32) NOT NULL DEFAULT 'zip',
    skill_original_filename varchar(255),
    skill_package_size int8,
    skill_package_hash varchar(128),
    target_content text,
    sync_status varchar(32),
    sync_error text,
    last_sync_time timestamp,
    CONSTRAINT pk_ss_res_ext_skill PRIMARY KEY (resource_id)
);

COMMENT ON TABLE byai.ss_res_ext_skill IS '技能资源扩展表';
COMMENT ON COLUMN byai.ss_res_ext_skill.resource_id IS '资源ID，关联 byai.ss_resource.resource_id';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_type IS '技能类型：hub=来自个人技能/企业技能管理的技能，inner=系统内置技能';
COMMENT ON COLUMN byai.ss_res_ext_skill.source_type IS '技能来源类型：SYSTEM_BUILTIN=系统内置，SKILL_MANAGE_IMPORT=技能管理导入，CHAT_UPLOAD=对话框技能上传，FILE_MANAGE_UPLOAD=文件管理上传';
COMMENT ON COLUMN byai.ss_res_ext_skill.version IS '技能版本号，初始值v0.1，每次有效变更自动递增，如v0.2';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_url IS '技能压缩包在MinIO/对象存储中的内部路径(object key)，非外部下载URL';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_format IS '技能压缩包格式，当前固定为zip';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_original_filename IS '技能压缩包上传时的原始文件名';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_size IS '技能压缩包大小，单位字节';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_hash IS '技能压缩包内容哈希，用于重复上传、变更识别或审计';
COMMENT ON COLUMN byai.ss_res_ext_skill.target_content IS '技能资源JSON内容，包含ss_resource基础字段和ss_res_ext_skill扩展字段，用于同步给下游运行环境';
COMMENT ON COLUMN byai.ss_res_ext_skill.sync_status IS '同步状态：PENDING=待同步，SUCCESS=同步成功，FAILED=同步失败';
COMMENT ON COLUMN byai.ss_res_ext_skill.sync_error IS '最近一次同步失败原因';
COMMENT ON COLUMN byai.ss_res_ext_skill.last_sync_time IS '最近一次同步时间';

CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.add_column_if_missing('byai', 'ss_sandbox_resize_record', 'idempotency_key', 'VARCHAR(512)');
SELECT byai.add_column_if_missing('byai', 'ss_sandbox_resize_record', 'skip_reason', 'TEXT');

CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_idempotency
    ON byai.ss_sandbox_resize_record (idempotency_key, started_at DESC);

COMMENT ON COLUMN byai.ss_sandbox_resize_record.idempotency_key IS '扩缩容动作幂等键';
COMMENT ON COLUMN byai.ss_sandbox_resize_record.skip_reason IS '扩缩容动作跳过原因';

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 个人中心-个人参数配置表
-- 数据库保存密文，Redis 同步运行期明文缓存，供外部按用户 key 读取。
CREATE TABLE IF NOT EXISTS byai.po_user_private_param (
    param_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    param_key VARCHAR(128) NOT NULL,
    param_value_cipher TEXT NOT NULL,
    param_value_last4 VARCHAR(16),
    description VARCHAR(512),
    status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
);

COMMENT ON TABLE byai.po_user_private_param IS '个人中心-个人参数配置表';
COMMENT ON COLUMN byai.po_user_private_param.param_id IS '个人参数主键ID';
COMMENT ON COLUMN byai.po_user_private_param.user_id IS '所属用户ID';
COMMENT ON COLUMN byai.po_user_private_param.param_key IS '参数名，环境变量格式';
COMMENT ON COLUMN byai.po_user_private_param.param_value_cipher IS '参数值密文';
COMMENT ON COLUMN byai.po_user_private_param.param_value_last4 IS '参数值后四位，用于前端提示';
COMMENT ON COLUMN byai.po_user_private_param.description IS '参数说明';
COMMENT ON COLUMN byai.po_user_private_param.status IS '参数状态，NORMAL正常，DISABLED停用';
COMMENT ON COLUMN byai.po_user_private_param.create_by IS '创建人ID';
COMMENT ON COLUMN byai.po_user_private_param.create_time IS '创建时间';
COMMENT ON COLUMN byai.po_user_private_param.update_by IS '更新人ID';
COMMENT ON COLUMN byai.po_user_private_param.update_time IS '更新时间';
COMMENT ON COLUMN byai.po_user_private_param.delete_flag IS '逻辑删除标识，0未删除，1已删除';

CREATE INDEX IF NOT EXISTS idx_po_user_private_param_user
    ON byai.po_user_private_param (user_id, delete_flag, update_time DESC);

CREATE INDEX IF NOT EXISTS idx_po_user_private_param_status
    ON byai.po_user_private_param (user_id, delete_flag, status, update_time DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_key
    ON byai.po_user_private_param (user_id, param_key)
    WHERE delete_flag = '0';

-- 沙箱健康检测-水位模型配置表
CREATE TABLE IF NOT EXISTS byai.sandbox_health_watermark_model (
    id BIGSERIAL PRIMARY KEY,
    model_name VARCHAR(128) NOT NULL,
    service_type VARCHAR(64) NOT NULL,
    profile_key VARCHAR(64),
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    idle_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    busy_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    critical_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    busy_cpu_request_ratio NUMERIC(8,4) NOT NULL,
    critical_cpu_request_ratio NUMERIC(8,4) NOT NULL,
    consecutive_busy_samples INTEGER NOT NULL DEFAULT 2,
    recover_samples INTEGER NOT NULL DEFAULT 2,
    sample_interval_seconds INTEGER NOT NULL DEFAULT 30,
    snapshot_ttl_seconds INTEGER NOT NULL DEFAULT 120,
    watch_ttl_seconds INTEGER NOT NULL DEFAULT 90,
    remark VARCHAR(512),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE byai.sandbox_health_watermark_model IS '沙箱健康检测-水位模型配置表';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.id IS '主键ID';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.model_name IS '水位模型名称';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.service_type IS '沙箱服务类型，例如openclaw；default表示兜底模型';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.profile_key IS '沙箱规格Key，例如xs/s/m/l；为空表示服务类型默认模型';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.enabled IS '是否启用，1启用，0停用';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.priority IS '匹配优先级，同一匹配范围内数值越大优先级越高';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.idle_memory_limit_ratio IS '空闲内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.busy_memory_limit_ratio IS '繁忙内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.critical_memory_limit_ratio IS '阻断内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.busy_cpu_request_ratio IS '繁忙CPU request水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.critical_cpu_request_ratio IS '阻断CPU request水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.consecutive_busy_samples IS '连续繁忙采样次数';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.recover_samples IS '连续恢复采样次数';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.sample_interval_seconds IS '采样周期，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.snapshot_ttl_seconds IS '健康快照Redis TTL，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.watch_ttl_seconds IS '健康检测watch Redis TTL，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.remark IS '备注';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.created_at IS '创建时间';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS uk_sandbox_health_watermark_enabled
    ON byai.sandbox_health_watermark_model (service_type, COALESCE(profile_key, ''))
    WHERE enabled = 1;

CREATE INDEX IF NOT EXISTS idx_sandbox_health_watermark_scope
    ON byai.sandbox_health_watermark_model (service_type, profile_key, enabled, priority DESC);

alter table byai.ss_res_ext_dig_employee alter column tag_name type varchar(255);
