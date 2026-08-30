
-- GitHub OAuth2 连接器。仅记录部署环境变量名，Client Secret 不进入数据库或 Runtime Manifest。
DELETE FROM byai.byai_connector_info WHERE connector_code = 'github';

INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort
)
VALUES (nextval('byai.seq_any_table'), 'github', 'GitHub', '通过 OAuth2 连接 GitHub 用户账号', 'SYSTEM',
       'github-oauth2', 'github', 'OAUTH2',
       '{"clientIdEnv":"GITHUB_OAUTH_CLIENT_ID","clientSecretEnv":"GITHUB_OAUTH_CLIENT_SECRET","redirectUriEnv":"GITHUB_OAUTH_REDIRECT_URI","scope":"read:user repo"}',
       '{}',
       '{"schemaVersion":"1.0","id":"github","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"shared-volume-projection","projectionPath":"/by/.connector-auth/.github/credential.json","environment":{}},"skill":{"code":"github","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
       40);

-- IMA OpenAPI 连接器。凭据仅由后续用户私有参数流程写入，迁移仅声明前端表单与受管环境白名单。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort
)
SELECT nextval('byai.seq_any_table'), 'ima-openapi', 'IMA', '通过 IMA OpenAPI 连接 IMA 服务', 'SYSTEM',
       'ima-openapi', 'ima-skill', 'AK_SK',
       '{"credentialForm":{"helpUrl":"https://ima.qq.com/agent-interface","fields":[{"key":"clientId","label":"Client ID","inputType":"text","maxLength":256},{"key":"apiKey","label":"API Key","inputType":"password","maxLength":2048}]}}',
       '{}',
       '{"schemaVersion":"1.0","id":"ima-openapi","version":"1.0.0","runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{"version":[["ima","--version"]]}},"authStorage":{"mode":"managed-environment","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","managedEnvironmentKeys":["IMA_OPENAPI_CLIENTID","IMA_OPENAPI_APIKEY"],"environment":{}},"skill":{"code":"ima-skill","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
       50
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_connector_info WHERE connector_code = 'ima-openapi'
);

-- 微信公众号 API 连接器。迁移只声明表单和受管环境变量；access_token 不落库。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort
)
SELECT nextval('byai.seq_any_table'), 'weixin-official-api', '微信公众号 API',
       '安全保存公众号 AppID/AppSecret，供 byCLI 通过官方 API 创建草稿', 'SYSTEM',
       'weixin-official-api', 'wechat-api', 'AK_SK',
       '{"credentialForm":{"helpUrl":"https://developers.weixin.qq.com/platform","helpLinkText":"前往微信开发者平台获取凭据","helpText":"连接器作用：安全保存公众号 AppID 和 AppSecret，并在启用时提供给数字员工。使用 bycli weixin create-draft 时会优先调用公众号官方 API 上传封面和正文图片、创建草稿；不会直接群发或正式发布文章，也不保存 access_token。\n\n获取步骤：\n1. 点击下方链接登录微信公众平台，使用公众号管理员或有开发权限的微信扫码。\n2. 登录后选择要连接的目标公众号，进入公众号后台。\n3. 打开“设置与开发” → “开发接口管理” → “基本配置”，找到公众号开发信息。\n4. 在开发者 ID 区域复制 AppID。\n5. 在 AppSecret 区域点击“查看”或“重置”，由管理员扫码确认后复制新值。\n6. 将 ByClaw 后端和任务沙箱出口 IP 加入 IP 白名单，避免 40164。\n7. 返回本页填写 AppID、AppSecret，点击“保存并连接”。\n\n安全提示：AppSecret 相当于 API 密码，请勿发送到聊天、截图、工单或代码仓库。重置后旧值失效，需要重新连接。","fields":[{"key":"appId","label":"AppID","inputType":"text","maxLength":256},{"key":"appSecret","label":"AppSecret","inputType":"password","maxLength":2048}]}}',
       '{}',
       '{"schemaVersion":"1.0","id":"weixin-official-api","version":"1.0.0","runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{"version":[["bycli","--version"]]}},"authStorage":{"mode":"managed-environment","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","managedEnvironmentKeys":["WECHAT_APPID","WECHAT_APPSECRET"],"environment":{}},"skill":{"code":"wechat-api","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
       55
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_connector_info WHERE connector_code = 'weixin-official-api'
);

-- 同步更新已存在的连接器元数据，避免仅在首次初始化数据库时展示新版引导。
UPDATE byai.byai_connector_info
SET description = '安全保存公众号 AppID/AppSecret，供 byCLI 通过官方 API 创建草稿',
    skill_code = 'wechat-api',
    auth_config = '{"credentialForm":{"helpUrl":"https://developers.weixin.qq.com/platform","helpLinkText":"前往微信开发者平台获取凭据","helpText":"连接器作用：安全保存公众号 AppID 和 AppSecret，并在启用时提供给数字员工。使用 bycli weixin create-draft 时会优先调用公众号官方 API 上传封面和正文图片、创建草稿；不会直接群发或正式发布文章，也不保存 access_token。\n\n获取步骤：\n1. 点击下方链接登录微信公众平台，使用公众号管理员或有开发权限的微信扫码。\n2. 登录后选择要连接的目标公众号，进入公众号后台。\n3. 打开“设置与开发” → “开发接口管理” → “基本配置”，找到公众号开发信息。\n4. 在开发者 ID 区域复制 AppID。\n5. 在 AppSecret 区域点击“查看”或“重置”，由管理员扫码确认后复制新值。\n6. 将 ByClaw 后端和任务沙箱出口 IP 加入 IP 白名单，避免 40164。\n7. 返回本页填写 AppID、AppSecret，点击“保存并连接”。\n\n安全提示：AppSecret 相当于 API 密码，请勿发送到聊天、截图、工单或代码仓库。重置后旧值失效，需要重新连接。","fields":[{"key":"appId","label":"AppID","inputType":"text","maxLength":256},{"key":"appSecret","label":"AppSecret","inputType":"password","maxLength":2048}]}}',
    runtime_manifest = '{"schemaVersion":"1.0","id":"weixin-official-api","version":"1.0.0","runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{"version":[["bycli","--version"]]}},"authStorage":{"mode":"managed-environment","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","managedEnvironmentKeys":["WECHAT_APPID","WECHAT_APPSECRET"],"environment":{}},"skill":{"code":"wechat-api","source":"system-builtin","installScope":"user","grantScope":"agent"}}'
