
DROP TABLE IF EXISTS byai.bykc_ec_import_record CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact_signal CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run_step CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_task CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connection CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_collector_agent CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connector CASCADE;

CREATE TABLE IF NOT EXISTS byai.bykc_ec_collector_agent (
                                                            agent_id BIGINT PRIMARY KEY,
                                                            user_id BIGINT NOT NULL,
                                                            agent_name VARCHAR(128) NOT NULL,
    runtime_name VARCHAR(64) NOT NULL DEFAULT 'ByClaw Browser Bridge',
    runtime_version VARCHAR(64),
    browser_bridge_status VARCHAR(32),
    chrome_profile VARCHAR(128),
    site_sessions JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
    last_heartbeat_time TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_connection (
                                                       connection_id BIGINT PRIMARY KEY,
                                                       connector_code VARCHAR(64) NOT NULL,
    owner_type VARCHAR(32) NOT NULL DEFAULT 'PERSONAL',
    auth_type VARCHAR(32) NOT NULL,
    connection_name VARCHAR(128) NOT NULL,
    run_location VARCHAR(32) NOT NULL,
    credential_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    runtime_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    site_sessions JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    last_check_time TIMESTAMP WITH TIME ZONE,
    created_by BIGINT NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_task (
                                                      task_id BIGINT PRIMARY KEY,
                                                      task_name VARCHAR(255) NOT NULL,
    connector_code VARCHAR(64) NOT NULL,
    connection_id BIGINT,
    owner_type VARCHAR(32) NOT NULL DEFAULT 'PERSONAL',
    run_location VARCHAR(32) NOT NULL,
    source_url VARCHAR(2048),
    scope_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    target_type VARCHAR(64) NOT NULL,
    target_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    signal_config JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    schedule_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    schedule_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    next_run_time TIMESTAMP WITH TIME ZONE,
    last_scheduled_run_time TIMESTAMP WITH TIME ZONE,
                                          options JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    created_by BIGINT NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_run (
                                                     run_id BIGINT PRIMARY KEY,
                                                     task_id BIGINT NOT NULL,
                                                     trigger_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    status VARCHAR(32) NOT NULL,
    current_step VARCHAR(64),
    total_count INTEGER NOT NULL DEFAULT 0,
    markdown_count INTEGER NOT NULL DEFAULT 0,
    asset_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    need_action_type VARCHAR(64),
    need_action_payload JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    storage_path VARCHAR(1024),
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_run_step (
                                                          step_id BIGINT PRIMARY KEY,
                                                          run_id BIGINT NOT NULL,
                                                          step_code VARCHAR(64) NOT NULL,
    step_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    message VARCHAR(2048),
    step_order INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_artifact (
                                                     artifact_id BIGINT PRIMARY KEY,
                                                     run_id BIGINT NOT NULL,
                                                     artifact_type VARCHAR(32),
    artifact_name VARCHAR(512),
    source_url VARCHAR(2048),
    title VARCHAR(512),
    markdown_path VARCHAR(1024),
    raw_path VARCHAR(1024),
    asset_dir VARCHAR(1024),
    manifest_path VARCHAR(1024),
    item_count INTEGER NOT NULL DEFAULT 0,
    file_id BIGINT,
    file_url VARCHAR(2048),
    content_type VARCHAR(128),
    file_system_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_artifact_signal (
                                                            signal_id BIGINT PRIMARY KEY,
                                                            artifact_id BIGINT,
                                                            run_id BIGINT NOT NULL,
                                                            signal_type VARCHAR(64) NOT NULL,
    signal_type_name VARCHAR(128),
    signal_code VARCHAR(128) NOT NULL,
    signal_name VARCHAR(255) NOT NULL,
    confidence NUMERIC(5, 4),
    signal_source VARCHAR(32) NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE TABLE IF NOT EXISTS byai.bykc_ec_import_record (
                                                          import_id BIGINT PRIMARY KEY,
                                                          run_id BIGINT NOT NULL,
                                                          artifact_id BIGINT,
                                                          target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128),
    target_path VARCHAR(1024),
    status VARCHAR(32) NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_task_created_by ON byai.bykc_ec_sync_task (created_by);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_connection_created_by ON byai.bykc_ec_connection (created_by);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_connection_connector ON byai.bykc_ec_connection (connector_code);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_task_next_run_time ON byai.bykc_ec_sync_task (status, next_run_time);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_run_task_id ON byai.bykc_ec_sync_run (task_id);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_run_step_run_id ON byai.bykc_ec_sync_run_step (run_id);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_artifact_run_id ON byai.bykc_ec_artifact (run_id);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_artifact_signal_run_id ON byai.bykc_ec_artifact_signal (run_id);
CREATE INDEX IF NOT EXISTS idx_bykc_ec_import_record_run_id ON byai.bykc_ec_import_record (run_id);

COMMENT ON TABLE byai.bykc_ec_collector_agent IS 'ByKC Browser Bridge连接状态表';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.agent_id IS 'Browser Bridge客户端主键';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.user_id IS '所属用户ID';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.agent_name IS 'Browser Bridge客户端名称';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.runtime_name IS 'Browser Bridge运行时名称';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.runtime_version IS 'Browser Bridge版本';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.browser_bridge_status IS 'Browser Bridge连接状态';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.chrome_profile IS '绑定的浏览器Profile标识';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.site_sessions IS 'Browser Bridge上报的目标站点登录态列表，JSON数组';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.status IS 'Browser Bridge在线状态，ONLINE在线，OFFLINE离线';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.last_heartbeat_time IS '最近一次心跳时间';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.create_time IS '创建时间';
COMMENT ON COLUMN byai.bykc_ec_collector_agent.update_time IS '更新时间';

COMMENT ON TABLE byai.bykc_ec_connection IS 'ByKC生态采集用户连接配置表';
COMMENT ON COLUMN byai.bykc_ec_connection.connection_id IS '用户连接主键';
COMMENT ON COLUMN byai.bykc_ec_connection.connector_code IS '运行时生态能力编码，来自OpenCLI manifest或ByClaw Browser Bridge虚拟能力';
COMMENT ON COLUMN byai.bykc_ec_connection.owner_type IS '连接归属类型，PERSONAL个人，ENTERPRISE企业';
COMMENT ON COLUMN byai.bykc_ec_connection.auth_type IS '认证方式，例如BROWSER、TOKEN、OAUTH、IMAP、PUBLIC_URL';
COMMENT ON COLUMN byai.bykc_ec_connection.connection_name IS '用户连接名称';
COMMENT ON COLUMN byai.bykc_ec_connection.run_location IS '连接运行位置，LOCAL用户浏览器桥接侧，SERVER平台侧';
COMMENT ON COLUMN byai.bykc_ec_connection.credential_config IS '连接凭证配置，JSON结构，敏感信息不在查询接口明文返回';
COMMENT ON COLUMN byai.bykc_ec_connection.runtime_config IS '连接运行配置，JSON结构，例如Browser Bridge绑定信息或OpenCLI运行参数';
COMMENT ON COLUMN byai.bykc_ec_connection.site_sessions IS 'Browser Bridge上报的站点登录态状态，JSON数组';
COMMENT ON COLUMN byai.bykc_ec_connection.status IS '连接状态，例如CREATED、READY、NEED_AUTH、FAILED';
COMMENT ON COLUMN byai.bykc_ec_connection.last_check_time IS '最近一次连接检测时间';
COMMENT ON COLUMN byai.bykc_ec_connection.created_by IS '创建用户ID';
COMMENT ON COLUMN byai.bykc_ec_connection.create_time IS '创建时间';
COMMENT ON COLUMN byai.bykc_ec_connection.update_time IS '更新时间';

COMMENT ON TABLE byai.bykc_ec_sync_task IS 'ByKC生态采集同步任务表';
COMMENT ON COLUMN byai.bykc_ec_sync_task.task_id IS '采集任务主键';
COMMENT ON COLUMN byai.bykc_ec_sync_task.task_name IS '采集任务名称';
COMMENT ON COLUMN byai.bykc_ec_sync_task.connector_code IS '运行时生态能力编码';
COMMENT ON COLUMN byai.bykc_ec_sync_task.connection_id IS '用户连接ID，P1连接管理使用';
COMMENT ON COLUMN byai.bykc_ec_sync_task.owner_type IS '任务归属类型，personal个人，enterprise企业';
COMMENT ON COLUMN byai.bykc_ec_sync_task.run_location IS '任务运行位置，LOCAL用户浏览器桥接侧，SERVER平台侧';
COMMENT ON COLUMN byai.bykc_ec_sync_task.source_url IS '采集来源链接';
COMMENT ON COLUMN byai.bykc_ec_sync_task.scope_config IS '采集范围配置，JSON结构';
COMMENT ON COLUMN byai.bykc_ec_sync_task.target_type IS '入库目标类型，例如knowledgeBase、space';
COMMENT ON COLUMN byai.bykc_ec_sync_task.target_config IS '入库目标配置，JSON结构';
COMMENT ON COLUMN byai.bykc_ec_sync_task.signal_config IS '任务级信号配置，JSON数组';
COMMENT ON COLUMN byai.bykc_ec_sync_task.schedule_type IS '调度类型，例如manual手动、once单次、daily每天、weekly每周';
COMMENT ON COLUMN byai.bykc_ec_sync_task.schedule_config IS '调度配置，JSON结构';
COMMENT ON COLUMN byai.bykc_ec_sync_task.next_run_time IS '下一次计划运行时间';
COMMENT ON COLUMN byai.bykc_ec_sync_task.last_scheduled_run_time IS '最近一次计划调度运行时间';
COMMENT ON COLUMN byai.bykc_ec_sync_task.options IS '采集高级选项，JSON结构';
COMMENT ON COLUMN byai.bykc_ec_sync_task.status IS '任务状态，例如CREATED已创建、RUNNING运行中、SUCCESS成功、FAILED失败、DISABLED停用、ARCHIVED归档';
COMMENT ON COLUMN byai.bykc_ec_sync_task.created_by IS '创建用户ID';
COMMENT ON COLUMN byai.bykc_ec_sync_task.create_time IS '创建时间';
COMMENT ON COLUMN byai.bykc_ec_sync_task.update_time IS '更新时间';

COMMENT ON TABLE byai.bykc_ec_sync_run IS 'ByKC生态采集运行记录表';
COMMENT ON COLUMN byai.bykc_ec_sync_run.run_id IS '采集运行主键';
COMMENT ON COLUMN byai.bykc_ec_sync_run.task_id IS '所属采集任务ID';
COMMENT ON COLUMN byai.bykc_ec_sync_run.trigger_type IS '触发方式，例如MANUAL手动、SCHEDULED计划调度、RETRY重试、SKILL技能入口、CHAT聊天入口';
COMMENT ON COLUMN byai.bykc_ec_sync_run.status IS '运行状态，例如SUCCESS成功、FAILED失败、RUNNING运行中、SKIPPED已跳过';
COMMENT ON COLUMN byai.bykc_ec_sync_run.current_step IS '当前运行步骤编码';
COMMENT ON COLUMN byai.bykc_ec_sync_run.total_count IS '采集条目总数';
COMMENT ON COLUMN byai.bykc_ec_sync_run.markdown_count IS '生成Markdown文件数量';
COMMENT ON COLUMN byai.bykc_ec_sync_run.asset_count IS '归档附件数量';
COMMENT ON COLUMN byai.bykc_ec_sync_run.failed_count IS '失败条目数量';
COMMENT ON COLUMN byai.bykc_ec_sync_run.need_action_type IS '需要用户处理的动作类型，例如BROWSER_BRIDGE、USER_BROWSER_BRIDGE_WAITING';
COMMENT ON COLUMN byai.bykc_ec_sync_run.need_action_payload IS '需要用户处理的动作详情，JSON结构';
COMMENT ON COLUMN byai.bykc_ec_sync_run.storage_path IS '本次采集产物对象存储基础路径';
COMMENT ON COLUMN byai.bykc_ec_sync_run.started_at IS '运行开始时间';
COMMENT ON COLUMN byai.bykc_ec_sync_run.finished_at IS '运行结束时间';
COMMENT ON COLUMN byai.bykc_ec_sync_run.create_time IS '创建时间';

COMMENT ON TABLE byai.bykc_ec_sync_run_step IS 'ByKC生态采集运行步骤表';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_id IS '运行步骤主键';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.run_id IS '所属采集运行ID';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_code IS '步骤编码';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_name IS '步骤名称';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.status IS '步骤状态，例如SUCCESS、FAILED、SKIPPED、CREATED';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.message IS '步骤执行说明';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_order IS '步骤排序';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.started_at IS '步骤开始时间';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.finished_at IS '步骤结束时间';
COMMENT ON COLUMN byai.bykc_ec_sync_run_step.create_time IS '创建时间';

COMMENT ON TABLE byai.bykc_ec_artifact IS 'ByKC生态采集产物表';
COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_id IS '采集产物主键';
COMMENT ON COLUMN byai.bykc_ec_artifact.run_id IS '所属采集运行ID';
COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_type IS '产物类型，例如MARKDOWN、RAW、ASSET、MANIFEST';
COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_name IS '产物名称';
COMMENT ON COLUMN byai.bykc_ec_artifact.source_url IS '来源站点链接';
COMMENT ON COLUMN byai.bykc_ec_artifact.title IS '来源内容标题';
COMMENT ON COLUMN byai.bykc_ec_artifact.markdown_path IS 'Markdown产物存储路径';
COMMENT ON COLUMN byai.bykc_ec_artifact.raw_path IS '原始数据产物存储路径';
COMMENT ON COLUMN byai.bykc_ec_artifact.asset_dir IS '附件资产存储路径';
COMMENT ON COLUMN byai.bykc_ec_artifact.manifest_path IS 'manifest清单存储路径';
COMMENT ON COLUMN byai.bykc_ec_artifact.item_count IS '产物包含的条目数量';
COMMENT ON COLUMN byai.bykc_ec_artifact.file_id IS '关联byai_files文件ID';
COMMENT ON COLUMN byai.bykc_ec_artifact.file_url IS '对象存储文件访问地址';
COMMENT ON COLUMN byai.bykc_ec_artifact.content_type IS '文件MIME类型';
COMMENT ON COLUMN byai.bykc_ec_artifact.file_system_type IS '文件存储系统类型，例如minio、local、sftp';
COMMENT ON COLUMN byai.bykc_ec_artifact.status IS '产物状态，例如CREATED、SUCCESS、FAILED';
COMMENT ON COLUMN byai.bykc_ec_artifact.create_time IS '创建时间';

COMMENT ON TABLE byai.bykc_ec_artifact_signal IS 'ByKC生态采集产物信号表';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_id IS '信号记录主键';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.artifact_id IS '关联采集产物ID';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.run_id IS '所属采集运行ID';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_type IS '信号类型编码，例如source、object、topic、privacy';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_type_name IS '信号类型名称';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_code IS '信号编码';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_name IS '信号名称';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.confidence IS '信号置信度，0到1';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_source IS '信号来源，例如connector、user、rule、model';
COMMENT ON COLUMN byai.bykc_ec_artifact_signal.create_time IS '创建时间';

COMMENT ON TABLE byai.bykc_ec_import_record IS 'ByKC生态采集入库记录表';
COMMENT ON COLUMN byai.bykc_ec_import_record.import_id IS '入库记录主键';
COMMENT ON COLUMN byai.bykc_ec_import_record.run_id IS '所属采集运行ID';
COMMENT ON COLUMN byai.bykc_ec_import_record.artifact_id IS '关联采集产物ID';
COMMENT ON COLUMN byai.bykc_ec_import_record.target_type IS '入库目标类型，例如knowledgeBase、space';
COMMENT ON COLUMN byai.bykc_ec_import_record.target_id IS '入库目标ID或目标名称';
COMMENT ON COLUMN byai.bykc_ec_import_record.target_path IS '入库目标路径';
COMMENT ON COLUMN byai.bykc_ec_import_record.status IS '入库状态，例如SUCCESS、FAILED、SKIPPED';
COMMENT ON COLUMN byai.bykc_ec_import_record.create_time IS '创建时间';

UPDATE "byai"."sandbox_service_spec" SET "spec_json" = '{
    "env": {
        "TZ": "Asia/Shanghai",
        "LANG": "zh_CN",
        "MODEL_ID": "${MODEL_ID}",
        "NODE_ENV": "production",
        "USER_CODE": "${user_code}",
        "MODEL_NAME": "${MODEL_NAME}",
        "REDIS_HOST": "${REDIS_HOST}",
        "REDIS_PORT": "${REDIS_PORT}",
        "DEMO_SCHEMA": "${DEMO_SCHEMA}",
        "MODEL_ALIAS": "${MODEL_ALIAS}",
        "OPENCLAW_TZ": "Asia/Shanghai",
        "BEYOND_TOKEN": "${BEYOND_TOKEN}",
        "NODE_OPTIONS": "--diagnostic-dir=/by/node-diagnostics --heapsnapshot-signal=SIGUSR2 --heapsnapshot-near-heap-limit=3 --heap-prof --heap-prof-dir=/by/node-diagnostics --max-old-space-size=512",
        "BE_DOMAINNAME": "ByaiService",
        "MODEL_API_KEY": "${MODEL_API_KEY}",
        "DWS_CONFIG_DIR": "/by/.openclaw/.dws",
        "MODEL_BASE_URL": "${MODEL_BASE_URL}",
        "REDIS_DATABASE": "${REDIS_DATABASE}",
        "REDIS_PASSWORD": "${REDIS_PASSWORD}",
        "REDIS_USERNAME": "${REDIS_USERNAME}",
        "BAIYING_SESSION": "${BAIYING_SESSION}",
        "DATACLOUD_DB_HOST": "${DB_HOST}",
        "DATACLOUD_DB_PASS": "${DB_PASS}",
        "DATACLOUD_DB_PORT": "${DB_PORT}",
        "DATACLOUD_DB_TYPE": "${DB_TYPE}",
        "DATACLOUD_DB_USER": "${DB_USER}",
        "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}",
        "OPENCLAW_STATE_DIR": "/by/.openclaw",
        "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}",
        "DATACLOUD_DB_DATABASE": "${DB_DATABASE}",
        "DATACLOUD_DB_PASSWORD": "${DB_PASS}",
        "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}",
        "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}"
    },
    "image": "10.10.165.101:8080/byclaw/byclaw-openclaw:develop",
    "ports": [
        {
            "port": 8080,
            "protocol": "http"
        },
        {
            "port": 8082,
            "instance": "filebrowser",
            "protocol": "http"
        }
    ],
    "startup": {
        "entrypoint": [
            "sh",
            "-lc",
            "mkdir -p /by/node-diagnostics && chmod 1777 /by/node-diagnostics && node dist/index.js gateway --bind=lan --port=8080 --allow-unconfigured --verbose & filebrowser --root /by/.openclaw --port 8082 --address 0.0.0.0 --noauth --baseurl /filebrowser"
        ]
    },
    "timeout": 3600,
    "volumes": [
        {
            "key": "base",
            "scope": "PRIVATE",
            "subPath": "byclaw-${user_code}/by",
            "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}",
            "readOnly": false,
            "mountPath": "/by"
        }
    ],
    "bootstrap": {
        "copyTemplate": {
            "copyIfMissing": true,
            "targetVolumeKey": "base"
        }
    },
    "sandboxType": "byclaw",
    "servicePort": 8080,
    "resourceLimits": {
        "cpu": "1",
        "memory": "2048Mi"
    }
}',
                                         "template_json" = '{
    "meta": {
        "lastTouchedAt": "2026-03-27T08:46:51.148Z",
        "lastTouchedVersion": "2026.3.28"
    },
    "hooks": {
        "internal": {
            "enabled": true,
            "entries": {
                "boot-md": {
                    "enabled": false
                },
                "session-memory": {
                    "enabled": true
                }
            }
        }
    },
    "tools": {
        "web": {
            "search": {
                "enabled": false
            }
        },
        "profile": "full"
    },
    "agents": {
        "list": [
            {
                "id": "main",
                "skills": [],
                "default": true,
                "workspace": "${OPENCLAW_STATE_DIR}/workspace"
            }
        ],
        "defaults": {
            "model": {
                "primary": "byclaw/${MODEL_ID} "
            },
            "models": {
                "byclaw/model": {
                    "alias": "${MODEL_ALIAS}"
                }
            },
            "subagents": {
                "maxConcurrent": 8
            },
            "compaction": {
                "mode": "safeguard"
            },
            "maxConcurrent": 4,
            "skipBootstrap": true,
            "verboseDefault": "full",
            "thinkingDefault": "high",
            "blockStreamingBreak": "text_end",
            "blockStreamingDefault": "on"
        }
    },
    "models": {
        "providers": {
            "byclaw": {
                "api": "openai-completions",
                "apiKey": "${MODEL_API_KEY}",
                "models": [
                    {
                        "id": "${MODEL_ID}",
                        "cost": {
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0
                        },
                        "name": "${MODEL_NAME}",
                        "input": [
                            "text"
                        ],
                        "maxTokens": 8192,
                        "reasoning": true,
                        "contextWindow": 128000
                    }
                ],
                "baseUrl": "${MODEL_BASE_URL}"
            }
        }
    },
    "skills": {
        "load": {
            "watch": true,
            "watchDebounceMs": 5000
        },
        "install": {
            "nodeManager": "pnpm"
        }
    },
    "wizard": {
        "lastRunAt": "2026-02-03T07:41:55.092Z",
        "lastRunMode": "local",
        "lastRunCommand": "configure",
        "lastRunVersion": "2026.1.30"
    },
    "gateway": {
        "auth": {
            "mode": "token",
            "token": "${OPENCLAW_GATEWAY_TOKEN}"
        },
        "bind": "lan",
        "mode": "local",
        "port": 18789,
        "controlUi": {
            "allowedOrigins": [
                "*"
            ],
            "allowInsecureAuth": true,
            "dangerouslyDisableDeviceAuth": true,
            "dangerouslyAllowHostHeaderOriginFallback": true
        },
        "tailscale": {
            "mode": "off",
            "resetOnExit": false
        }
    },
    "plugins": {
        "load": {
            "paths": [
                "/app/extensions/baiying-enhance",
                "/app/extensions/byai-channel",
                "/app/extensions/byclaw-sqlite"
            ]
        },
        "allow": [
            "byai-channel",
            "baiying-enhance",
            "byclaw-sqlite"
        ],
        "enabled": true,
        "entries": {
            "xai": {
                "enabled": false
            },
            "byai-channel": {
                "enabled": true
            },
            "byclaw-sqlite": {
                "enabled": true
            },
            "baiying-enhance": {
                "config": {
                    "watchDebounceMs": 500,
                    "mainParentAgentId": "main",
                    "workspaceAutoSeed": true,
                    "embedApiKeysFromJson": true,
                    "mergeAllowSpawnForMain": true
                },
                "enabled": true
            }
        }
    },
    "channels": {
        "byai-channel": {
            "enabled": true,
            "dmPolicy": "open",
            "allowFrom": [
                "*"
            ],
            "webhookPath": "/webhook/byai-channel",
            "streamEnabled": true,
            "blockStreaming": true,
            "sessionKeyPerSessionId": true
        }
    },
    "commands": {
        "native": "auto",
        "restart": true,
        "nativeSkills": "auto",
        "ownerDisplay": "raw"
    }
}', "updated_at" = '2026-06-01 17:59:03.636' WHERE "service_key" = 'openclaw';

