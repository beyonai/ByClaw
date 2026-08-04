-- V0.3.1 增量 DDL：为已有环境增加连接器授权、Runtime Manifest 和系统托管参数快照结构。
-- 所有新增表、字段、约束和索引均采用幂等方式，支持升级脚本安全重放。
SET search_path TO byai;

-- 连接器基础元信息：保存平台级连接器模板；runtime_manifest 在后续兼容字段块中幂等补充。
CREATE TABLE IF NOT EXISTS byai.byai_connector_info
(
    connector_id   BIGINT       NOT NULL PRIMARY KEY,
    connector_code VARCHAR(64)  NOT NULL,
    connector_name VARCHAR(128) NOT NULL,
    icon_url       VARCHAR(512),
    description    TEXT,
    connector_type VARCHAR(32)  NOT NULL,
    provider_code  VARCHAR(64),
    skill_code     VARCHAR(64),
    auth_mode      VARCHAR(32),
    auth_config    VARCHAR(4096),
    request_config VARCHAR(4096),
    sort           INT                   DEFAULT 0,
    status_cd      VARCHAR(3)   NOT NULL DEFAULT '00A',
    create_by      VARCHAR(64),
    create_time    TIMESTAMP    NOT NULL DEFAULT NOW(),
    update_time    TIMESTAMP
);

-- connector_code 保证平台连接器编码唯一；状态与排序联合索引服务连接器列表查询。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_info_code
    ON byai.byai_connector_info (connector_code);

CREATE INDEX IF NOT EXISTS idx_byai_connector_info_status_sort
    ON byai.byai_connector_info (status_cd, sort, create_time);

COMMENT ON TABLE byai.byai_connector_info IS '连接器基础元信息（平台连接器模板）';
COMMENT ON COLUMN byai.byai_connector_info.connector_id IS '主键，Long类型连接器ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_info.connector_code IS '连接器业务编码，全局唯一';
COMMENT ON COLUMN byai.byai_connector_info.connector_name IS '连接器展示名称';
COMMENT ON COLUMN byai.byai_connector_info.icon_url IS '连接器图标地址';
COMMENT ON COLUMN byai.byai_connector_info.description IS '连接器功能简介';
COMMENT ON COLUMN byai.byai_connector_info.connector_type IS '连接器类型：SYSTEM=系统内置，CUSTOM=自定义连接器';
COMMENT ON COLUMN byai.byai_connector_info.provider_code IS '授权 Provider 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.skill_code IS 'OpenClaw Skill 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.auth_mode IS '授权方式：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_info.auth_config IS '连接器通用授权模板配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.request_config IS '连接器公共请求配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.sort IS '前端页面排序权重';
COMMENT ON COLUMN byai.byai_connector_info.status_cd IS '状态编码：00A=有效，00X=无效';
COMMENT ON COLUMN byai.byai_connector_info.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_info.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_info.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';


-- 用户连接器授权绑定记录：保存连接开关与授权状态，CLI 真实凭证仍存放在用户 native-home。
CREATE TABLE IF NOT EXISTS byai.byai_connector_auth
(
    auth_id         BIGINT      NOT NULL PRIMARY KEY,
    user_id         VARCHAR(64) NOT NULL,
    connector_id    BIGINT      NOT NULL,
    auth_name       VARCHAR(128),
    auth_mode       VARCHAR(32),
    auth_credential TEXT,
    expire_time     TIMESTAMP,
    enable_flag     CHAR(1)     NOT NULL DEFAULT 'N',
    status_cd       VARCHAR(3)  NOT NULL DEFAULT '00A',
    last_sync_time  TIMESTAMP,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP   NOT NULL DEFAULT NOW(),
    update_time     TIMESTAMP
);

-- 为兼容可能已存在的表，外键通过系统目录检查后再创建。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_byai_connector_auth_connector'
    ) THEN
        ALTER TABLE byai.byai_connector_auth
            ADD CONSTRAINT fk_byai_connector_auth_connector
                FOREIGN KEY (connector_id)
                    REFERENCES byai.byai_connector_info (connector_id);
    END IF;
END
$$;

-- 普通索引加速按用户、连接器、状态和有效期查询授权记录。
CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_connector
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, expire_time);