WHERE connector_code = 'weixin-official-api';

-- 微信开放平台第三方平台连接器。平台级密钥仅从后端部署环境读取，不投影到用户沙箱。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort
)
SELECT nextval('byai.seq_any_table'), 'weixin-open-platform', '微信开放平台第三方平台',
       '由公众号管理员扫码授权并读取公众号账号资料', 'SYSTEM',
       'weixin-open-platform', 'wechat-api', 'OAUTH2',
       '{"componentAppidEnv":"WECHAT_COMPONENT_APPID","componentAppsecretEnv":"WECHAT_COMPONENT_APPSECRET","callbackTokenEnv":"WECHAT_COMPONENT_CALLBACK_TOKEN","encodingAesKeyEnv":"WECHAT_COMPONENT_ENCODING_AES_KEY","redirectUriEnv":"WECHAT_COMPONENT_REDIRECT_URI"}',
       '{}',
       '{"schemaVersion":"1.0","id":"weixin-open-platform","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"skill":{"code":"wechat-api","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
       56
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_connector_info WHERE connector_code = 'weixin-open-platform'
);

UPDATE byai.byai_connector_info
SET connector_name = '微信开放平台第三方平台',
    description = '由公众号管理员扫码授权并读取公众号账号资料',
    provider_code = 'weixin-open-platform',
    skill_code = 'wechat-api',
    auth_mode = 'OAUTH2',
    auth_config = '{"componentAppidEnv":"WECHAT_COMPONENT_APPID","componentAppsecretEnv":"WECHAT_COMPONENT_APPSECRET","callbackTokenEnv":"WECHAT_COMPONENT_CALLBACK_TOKEN","encodingAesKeyEnv":"WECHAT_COMPONENT_ENCODING_AES_KEY","redirectUriEnv":"WECHAT_COMPONENT_REDIRECT_URI"}',
    request_config = '{}',
    runtime_manifest = '{"schemaVersion":"1.0","id":"weixin-open-platform","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"skill":{"code":"wechat-api","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
    sort = 56
WHERE connector_code = 'weixin-open-platform';

-- IMA OpenAPI 内置 Skill 注册
-- CLI 与 skill 文件随 OpenClaw 镜像提供；数据库仅注册目录、运行期快照和可发现权限。
UPDATE byai.byai_system_config c
SET param_value = CASE
        WHEN rtrim(c.param_value) = '[]' THEN '['
        ELSE left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1) || ','
    END
    || '{"skillName":"IMA","skillCode":"ima-skill","skillDescZh":"通过 ima-openapi-cli 管理 IMA 笔记和知识库。","skillDescEn":"Manage IMA notes and knowledge bases through ima-openapi-cli."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"ima-skill"%';

INSERT INTO byai.ss_resource (
    resource_id, system_code, resource_biz_type, resource_type, resource_name,
    resource_desc, resource_version_id, host_type, catalog_id, man_org_id,
    man_user_id, create_by, create_time, update_by, update_time, com_acct_id,
    resource_status, resource_d_verid, resource_r_verid, resource_code,
    publish_time, auth_status, publish_portal, parent_resource_id, publish_type,
    owner_type, impl_type, worker_agent_type
)
SELECT
    nextval('byai.seq_any_table'), 'BYAI', 'SKILL', 'ATOM', 'IMA',
    '通过 ima-openapi-cli 管理 IMA 笔记和知识库。',
    '0.1.3', 'hosted', 10, -1, '10001', 10001, CURRENT_TIMESTAMP,
    10001, CURRENT_TIMESTAMP, 1, 2, -1, -1, 'ima-skill',
    CURRENT_TIMESTAMP, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource WHERE resource_code = 'ima-skill'
);

INSERT INTO byai.ss_res_ext_skill (
    resource_id, skill_type, source_type, version, skill_url,
    skill_package_format, skill_original_filename, skill_package_size,
    skill_package_hash, sync_status, sync_error, last_sync_time
)
SELECT
    r.resource_id, 'inner', 'SYSTEM_BUILTIN', '0.1.3', '', 'zip', NULL, NULL, NULL,
    'SUCCESS', NULL, CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
)
  AND r.resource_code = 'ima-skill';

UPDATE byai.ss_res_ext_skill e
SET target_content = json_build_object(
    'resourceId', r.resource_id,
    'resourceCode', r.resource_code,
    'resourceName', r.resource_name,
    'resourceDesc', r.resource_desc,
    'resourceBizType', r.resource_biz_type,
    'resourceType', r.resource_type,
    'ownerType', r.owner_type,
    'sourceType', e.source_type,
    'skillType', e.skill_type,
    'skillUrl', e.skill_url,
    'version', e.version,
    'skillPackageFormat', e.skill_package_format,
    'skillOriginalFilename', e.skill_original_filename,
    'skillPackageSize', e.skill_package_size,
    'skillPackageHash', e.skill_package_hash,
    'syncStatus', e.sync_status,
    'syncError', e.sync_error,
    'lastSyncTime', to_char(e.last_sync_time, 'YYYY-MM-DD HH24:MI:SS')
)::text
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'ima-skill';

INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type, allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'),
    g.grant_type, g.oper_type, g.grant_obj_type, ima.resource_id,
    g.eff_date, g.exp_date, g.status_cd, g.create_staff, g.create_date,
    g.update_staff, g.update_date, g.grant_to_type, g.grant_to_obj_id,
    g.grant_to_obj_type, g.allow_unsubscribe
FROM byai.au_privilege_grant g
CROSS JOIN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'ima-skill'
) ima
CROSS JOIN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'dws'
) dws
WHERE g.grant_obj_id = dws.resource_id
  AND NOT EXISTS (
      SELECT 1
      FROM byai.au_privilege_grant existing
      WHERE existing.grant_obj_id = ima.resource_id
        AND existing.grant_type = g.grant_type
        AND existing.grant_to_type = g.grant_to_type
        AND existing.grant_to_obj_id = g.grant_to_obj_id
        AND existing.grant_to_obj_type = g.grant_to_obj_type
  );

