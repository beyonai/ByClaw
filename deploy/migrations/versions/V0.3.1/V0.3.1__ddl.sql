SET search_path TO byai;

-- 连接器基础元信息（平台连接器模板）
CREATE TABLE IF NOT EXISTS byai.byai_connector_info
(
    connector_id   BIGINT       NOT NULL PRIMARY KEY,
    connector_code VARCHAR(64)  NOT NULL,
    connector_name VARCHAR(128) NOT NULL,
    icon_url       VARCHAR(512),
    description    TEXT,
    connector_type VARCHAR(32)  NOT NULL,
    auth_mode      VARCHAR(32),
    auth_config    VARCHAR(4096),
    request_config VARCHAR(4096),
    sort           INT                   DEFAULT 0,
    status_cd      VARCHAR(3)   NOT NULL DEFAULT '00A',
    create_by      VARCHAR(64),
    create_time    TIMESTAMP    NOT NULL DEFAULT NOW(),
    update_time    TIMESTAMP
);

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
COMMENT ON COLUMN byai.byai_connector_info.auth_mode IS '授权方式：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN，允许为空';
COMMENT ON COLUMN byai.byai_connector_info.auth_config IS '连接器通用授权模板配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.request_config IS '连接器公共请求配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.sort IS '前端页面排序权重';
COMMENT ON COLUMN byai.byai_connector_info.status_cd IS '状态编码：00A=有效，00X=无效';
COMMENT ON COLUMN byai.byai_connector_info.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_info.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_info.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';


-- 用户连接器授权绑定记录
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

CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_connector
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, expire_time);

COMMENT ON TABLE byai.byai_connector_auth IS '用户连接器授权绑定记录';
COMMENT ON COLUMN byai.byai_connector_auth.auth_id IS '主键，Long类型授权记录ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_auth.user_id IS '归属用户ID';
COMMENT ON COLUMN byai.byai_connector_auth.connector_id IS '关联byai.byai_connector_info.connector_id';
COMMENT ON COLUMN byai.byai_connector_auth.auth_name IS '用户自定义授权账号别名';
COMMENT ON COLUMN byai.byai_connector_auth.auth_mode IS '授权方式（冗余，与连接器模板保持一致）：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN，允许为空';
COMMENT ON COLUMN byai.byai_connector_auth.auth_credential IS '加密后的授权凭证JSON，禁止明文存储密钥';
COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '凭证过期时间';
COMMENT ON COLUMN byai.byai_connector_auth.enable_flag IS '连接启用标识：Y=开启连接，N=关闭连接，新建默认关闭';
COMMENT ON COLUMN byai.byai_connector_auth.status_cd IS '状态编码：00A=有效，00X=无效（软删除）';
COMMENT ON COLUMN byai.byai_connector_auth.last_sync_time IS '凭证最后同步刷新时间';
COMMENT ON COLUMN byai.byai_connector_auth.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_auth.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_auth.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';