-- 创建有效授权唯一索引前，先按“可用优先、最近更新优先”保留一条记录并软删除其余历史重复项。
WITH ranked_active_authorizations AS (
    SELECT auth_id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, connector_id
                        ORDER BY CASE WHEN enable_flag = 'Y' THEN 0 ELSE 1 END ASC,
                        update_time DESC NULLS LAST,
                        create_time DESC NULLS LAST,
                        auth_id DESC NULLS LAST
           ) AS row_num
    FROM byai.byai_connector_auth
    WHERE status_cd = '00A'
)
UPDATE byai.byai_connector_auth AS duplicate_auth
SET status_cd = '00X',
    enable_flag = 'N',
    update_time = CURRENT_TIMESTAMP
FROM ranked_active_authorizations AS ranked
WHERE duplicate_auth.auth_id = ranked.auth_id
  AND ranked.row_num > 1;

-- 部分唯一索引保证升级后同一用户、同一连接器最多只有一条有效授权记录。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_auth_active_user_connector
    ON byai.byai_connector_auth (user_id, connector_id)
    WHERE status_cd = '00A';

COMMENT ON TABLE byai.byai_connector_auth IS '用户连接器授权绑定记录';
COMMENT ON COLUMN byai.byai_connector_auth.auth_id IS '主键，Long类型授权记录ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_auth.user_id IS '归属用户ID';
COMMENT ON COLUMN byai.byai_connector_auth.connector_id IS '关联byai.byai_connector_info.connector_id';
COMMENT ON COLUMN byai.byai_connector_auth.auth_name IS '用户自定义授权账号别名';
COMMENT ON COLUMN byai.byai_connector_auth.auth_mode IS '授权方式（冗余，与连接器模板保持一致）：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_auth.auth_credential IS '加密后的授权凭证JSON，禁止明文存储密钥';
COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '凭证过期时间';
COMMENT ON COLUMN byai.byai_connector_auth.enable_flag IS '连接启用标识：Y=开启连接，N=关闭连接，新建默认关闭';
COMMENT ON COLUMN byai.byai_connector_auth.status_cd IS '状态编码：00A=有效，00X=无效（软删除）';
COMMENT ON COLUMN byai.byai_connector_auth.last_sync_time IS '凭证最后同步刷新时间';
COMMENT ON COLUMN byai.byai_connector_auth.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_auth.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_auth.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';


-- 连接器 Runtime Manifest 模板与用户系统托管快照字段。
-- 使用临时辅助函数兼容不同历史库结构：字段存在时跳过，不覆盖已有数据。
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

-- 平台连接器保存规范化 Runtime Manifest；用户参数增加来源类型与连接器业务标识。
SELECT byai.add_column_if_missing('byai', 'byai_connector_info', 'runtime_manifest', 'TEXT');
SELECT byai.add_column_if_missing('byai', 'byai_connector_info', 'skill_code', 'VARCHAR(64)');
SELECT byai.add_column_if_missing(
    'byai',
    'po_user_private_param',
    'param_source',
    'VARCHAR(32) NOT NULL DEFAULT ''USER'''
);
SELECT byai.add_column_if_missing('byai', 'po_user_private_param', 'source_ref', 'VARCHAR(128)');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 同一用户、同一连接器可以保存多条环境参数，但同一参数名只能有一条未删除记录。
DROP INDEX IF EXISTS byai.uk_po_user_private_param_connector;
DROP INDEX IF EXISTS byai.uk_po_user_private_param_connector_null_ref;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector
    ON byai.po_user_private_param (user_id, param_source, source_ref, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector_null_ref
    ON byai.po_user_private_param (user_id, param_source, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NULL;

COMMENT ON COLUMN byai.byai_connector_info.runtime_manifest IS '连接器最新 Runtime Manifest 模板，规范化完整 JSON';
COMMENT ON COLUMN byai.po_user_private_param.param_source IS '参数来源：USER用户维护，CONNECTOR系统托管连接器环境参数';
COMMENT ON COLUMN byai.po_user_private_param.source_ref IS '系统托管参数来源业务标识，连接器环境参数使用 connector_code';