-- IMA 授权兜底：DWS 尚未初始化授权时，至少授予内置管理员使用和管理权限。
INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type, allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'), fallback.grant_type, 'READ', 'SKILL', ima.resource_id,
    CURRENT_TIMESTAMP, NULL, 'A', 10001, CURRENT_TIMESTAMP, 10001, CURRENT_TIMESTAMP,
    'RED', 10001, 'USER', 'Y'
FROM (VALUES ('AVAILABLE_USE'), ('ALLOW_MANAGE')) AS fallback(grant_type)
CROSS JOIN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'ima-skill'
) ima
WHERE NOT EXISTS (
    SELECT 1 FROM byai.au_privilege_grant existing
    WHERE existing.grant_obj_id = ima.resource_id
      AND existing.status_cd = 'A'
      AND existing.grant_type = fallback.grant_type
      AND existing.grant_to_type = 'RED'
      AND existing.grant_to_obj_id = 10001
      AND existing.grant_to_obj_type = 'USER'
);
-- IMA OpenAPI 内置 Skill 注册结束

/**百应运营渠道**/
-- 运营闭环：按运营需求类型配置独立启动提示词，避免不同类型任务携带无关字段。
-- 后端按 operationType 分别读取采集、知识整理、对象发现、发布和分析提示词，避免不同任务类型混用字段。
delete from byai.byai_system_config where param_code in (
    'OPLOOP_TASK_START_PROMPT',
    'OPLOOP_COLLECT_TASK_START_PROMPT',
    'OPLOOP_PUBLISH_TASK_START_PROMPT',
    'OPLOOP_ANALYZE_TASK_START_PROMPT',
    'OPLOOP_TASK_START_PROMPT_COLLECT',
    'OPLOOP_TASK_START_PROMPT_KNOWLEDGE',
    'OPLOOP_TASK_START_PROMPT_OBJECT_DISCOVERY',
    'OPLOOP_TASK_START_PROMPT_PUBLISH',
    'OPLOOP_TASK_START_PROMPT_ANALYZE'
);

-- 运营提示词与研发提示词统一进入 byai_ai_prompt，脚本可重复执行而不会产生重复模板。
delete from byai.byai_ai_prompt where prompt_code in (
    'OPLOOP_TASK_START_PROMPT',
    'OPLOOP_COLLECT_TASK_START_PROMPT',
    'OPLOOP_PUBLISH_TASK_START_PROMPT',
    'OPLOOP_ANALYZE_TASK_START_PROMPT',
    'OPLOOP_TASK_START_PROMPT_COLLECT',
    'OPLOOP_TASK_START_PROMPT_KNOWLEDGE',
    'OPLOOP_TASK_START_PROMPT_OBJECT_DISCOVERY',
    'OPLOOP_TASK_START_PROMPT_PUBLISH',
    'OPLOOP_TASK_START_PROMPT_ANALYZE'
);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_COLLECT', '运营任务启动提示词-资料采集与整理',
'运营资料采集与整理任务启动提示词，占位符 ${projectName} ${title} ${description} ${requirementName} ${requirementDescription} ${sourceMode} ${sourceValue} ${storageMode} ${storageTarget} ${runMode} ${executionTime}',
'OPLOOP_TASK_START_PROMPT_COLLECT',
'请处理以下资料采集与整理任务：

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}
- 任务描述：${description}

## 资料采集配置
- 采集方式：${sourceMode}
- 采集来源：${sourceValue}
- 入库方式：${storageMode}
- 入库位置：${storageTarget}
- 执行方式：${runMode}
- 执行时间：${executionTime}

## 执行要求
1. 必须使用 knowledge-collection 技能进行采集。
2. 严格依据关联需求、任务描述和资料采集配置开展工作。
3. 将采集结果归档到配置的入库位置，并同步关键进度、产出结果和异常情况。
4. 涉及登录或对外访问时，先核对对应连接器和平台配置。
',
'Process the following material collection and organization task:

## Related requirement
- Requirement name: ${requirementName}
- Requirement description: ${requirementDescription}

## Operation task information
- Operation project: ${projectName}
- Task name: ${title}
- Task description: ${description}

## Material collection configuration
- Collection method: ${sourceMode}
- Collection source: ${sourceValue}
- Storage method: ${storageMode}
- Storage destination: ${storageTarget}
- Execution method: ${runMode}
- Execution time: ${executionTime}

## Execution requirements
1. Execute strictly according to the related requirement, task description, and material collection configuration.
2. Archive the collected results to the configured destination and report key progress, results, and exceptions.
3. Before logging in or accessing external services, verify the related connector and platform configuration.
',
10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_KNOWLEDGE', '运营任务启动提示词-知识整理',
'运营知识整理任务启动提示词，占位符 ${projectName} ${title} ${description} ${sourceMode} ${storageMode} ${runMode} ${executionTime}',
'OPLOOP_TASK_START_PROMPT_KNOWLEDGE',
'请执行以下任务：

# 运营任务信息
运营项目：${projectName}
任务名称：${title}
任务描述：${description}
来源本体：${sourceMode}
目标本体：${storageMode}

# 任务配置
执行方式：${runMode}
执行时间：${executionTime}
',
'Process the following knowledge organization task:

## Operation task information
- Operation project: ${projectName}
- Task name: ${title}
- Task description: ${description}

## Knowledge organization configuration
- Source ontology: ${sourceMode}
- Target ontology: ${storageMode}
- Execution method: ${runMode}
- Execution time: ${executionTime}

## Execution requirements
1. Confirm the knowledge structure, clean the content, and ingest the result according to the task description and configuration.
2. Preserve source accuracy and traceability, and report key progress, results, and exceptions.
',
10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_OBJECT_DISCOVERY', '运营任务启动提示词-对象发现',
'运营对象发现任务启动提示词，占位符 ${projectName} ${title} ${description} ${sourceMode} ${storageMode} ${runMode} ${executionTime}',
'OPLOOP_TASK_START_PROMPT_OBJECT_DISCOVERY',
'请处理以下对象发现任务：

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}
- 任务描述：${description}

## 对象发现配置
- 来源本体：${sourceMode}
- 发现对象本体：${storageMode}
- 执行方式：${runMode}
- 执行时间：${executionTime}

## 执行要求
1. 根据采集文档和本体对象定义识别并提取对象实例。
2. 按照对象字段定义补充实例属性，保留来源依据。
3. 将发现结果保存到目标本体，并同步关键进度、产出结果和异常情况。
',
'Process the following object discovery task:

