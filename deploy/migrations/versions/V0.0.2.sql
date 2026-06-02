update byai.po_users_organization set position_id =1 where  position_id not in(select position_id from byai.po_position);

delete from byai.byai_system_config where param_code in('SYSTEM_BACKEND_MENU_MANAGE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10000375, null, 'SYSTEM_BACKEND_MENU_MANAGE', '后台菜单管理', 'SYSTEM_BACKEND_MENU_MANAGE', '[
    {
        "menuCode": "menu_org",
        "menuNameEn": "Organization Structure",
        "menuNameCn": "组织结构管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 1,
        "path": "/manager/org/orgMgr"
    },
    {
        "menuCode": "menu_staff_post",
        "menuNameEn": "Employee Post",
        "menuNameCn": "员工岗位管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 2,
        "path": "/manager/org/postManage"
    },
    {
        "menuCode": "menu_role_permission",
        "menuNameEn": "Role Permission",
        "menuNameCn": "角色权限管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 3,
        "path": "/manager/org/permissionGroup"
    },
    {
        "menuCode": "menu_asset_catalog",
        "menuNameEn": "Asset Catalog",
        "menuNameCn": "资产目录管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 4,
        "path": "/manager/business/field"
    },
    {
        "menuCode": "menu_param_config",
        "menuNameEn": "Parameter Config",
        "menuNameCn": "参数配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 5,
        "path": "/manager/systemParams/system"
    },
    {
        "menuCode": "menu_model_config",
        "menuNameEn": "Model Config",
        "menuNameCn": "模型配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 6,
        "path": "/manager/systemParams/modal"
    },
    {
        "menuCode": "menu_sandbox_config",
        "menuNameEn": "Sandbox Config",
        "menuNameCn": "沙箱配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 7,
        "path": "/manager/systemParams/sandbox"
    },
    {
        "menuCode": "menu_ui_agent",
        "menuNameEn": "UI Agent Skills",
        "menuNameCn": "界面技能管理",
        "menuUrl": "https://10.10.24.95:18082/skill-studio?uuid=a5wuyo&objectId=10000376&resourceCode=BYAI_DIG_EMPLOYEE_10000376&sessionId=&files=JTVCJTVE&language=zh-CN&session=main&token=${Beyond-token}",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 8,
        "path": ""
    }
]', '企业后台菜单管理');

delete from byai.byai_system_config where param_code in('DIG_EMPLOYEE_FILE_UPLOAD_CONFIG');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10863540, 'text', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '数字员工文件上传全局配置', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '{
    "enabled": true,
    "allowedFileTypes": [".docx", ".doc", ".pdf", ".txt", ".md", ".xlsx", ".xls", ".csv", ".pptx", ".ppt", ".png", ".jpeg", ".jpg",".mp4", ".mov",".html", ".zip", ".gz", ".json", ".wav"],
    "maxFileSize": 100,
    "maxFileCount": 5
}', '数字员工文件上传全局配置');

delete from byai.byai_system_config where param_code in('TEMPLATE_DIGITAL_EMPLOYEE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10028461, 'text', 'TEMPLATE_DIGITAL_EMPLOYEE', '数字员工提示词模版', 'TEMPLATE_DIGITAL_EMPLOYEE', '[
  {
    "name": "个人助理",
    "key": "BYCLAW_ASSISTANT",
    "ownerType": "personal",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": ["dws"],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "Personality Definition",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "助手",
    "key": "BYCLAW_EXE",
    "ownerType": "enterprise",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "问答",
    "key": "BYCLAW_QA",
    "ownerType": "enterprise",
    "agentType": "006",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByKC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "问题分解",
        "key": "questionDecompose",
        "enName": "Question Decomposition",
        "defaultValue": "将用户的自然语言问题拆解为一个或多个独立的子查询，并标注每个子查询的推理跳数（hop count），用于后续并行调度检索。"
      },
      {
        "name": "单跳问题处理",
        "key": "singleHop",
        "enName": "Single Hop Processing",
        "defaultValue": "指导单跳检索代理通过多轮检索收集充分证据，生成有据可查且无引用标记的自然语言回答。"
      },
      {
        "name": "多跳问题信息检索",
        "key": "multiHopSearch",
        "enName": "Multi-hop Search",
        "defaultValue": "指导多跳检索代理逐跳推理、逐跳检索，通过调用 next_hop 或 finalize 链接各步结论，最终完成链式问答。"
      },
      {
        "name": "多跳问题回答",
        "key": "multiHopSummary",
        "enName": "Multi-hop Summary",
        "defaultValue": "将多跳推理代理的逐跳结果（子问题、证据、结论）合成为一份结构完整、证据可追溯的最终报告。"
      },
      {
        "name": "复合问题回答",
        "key": "subanswerAggregator",
        "enName": "Composite Answer Aggregation",
        "defaultValue": "将多个子查询的回答整合为一份逻辑连贯、无引用标记的 Markdown 格式综合回答，直接回应用户的原始问题。"
      }
    ]
  },
  {
    "name": "问数",
    "key": "BYCLAW_DATA",
    "ownerType": "enterprise",
    "agentType": "005",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByDC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": "请依据已有的工具进行数据查询、数据分析、数据操作。"
      }
    ]
  },
  {
    "name": "调试",
    "key": "BYCLAW_DEBUG",
    "ownerType": "enterprise",
    "agentType": "010",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "编码",
    "key": "BYCLAW_CODE",
    "ownerType": "enterprise",
    "agentType": "011",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  }
]', '数字员工提示词模版');



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