## Operation task information
- Operation project: ${projectName}
- Task name: ${title}
- Task description: ${description}

## Object discovery configuration
- Source ontology: ${sourceMode}
- Discovery target ontology: ${storageMode}
- Execution method: ${runMode}
- Execution time: ${executionTime}

## Execution requirements
1. Identify and extract object instances from collected documents according to ontology definitions.
2. Complete instance attributes according to object fields and preserve source evidence.
3. Save discovery results to the target ontology and report key progress, results, and exceptions.
',
10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '运营任务启动提示词-内容创作', '运营内容创作与发布任务启动提示词，占位符 ${projectName} ${title} ${requirementName} ${requirementDescription} ${contentType} ${publishChannel} ${publishAccount} ${publishTopic} ${publishSchedule}', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '请处理以下内容创作与发布任务：

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}
- 任务描述：${description}

## 内容创作与发布配置
- 内容类型：${contentType}
- 发布渠道：${publishChannel}
- 发布账号：${publishAccount}
- 创作主题：${publishTopic}
- 发布时间或计划：${publishSchedule}

## 执行要求
1. 严格依据关联需求和内容创作配置完成内容生产。
2. 涉及发布或登录时，先核对发布账号和平台配置，再执行对外操作。
3. 及时同步关键进度、发布结果和异常情况。
', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '运营任务启动提示词-数据分析', '运营数据分析与优化任务启动提示词，占位符 ${projectName} ${title} ${requirementName} ${requirementDescription} ${analysisPlatform} ${analysisAccount} ${analysisScope} ${analysisWorks}', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '请处理以下数据分析与优化任务：

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}
- 任务描述：${description}

## 数据分析配置
- 分析平台：${analysisPlatform}
- 分析账号：${analysisAccount}
- 分析范围：${analysisScope}
- 指定作品：${analysisWorks}

## 执行要求
1. 严格依据关联需求和数据分析配置开展分析与优化。
2. 分析范围为指定作品时，仅处理列出的作品；未指定时按账号范围处理。
3. 及时同步关键进度、分析结论、优化建议和异常情况。
', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

delete from byai.byai_system_config_list where param_group_code in('OPERATION_CHANNEL');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '微信公众号', 'WeChatAccount', 'WeChatAccount', '微信公众号', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '小红书', 'Xiaohongshu', 'Xiaohongshu', '小红书', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '视频号', 'WeChatChannels', 'WeChatChannels', '视频号', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '互联网', 'Internet', 'Internet', '互联网', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', 'GitHub', 'GitHub', 'GitHub', 'GitHub', 5);

/**百应运营需求类型**/
delete from byai.byai_system_config_list where param_group_code in('OPERATION_REQUIRE_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '素材采集与整理', 'collect', 'collect', '素材采集与整理', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '内容创作与发布', 'publish', 'publish', '内容创作与发布', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '数据分析与优化', 'analyze', 'analyze', '数据分析与优化', 3);

-- 运营项目类型由项目空间前端动态读取，补齐后新环境才会显示“运营项目”创建入口。
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq)
SELECT nextval('byai.seq_any_table'), 'PROJECT_TYPE', '项目类型', '运营项目', 'operation', 'operation', '运营项目', 3
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_system_config_list
    WHERE param_group_code = 'PROJECT_TYPE' AND param_value = 'operation'
);



-- 研发闭环提示词迁移：从 byai_system_config 移到 byai_ai_prompt（分组 DEVLOOP_PROMPT）。
-- TASK_START / REQUIREMENT_SCORE / REQUIREMENT_SPLIT_SCORE 迁移；PHASE_EXTRACT 环节抽取已废弃，仅删不迁。
delete from byai.byai_system_config where param_code in ('DEVLOOP_TASK_START_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SCORE_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_PHASE_EXTRACT_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT');

-- 幂等：先按 prompt_code 清掉旧行再插入当前模板。
delete from byai.byai_ai_prompt where prompt_code in
    ('DEVLOOP_TASK_START_PROMPT', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT');

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_TASK_START_PROMPT', '研发任务启动提示词', '研发闭环任务启动提示词模板，占位符 ${projectName} ${repoFullName} ${branchName} ${taskType} ${title} ${description} ${repoCloneHint}(后端按代码平台生成安全克隆说明)', 'DEVLOOP_TASK_START_PROMPT', '请处理以下任务：
## 任务信息
- 项目：${projectName}
- 代码仓库：${repoFullName}
- 目标分支：${branchName}（尚未创建，需你新建）
- 任务类型：${taskType}
- 任务标题：${title}

## 需求详情
${description}

## 仓库访问说明
${repoCloneHint}

## 代码仓库
任务的代码克隆仓库路径需要遵循/by/.sessions/{sessionId}/{repoName}/

## 强制要求
acp下发任务告诉对方启动的时候必须要调用skill：self-developed-rules;
研发流程的输出文档如：需求文档、设计文档、测试文档保存在/by/.sessions/{sessionId}/下面', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '研发需求评分提示词', '研发闭环需求评分提示词，占位符 ${title} ${content}，要求模型返回各维度得分JSON', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '你是资深产品与研发评审专家。请对下面这条候选需求进行多维度打分，用于研发优先级排序。

## 待评估需求
标题：${title}
内容：${content}

## 评分维度与分值上限
- businessValue 业务价值（0-30）：对业务目标、营收或核心指标的贡献
- userImpact 用户影响（0-20）：影响的用户范围与体验提升程度
- urgency 紧迫度（0-15）：时间敏感性，是否阻塞或有明确截止
- strategyFit 战略匹配（0-15）：与产品/公司战略方向的契合度
- feasibility 实现可行性（0-10）：技术实现难度，越可行分越高
- reuseValue 复用价值（0-10）：能力沉淀与跨场景复用潜力
- risk 风险与冲突（-10-0）：与现有功能冲突、合规或稳定性风险，作为负分扣减

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- 各维度取整数，不得超过上限；risk 为 0 到 -10 的整数。
- summary 为一句话「AI 整理的产品需求」，凝练该需求要交付的能力。
- 严格用如下字段：

{"businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '研发需求拆分+评分提示词', '研发闭环拆分+评分提示词，占位符 ${title} ${content}，要求模型返回 requirements 数组', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '你是资深产品与研发评审专家。下面是一条从群消息/Issue 收集到的候选需求，可能包含多个相互独立的需求，也可能只是一个需求。请先判断是否需要拆分，再对每个独立需求多维度打分。

## 待评估内容
标题：${title}
内容：${content}

## 拆分规则
- 仅当内容里确实包含多个「相互独立、可分别交付」的需求时才拆分；一个需求的多个步骤/细节不要拆开。
- 最多拆 5 个；无法明确拆分时按 1 个处理（原样返回一条）。
- 每个子需求给出清晰的 title（简短）和 content（自包含、不依赖其它子需求也能理解）。

## 评分维度与分值上限（对每个子需求分别打分）
- businessValue 业务价值（0-30）
- userImpact 用户影响（0-20）
- urgency 紧迫度（0-15）
- strategyFit 战略匹配（0-15）
- feasibility 实现可行性（0-10）
- reuseValue 复用价值（0-10）
- risk 风险与冲突（-10-0，负分扣减）

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- requirements 为数组，每个元素含 title、content 及各维度整数分与 summary（一句话概括该需求要交付的能力）。
- 不拆分时 requirements 只含 1 个元素。
- 严格用如下结构：

{"requirements":[{"title":"","content":"","businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}]}', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);


-- 回填研发子任务:历史需求为 1:1(scan_log_item.session_id 直连一个会话),各生成一条子任务,
-- 让存量数据具备需求级批量集成的就绪聚合能力。project_id 与 repo_id 均经 scan_source 派生(item.source_id 直连)。
-- 幂等:仅对尚无有效子任务的已启动需求插入。
INSERT INTO byai.byai_scan_item_task (task_id, requirement_id, project_id, repo_id, session_id, status, create_time, delete_flag)
SELECT nextval('byai.seq_any_table'), i.item_id, s.project_id, s.repo_id, i.session_id, 'running', CURRENT_TIMESTAMP, '0'
FROM byai.byai_scan_log_item i
JOIN byai.byai_scan_source s ON s.source_id = i.source_id
WHERE i.session_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM byai.byai_scan_item_task t
      WHERE t.requirement_id = i.item_id AND t.delete_flag = '0'
  );

-- 内置运营任务模板采用固定负数 ID，重复执行迁移时不会重复插入。
INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2001, 'collect', '素材采集任务模板', '从知识库、连接器或互联网采集素材并归档',
       '{"title":"采集 AI Agent 行业案例","description":"采集近期企业级 AI Agent 的落地案例，提炼来源、核心场景和可复用亮点。","sourceMode":"knowledge","storageMode":"knowledge","executorType":"agent","runMode":"once"}',
       10, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2001);

INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2002, 'knowledge', '知识整理任务模板', '使用《知识整理》技能，针对采集到的 会议纪要，进行对象实例提取。',
       '{"title":"整理采集素材并沉淀知识","description":"对素材去重、摘要并提炼文章亮点、写法和可复用结构。","materialSource":"本体数据","sourceMode":"会议纪要","storageMode":"产品,方法论,操作说明,特性,场景,能力,事件","executorType":"agent","runMode":"once"}',
       20, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2002);

INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2006, 'object_discovery', '对象发现任务模板', '根据采集的文档和本体对象定义进行对象实例发现',
       '{"title":"对象发现任务模板","description":"根据采集的文档，根据本体对象定义，进行对象实例发现。","sourceMode":"会议纪要","storageMode":"产品,方法论,操作说明,特性,场景,能力,事件","executorType":"agent","runMode":"once"}',
       25, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2006);

INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2003, 'content', '内容创作任务模板', '结构化描述主题、内容形态、受众与表达要求',
       '{"title":"创作 BeyondAI 实验室公众号文章","description":"围绕企业 AI Agent 实践创作一篇面向企业管理者的深度文章，包含案例与行动建议。","contentType":"公众号文章","audience":"企业管理者与 AI 产品负责人","executorType":"agent","runMode":"once"}',
       30, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2003);

INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2004, 'publish', '内容发布任务模板', '选择账号、发布时间与审核规则完成发布',
       '{"title":"发布已审核内容","description":"将已审核内容发布到指定账号，发布前再次检查标题、封面和品牌口径。","platform":"微信公众号","executorType":"agent","runMode":"once"}',
       40, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2004);

INSERT INTO byai.byai_task_template
    (template_id, template_type, template_name, description, config, sort_no, delete_flag)
SELECT -2005, 'analyze', '数据分析任务模板', '围绕账号或作品数据生成复盘与优化建议',
       '{"title":"运营数据分析与优化","description":"分析近 30 天账号与作品表现，识别高表现内容并输出下一周期优化建议。","analysisScope":"账号整体分析","range":"近 30 天","executorType":"agent","runMode":"once"}',
       50, '0'
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_task_template WHERE template_id = -2005);

-- 需求 AI 预拆提示词：需求 + 项目仓库清单 → 仓库级子任务草稿（含仓库间依赖）。
-- 无占位符：需求正文与仓库清单由后端组装成 user message，本模板只作 system prompt。
delete from byai.byai_ai_prompt where prompt_code = 'DEVLOOP_REQUIREMENT_PRESPLIT_PROMPT';

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_PRESPLIT_PROMPT', '需求AI预拆提示词', '需求拆分弹窗打开时调用，输入需求与项目仓库清单，输出仓库级子任务草稿 JSON，不落库', 'DEVLOOP_REQUIREMENT_PRESPLIT_PROMPT',
E'你是研发拆单助手。输入是一条需求和该项目下的代码仓库清单，请把需求拆成可并行或串行执行的仓库级子任务。\n\n规则：\n1. 只能使用输入中给出的 repoId，不得编造；与需求无关的仓库不要产出任务。\n2. 一个仓库最多一条任务。需求只涉及一个仓库时就只产出一条。\n3. dependsOn 用同批任务的 rowId 表示上游依赖，必须无环；能并行的不要硬串成链。\n4. title 用中文描述该仓库要做的具体改动，不要照抄需求标题。\n5. branch 全批任务保持一致：输入里给了「工作区分支」时必须原样用它，没给时才用 feat/<英文小写短横线短语>。\n6. reason 一句话说明为什么这个仓库要改、为什么有/没有这个依赖。\n\n只输出 JSON，结构为：\n{"tasks":[{"rowId":"row-0","repoId":123,"title":"...","branch":"feat/xxx","dependsOn":[],"reason":"..."}]}',
E'You split a requirement into repository-level subtasks. Input is one requirement plus the repository list of its project.\n\nRules:\n1. Use only the repoId values given in the input; never invent one. Skip repositories the requirement does not touch.\n2. At most one task per repository. Emit a single task when only one repository is involved.\n3. dependsOn references rowId values from the same batch and must stay acyclic; do not force a chain when tasks can run in parallel.\n4. title describes the concrete change in that repository; do not copy the requirement title.\n5. branch is the same for every task. When the input provides a workspace branch, use it verbatim; only fall back to feat/<lowercase-dashed-phrase> when none is given.\n6. reason is one sentence on why this repository changes and why the dependency exists or not.\n\nOutput JSON only:\n{"tasks":[{"rowId":"row-0","repoId":123,"title":"...","branch":"feat/xxx","dependsOn":[],"reason":"..."}]}',
'system', now(), now(), null);

-- 用例来源回填:存量环境行加列后为 NULL,按既有行为(用例已在环境机上)显式落 on_env。
-- 只回填 NULL,保证本段可重跑而不会把新建的 workspace 环境倒回 on_env。
UPDATE byai.byai_integration_env SET case_source = 'on_env' WHERE case_source IS NULL;

-- 工作区初始化提示词：初始化从后端 Java 流程（ProjectInitService）改为下发架构助理会话，
-- 由它在沙箱内完成克隆/骨架/技能包/push，并按 self-developed-rules 契约写状态文件，
-- 后端定时任务读该文件收口。提示词是这条链路的唯一指令来源，故入库为可运营模板。
-- 正文简化为 /trellis-spec-bootstrap 斜杠命令：初始化步骤由该命令自己定义，提示词不再复述克隆/技能包/commit/push
-- 五步，避免两处各写一套且互相漂移。ACP 那行必须留：完成状态靠 self-developed-rules 写会话状态文件，
-- 不调这个 skill 平台读不到 completed，项目会一直卡在「初始化中」。
-- 幂等：先按 prompt_code 清掉旧行再插入当前模板。
delete from byai.byai_ai_prompt where prompt_code in ('DEVLOOP_WORKSPACE_INIT_PROMPT');

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_WORKSPACE_INIT_PROMPT', '工作区初始化提示词', '架构数字员工初始化研发项目工作区的提示词，正文为 /trellis-spec-bootstrap 斜杠命令加 ACP 强制要求；占位符 ${projectName} ${repoFullName} ${repoUrl} ${defaultBranch} ${sessionId} ${skillPackageSection} ${repoCloneHint} 仍可用，当前模板不再使用', 'DEVLOOP_WORKSPACE_INIT_PROMPT', '/trellis-spec-bootstrap 按照逻辑要求初始化trellis项目spec，过程你不需要询问我的意见，按照你推荐的方式进行

acp下发任务告诉对方启动的时候必须要调用skill：self-developed-rules;', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

-- 需求澄清提示词：需求列表「启动」的第二个入口，把需求交给需求数字员工在聊天里聊完成。
-- 正文就是一条斜杠命令 + 需求内容，澄清步骤由该命令自己定义，提示词不复述。
-- ACP 那行与初始化提示词同源：启动时必须调用 self-developed-rules，否则完成状态没人写。
-- 幂等：先按 prompt_code 清掉旧行再插入当前模板。
delete from byai.byai_ai_prompt where prompt_code in ('DEVLOOP_REQUIREMENT_CLARIFY_PROMPT');

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_CLARIFY_PROMPT', '需求澄清提示词', '需求数字员工澄清需求的提示词，占位符 ${requirementContent} 替换为原始需求内容；正文为 /byclaw-requirement-clarification 斜杠命令加需求内容，再加 ACP 强制要求', 'DEVLOOP_REQUIREMENT_CLARIFY_PROMPT', '/byclaw-requirement-clarification ${requirementContent}

acp下发任务告诉对方启动的时候必须要调用skill：self-developed-rules;', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);


-- 数字员工组类型字典（OpenGauss，可重复执行）。
DELETE FROM byai.byai_system_config_list WHERE param_group_code = 'DIG_EMPLOYEE_AGENT_TYPE' AND param_value = '017';

INSERT INTO byai.byai_system_config_list
(param_id, param_group_code, param_group_name, param_name, param_en_name,
 param_value, param_desc, param_seq)
VALUES
    (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型',
     '数字员工组', 'Digital Employee Group', '017', '数字员工组', 6);
-- By-Reach v2 产品面迁移：保留 agent-reach 技术代码，将显示名称和说明升级为 By-Reach。
-- V0.3.1 已发布，不能重写；本版本仅更新已有数据，且可重复执行。
UPDATE byai.byai_system_config c
SET param_value = regexp_replace(
    regexp_replace(
        regexp_replace(
            c.param_value,
            '"skillName"[[:space:]]*:[[:space:]]*"agent-reach"',
            '"skillName":"By-Reach"',
            'g'
        ),
        '"skillDescZh"[[:space:]]*:[[:space:]]*"路由公开互联网渠道能力，并按 ByClaw 覆盖规则选择 byCLI 等执行器。"',
        '"skillDescZh":"路由公共互联网渠道，并按 By-Reach v2 策略选择已批准的执行器。"',
        'g'
    ),
    '"skillDescEn"[[:space:]]*:[[:space:]]*"Route public-internet channels and select executors such as byCLI according to ByClaw override rules\."',
    '"skillDescEn":"Route public-internet channels and select approved By-Reach v2 executors."',
    'g'
)
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g') LIKE '%"skillCode":"agent-reach"%';

UPDATE byai.ss_resource
SET resource_name = 'By-Reach',
    resource_desc = '路由公共互联网渠道，并按 By-Reach v2 策略选择已批准的执行器。',
    update_time = CURRENT_TIMESTAMP
WHERE resource_code = 'agent-reach';

-- 资源扩展记录保存了资源字段快照，名称变更后同步重建，避免 API 返回旧展示信息。
UPDATE byai.ss_res_ext_skill e
SET target_content = json_build_object(
    'resourceId', r.resource_id,
    'resourceCode', r.resource_code,
    'resourceName', r.resource_name,
    'resourceDesc', r.resource_desc,
    'resourceBizType', r.resource_biz_type,
    'resourceType', r.resource_type,
    'ownerType', r.owner_type,
    'sourceType', e.source_type,
    'skillType', e.skill_type,
    'skillUrl', e.skill_url,
    'version', e.version,
    'skillPackageFormat', e.skill_package_format,
    'skillOriginalFilename', e.skill_original_filename,
    'skillPackageSize', e.skill_package_size,
    'skillPackageHash', e.skill_package_hash,
    'syncStatus', e.sync_status,
    'syncError', e.sync_error,
    'lastSyncTime', to_char(e.last_sync_time, 'YYYY-MM-DD HH24:MI:SS')
)::text
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'agent-reach';

delete from byai.byai_ai_prompt where prompt_group_code in('SUMMARY_CHAT_CONTENT') and prompt_code in('SUMMARY_CHAT_CONTENT');
INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (nextval('byai.seq_any_table'), 'SUMMARY_CHAT_CONTENT', 'SUMMARY_CHAT_CONTENT', '会话总结提示词', '会话总结提示词模板，占位符 ${chatContent}', 'chatContent', '基于下面用户输入内容生成会话标题
用户输入原文：${chatContent}
要求：
1. 标题长度2-30字，直观体现本次会话核心主题
2. 提炼核心需求、问题或讨论对象，避免空话
3. 禁止加多余说明、序号、引号、表情，只输出标题文本
4. 优先名词+动作结构，适合作为聊天会话列表标题
5. 【强制】禁止输出标签、禁止输出任何内部思考/推理过程，只返回最终标题
', 'Generate a conversation title based on the user input below
Original user input: ${chatContent}
Requirements:
1. The title should be 2–30 characters long and directly reflect the core topic of this conversation
2. Extract the core requirement, question or discussion subject; avoid vague content
3. No extra explanations, serial numbers, quotation marks or emojis. Output only the title text
4. Prefer noun + verb structure, suitable for chat conversation list titles
5. [Mandatory] Do not output tags, internal thinking or reasoning. Return only the final title', 10001, '2026-08-07 11:15:33', '2026-08-07 11:15:33', null);

-- ============================================================================
-- agent-reach 技能下线迁移（合并到 knowledge-collection 内置路由层）
-- 2026-08-18: agent-reach skill 已合并为 knowledge-collection/references/source-routing.md
-- ============================================================================

-- 1. 从 OPENCLAW_BUNDLED_SKILLS 配置中移除 agent-reach 条目。
--    先按空白归一化再整体替换，避免依赖交替分组等复杂正则特性。
UPDATE byai.byai_system_config
SET param_value = regexp_replace(
    regexp_replace(param_value, '\s', '', 'g'),
    ',?\{"skillName":"[^"]*","skillCode":"agent-reach","skillDescZh":"[^"]*","skillDescEn":"[^"]*"\}',
    '',
    'g'
)
WHERE param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(param_value, '\s', '', 'g') LIKE '%"skillCode":"agent-reach"%';

-- 2. 清理配置 JSON 可能出现的语法问题（数组首尾多余逗号）
UPDATE byai.byai_system_config
SET param_value = regexp_replace(
    regexp_replace(param_value, '\[,', '[', 'g'),
    ',\]', ']', 'g'
)
WHERE param_code = 'OPENCLAW_BUNDLED_SKILLS';

-- 3. 删除 agent-reach 资源的所有授权记录
DELETE FROM byai.au_privilege_grant
WHERE grant_obj_id IN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'agent-reach'
);

-- 4. 删除 agent-reach 的资源扩展记录（skill 元数据）
DELETE FROM byai.ss_res_ext_skill
WHERE resource_id IN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'agent-reach'
);

-- 5. 删除 agent-reach 资源本体
DELETE FROM byai.ss_resource
WHERE resource_code = 'agent-reach';

-- 验证查询（migration 执行后应各返回 0 行）
-- SELECT * FROM byai.ss_resource WHERE resource_code = 'agent-reach';
-- SELECT * FROM byai.byai_system_config WHERE param_code = 'OPENCLAW_BUNDLED_SKILLS' AND param_value LIKE '%agent-reach%';
-- SELECT g.* FROM byai.au_privilege_grant g JOIN byai.ss_resource r ON r.resource_id = g.grant_obj_id WHERE r.resource_code = 'agent-reach';
-- SELECT e.* FROM byai.ss_res_ext_skill e JOIN byai.ss_resource r ON r.resource_id = e.resource_id WHERE r.resource_code = 'agent-reach';

-- ============================================================================
-- by-skill-installer 内置技能注册
-- 2026-08-18: 按 skillCode 查平台内置技能并绑定到数字员工，让 agent 能使用该技能
-- 各步骤均按 resource_code 幂等执行，resource_id 由序列生成避免固定 ID 冲突
-- ============================================================================

-- 1. 追加到 OPENCLAW_BUNDLED_SKILLS，已存在同名 skillCode 时不重复追加
UPDATE byai.byai_system_config c
SET param_value = CASE
        WHEN rtrim(c.param_value) = '[]' THEN '['
        ELSE left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1) || ','
    END
    || '{"skillName":"by-skill-installer","skillCode":"by-skill-installer","skillDescZh":"按 skillCode 在平台查找内置技能并绑定到数字员工，让 agent 能使用该技能。","skillDescEn":"Look up built-in skills by skillCode and bind them to a digital employee so the agent can use them."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"by-skill-installer"%';

-- 2. 注册资源本体
INSERT INTO byai.ss_resource (
    resource_id, system_code, resource_biz_type, resource_type, resource_name,
    resource_desc, resource_version_id, host_type, catalog_id, man_org_id,
    man_user_id, create_by, create_time, update_by, update_time, com_acct_id,
    resource_status, resource_d_verid, resource_r_verid, resource_code,
    publish_time, auth_status, publish_portal, parent_resource_id, publish_type,
    owner_type, impl_type, worker_agent_type
)
SELECT
    nextval('byai.seq_any_table'), 'BYAI', 'SKILL', 'ATOM', '技能安装器',
    '按 skillCode 在平台查找内置技能并绑定到数字员工，让 agent 能使用该技能。',
    '1.0', 'hosted', 10, -1, '10001', 10001, CURRENT_TIMESTAMP,
    10001, CURRENT_TIMESTAMP, 1, 2, -1, -1, 'by-skill-installer',
    CURRENT_TIMESTAMP, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource
    WHERE resource_code = 'by-skill-installer'
);

-- 3. 补齐内置 Skill 扩展记录；skill_type=inner 表示随运行时镜像提供，无需下载
INSERT INTO byai.ss_res_ext_skill (
    resource_id, skill_type, source_type, version, skill_url,
    skill_package_format, skill_original_filename, skill_package_size,
    skill_package_hash, sync_status, sync_error, last_sync_time
)
SELECT
    r.resource_id, 'inner', 'SYSTEM_BUILTIN', 'v0.1', '', 'zip', NULL, NULL, NULL,
    'SUCCESS', NULL, CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
)
  AND r.resource_code = 'by-skill-installer';

-- 4. 重建运行期技能快照，避免资源 ID 曾被其他技能复用时残留错误 target_content
UPDATE byai.ss_res_ext_skill e
SET target_content = json_build_object(
    'resourceId', r.resource_id,
    'resourceCode', r.resource_code,
    'resourceName', r.resource_name,
    'resourceDesc', r.resource_desc,
    'resourceBizType', r.resource_biz_type,
    'resourceType', r.resource_type,
    'ownerType', r.owner_type,
    'sourceType', e.source_type,
    'skillType', e.skill_type,
    'skillUrl', e.skill_url,
    'version', e.version,
    'skillPackageFormat', e.skill_package_format,
    'skillOriginalFilename', e.skill_original_filename,
    'skillPackageSize', e.skill_package_size,
    'skillPackageHash', e.skill_package_hash,
    'syncStatus', e.sync_status,
    'syncError', e.sync_error,
    'lastSyncTime', to_char(e.last_sync_time, 'YYYY-MM-DD HH24:MI:SS')
)::text
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'by-skill-installer';

-- 5. 清理历史重复授权，保证脚本重放不会累积重复数据
DELETE FROM byai.au_privilege_grant
WHERE privilege_grant_id IN (
    SELECT privilege_grant_id
    FROM (
        SELECT g.privilege_grant_id,
               ROW_NUMBER() OVER (
                   PARTITION BY g.grant_obj_id, g.grant_type, g.grant_to_type,
                                g.grant_to_obj_id, g.grant_to_obj_type
                   ORDER BY g.privilege_grant_id DESC
               ) AS row_num
        FROM byai.au_privilege_grant g
        WHERE g.grant_obj_id = (
            SELECT resource_id FROM byai.ss_resource
            WHERE resource_code = 'by-skill-installer'
        )
    ) ranked
    WHERE ranked.row_num > 1
);

-- 6. 复制 knowledge-collection 的可用授权，使未传 ownerType 的技能列表也能发现该技能
INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type, allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'),
    g.grant_type, g.oper_type, g.grant_obj_type, installer.resource_id,
    g.eff_date, g.exp_date, g.status_cd, g.create_staff, g.create_date,
    g.update_staff, g.update_date, g.grant_to_type, g.grant_to_obj_id,
    g.grant_to_obj_type, g.allow_unsubscribe
FROM byai.au_privilege_grant g
CROSS JOIN (
    SELECT resource_id FROM byai.ss_resource
    WHERE resource_code = 'by-skill-installer'
) installer
CROSS JOIN (
    SELECT resource_id FROM byai.ss_resource
    WHERE resource_code = 'knowledge-collection'
) knowledge_collection
WHERE g.grant_obj_id = knowledge_collection.resource_id
  AND NOT EXISTS (
      SELECT 1
      FROM byai.au_privilege_grant existing
      WHERE existing.grant_obj_id = installer.resource_id
        AND existing.grant_type = g.grant_type
        AND existing.grant_to_type = g.grant_to_type
        AND existing.grant_to_obj_id = g.grant_to_obj_id
        AND existing.grant_to_obj_type = g.grant_to_obj_type
  );

-- 验证查询（migration 执行后应各返回 1 行）
-- SELECT * FROM byai.ss_resource WHERE resource_code = 'by-skill-installer';
-- SELECT e.* FROM byai.ss_res_ext_skill e JOIN byai.ss_resource r ON r.resource_id = e.resource_id WHERE r.resource_code = 'by-skill-installer';


-- 更新 TEMPLATE_DIGITAL_EMPLOYEE 配置，为个人助理和助手添加 by-skill-installer 技能
UPDATE byai.byai_system_config
SET param_value = '[
  {
    "name": "个人助理",
    "key": "BYCLAW_ASSISTANT",
    "ownerType": "personal",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": ["dws","by-skill-installer"],
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
    "relSkills": ["by-skill-installer"],
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
        "defaultValue": "将用户的自然语言问题拆解为一个或多个独立的子查询,并标注每个子查询的推理跳数(hop count),用于后续并行调度检索。"
      },
      {
        "name": "单跳问题处理",
        "key": "singleHop",
        "enName": "Single Hop Processing",
        "defaultValue": "指导单跳检索代理通过多轮检索收集充分证据,生成有据可查且无引用标记的自然语言回答。"
      },
      {
        "name": "多跳问题信息检索",
        "key": "multiHopSearch",
        "enName": "Multi-hop Search",
        "defaultValue": "指导多跳检索代理逐跳推理、逐跳检索,通过调用 next_hop 或 finalize 链接各步结论,最终完成链式问答。"
      },
      {
        "name": "多跳问题回答",
        "key": "multiHopSummary",
        "enName": "Multi-hop Summary",
        "defaultValue": "将多跳推理代理的逐跳结果(子问题、证据、结论)合成为一份结构完整、证据可追溯的最终报告。"
      },
      {
        "name": "复合问题回答",
        "key": "subanswerAggregator",
        "enName": "Composite Answer Aggregation",
        "defaultValue": "将多个子查询的回答整合为一份逻辑连贯、无引用标记的 Markdown 格式综合回答,直接回应用户的原始问题。"
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
]',
    update_time = CURRENT_TIMESTAMP
WHERE param_code = 'TEMPLATE_DIGITAL_EMPLOYEE';

-- 设置默认值为 personal
update ss_resource set owner_type ='personal' where owner_type is null;
