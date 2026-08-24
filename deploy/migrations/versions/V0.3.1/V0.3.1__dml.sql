-- V0.3.1 增量 DML：补齐连接器模板、内置 Skill 拆分及 Runtime Manifest。
-- INSERT/UPDATE 均带业务条件或存在性判断，避免重复执行时产生重复数据。

-- 初始化钉钉、飞书和企业微信连接器元信息，仅补充 connector_code 尚不存在的记录。
INSERT INTO byai.byai_connector_info (
    connector_id,
    connector_code,
    connector_name,
    description,
    connector_type,
    provider_code,
    skill_code,
    auth_mode,
    auth_config,
    request_config,
    runtime_manifest,
    sort
)
SELECT
    nextval('byai.seq_any_table'),
    seed.connector_code,
    seed.connector_name,
    seed.description,
    'SYSTEM',
    seed.provider_code,
    seed.skill_code,
    seed.auth_mode,
    seed.auth_config,
    '{}',
    seed.runtime_manifest,
    seed.sort
FROM (
    SELECT 'dingtalk' AS connector_code,
           '钉钉' AS connector_name,
           '通过 DWS 连接钉钉工作空间' AS description,
           'dws-dingtalk' AS provider_code,
           'dws' AS skill_code,
           'DEVICE_FLOW' AS auth_mode,
           '{}' AS auth_config,
           '{"authStorage":{"environment":{"DWS_CONFIG_DIR":"/by/.connector-auth/.dws/config","DWS_DISABLE_KEYCHAIN":"1","DWS_HOME":"/by/.connector-auth/.dws"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.dws","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"dingtalk","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["dws","auth","login","--device","--no-browser","--recommend","-y"]],"logout":[["dws","auth","reset","-y"]],"status":[["dws","auth","status","--format","json"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"dws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.52"}' AS runtime_manifest,
           10 AS sort
    UNION ALL
    SELECT 'lark', '飞书', '通过 lark-cli 连接飞书工作空间', 'lark-cli', 'fws', 'DEVICE_FLOW',
           '{}',
           '{"authStorage":{"environment":{"LARK_HOME":"/by/.connector-auth/.lark-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.lark-cli","owner":"user-sandbox-auth-job","runtimeMutation":"sandbox-native"},"id":"lark","runtime":{"authorizeIn":"user-sandbox","commands":{"configCheck":[["lark-cli","config","show"]],"configInitialize":[["lark-cli","config","init","--new","--force-init"]],"contextBind":[["lark-cli","config","bind","--source","openclaw","--identity","user-default","--force"]],"login":[["lark-cli","auth","login","--domain","all","--no-wait","--json"],["lark-cli","auth","login","--device-code","${deviceCode}","--json"]],"logout":[["lark-cli","auth","logout","--json"]],"status":[["lark-cli","auth","status","--json","--verify"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"fws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.84"}', 20
    UNION ALL
    SELECT 'wecom', '企业微信', '通过 wecom-cli 连接企业微信工作空间', 'wecom-cli', 'wecomcli', 'CLI_INIT',
           '{"authorizationTimeoutSeconds":120}' AS auth_config,
           '{"authStorage":{"environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.wecom-cli","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"wecom","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["wecom-cli","init","--noninteractive","--no-open"]],"logout":[["wecom-cli","cache","clear"]],"status":[["wecom-cli","cache","status"],["wecom-cli","contact","get_userlist","{}"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"wecomcli","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"0.1.9"}' AS runtime_manifest,
           30
) seed
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.byai_connector_info existing
    WHERE existing.connector_code = seed.connector_code
);

-- 已存在的连接器也同步最新的 Provider、Skill 和授权模板字段；连接器开关状态不在此处改写。
UPDATE byai.byai_connector_info
SET provider_code = CASE connector_code
        WHEN 'dingtalk' THEN 'dws-dingtalk'
        WHEN 'lark' THEN 'lark-cli'
        WHEN 'wecom' THEN 'wecom-cli'
    END,
    skill_code = CASE connector_code
        WHEN 'dingtalk' THEN 'dws'
        WHEN 'lark' THEN 'fws'
        WHEN 'wecom' THEN 'wecomcli'
    END,
    auth_mode = CASE connector_code
        WHEN 'dingtalk' THEN 'DEVICE_FLOW'
        WHEN 'lark' THEN 'DEVICE_FLOW'
        WHEN 'wecom' THEN 'CLI_INIT'
    END,
    auth_config = CASE connector_code
        WHEN 'dingtalk' THEN '{}'
        WHEN 'lark' THEN '{}'
        WHEN 'wecom' THEN '{"authorizationTimeoutSeconds":120}'
    END,
    runtime_manifest = CASE connector_code
        WHEN 'dingtalk' THEN '{"authStorage":{"environment":{"DWS_CONFIG_DIR":"/by/.connector-auth/.dws/config","DWS_DISABLE_KEYCHAIN":"1","DWS_HOME":"/by/.connector-auth/.dws"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.dws","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"dingtalk","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["dws","auth","login","--device","--no-browser","--recommend","-y"]],"logout":[["dws","auth","reset","-y"]],"status":[["dws","auth","status","--format","json"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"dws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.52"}'
        WHEN 'lark' THEN '{"authStorage":{"environment":{"LARK_HOME":"/by/.connector-auth/.lark-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.lark-cli","owner":"user-sandbox-auth-job","runtimeMutation":"sandbox-native"},"id":"lark","runtime":{"authorizeIn":"user-sandbox","commands":{"configCheck":[["lark-cli","config","show"]],"configInitialize":[["lark-cli","config","init","--new","--force-init"]],"contextBind":[["lark-cli","config","bind","--source","openclaw","--identity","user-default","--force"]],"login":[["lark-cli","auth","login","--domain","all","--no-wait","--json"],["lark-cli","auth","login","--device-code","${deviceCode}","--json"]],"logout":[["lark-cli","auth","logout","--json"]],"status":[["lark-cli","auth","status","--json","--verify"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"fws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.84"}'
        WHEN 'wecom' THEN '{"authStorage":{"environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.wecom-cli","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"wecom","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["wecom-cli","init","--noninteractive","--no-open"]],"logout":[["wecom-cli","cache","clear"]],"status":[["wecom-cli","cache","status"],["wecom-cli","contact","get_userlist","{}"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"wecomcli","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"0.1.9"}'
    END,
    request_config = '{}',
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('dingtalk', 'lark', 'wecom');

-- 知识采集默认绑定迁移到编排 Skill；仅迁移仍使用旧 bycli 绑定的内置资源。
UPDATE byai.ss_resource
SET resource_code = 'knowledge-collection',
    update_time = CURRENT_TIMESTAMP
WHERE resource_name = '知识采集'
  AND resource_code = 'bycli';

-- 同步修正运行期技能快照中的 resourceCode，保留其余 JSON 字段。
UPDATE byai.ss_res_ext_skill e
SET target_content = jsonb_set(
        target_content::jsonb,
        '{resourceCode}',
        '"knowledge-collection"'::jsonb,
        false
    )::text
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_name = '知识采集'
  AND r.resource_code = 'knowledge-collection'
  AND target_content IS NOT NULL
  AND target_content::jsonb ->> 'resourceCode' = 'bycli'
;

-- 修复 V0.2.0 种子中 coding-agent 描述的双重反斜杠，恢复 OPENCLAW_BUNDLED_SKILLS 为合法 JSON。
UPDATE byai.byai_system_config c
SET param_value = replace(
        c.param_value,
        chr(92) || chr(92) || chr(34) || 'acp' || chr(92) || chr(92) || chr(34),
        chr(92) || chr(34) || 'acp' || chr(92) || chr(34)
    )
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND position(
        (chr(92) || chr(92) || chr(34) || 'acp' || chr(92) || chr(92) || chr(34))
        IN c.param_value
      ) > 0;

-- openGauss 缺少 JSONB 聚合函数；逐项补齐内置 Skill，避免已有一项时跳过其他项。
UPDATE byai.byai_system_config c
SET param_value = CASE
        WHEN rtrim(c.param_value) = '[]' THEN '['
        ELSE left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1) || ','
    END
    || '{"skillName":"knowledge-collection","skillCode":"knowledge-collection","skillDescZh":"编排跨互联网与企业平台的知识采集，统一采集产物协议、后处理及知识库入库或知识整理。","skillDescEn":"Orchestrate knowledge collection across public internet and enterprise platforms, including canonical artifacts, post-processing, and knowledge-base ingestion or organization."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"knowledge-collection"%';

-- 补充公开互联网渠道路由 Skill，已存在同名 skillCode 时不重复追加。
UPDATE byai.byai_system_config c
SET param_value = left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1)
    || ',{"skillName":"agent-reach","skillCode":"agent-reach","skillDescZh":"路由公开互联网渠道能力，并按 ByClaw 覆盖规则选择 byCLI 等执行器。","skillDescEn":"Route public-internet channels and select executors such as byCLI according to ByClaw override rules."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"agent-reach"%';

-- 补充独立 byCLI 执行 Skill，避免继续把 bycli 与知识采集编排能力混为一体。
UPDATE byai.byai_system_config c
SET param_value = left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1)
    || ',{"skillName":"bycli","skillCode":"bycli","skillDescZh":"通过浏览器与 Adapter 执行网站操作、复用或维护适配器，并返回采集结果。","skillDescEn":"Execute website operations through the browser and adapters, reuse or maintain adapters, and return collected results."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"bycli"%';

-- 初始化独立 bycli 执行 Skill 资源，保留 knowledge-collection 作为默认编排资源。
-- resource_id 由序列生成，避免与既有资源（例如 add-related-docs）发生固定 ID 冲突。
INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
SELECT nextval('byai.seq_any_table'),'BYAI','SKILL','ATOM','byCLI','通过浏览器与 Adapter 执行网站操作、复用或维护适配器，并返回采集结果。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'bycli',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE'
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.ss_resource
    WHERE resource_code = 'bycli'
);

-- 为新增的 byCLI 资源补齐内置 Skill 扩展记录；按 resource_code 获取真实 resource_id。
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time)
SELECT r.resource_id,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
)
  AND r.resource_code = 'bycli';

-- 修正 bycli 运行期技能快照，避免资源 ID 曾被其他技能复用时残留错误 target_content。
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
  AND r.resource_code = 'bycli';

-- 复制知识采集 Skill 的可用授权，使未传 ownerType 的技能列表也能发现 bycli。
-- 清理历史重复授权，保留同一业务授权键的最新记录，保证脚本重放不会累积重复数据。
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
        WHERE g.grant_obj_id = (SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'bycli')
    ) ranked
    WHERE ranked.row_num > 1
);

INSERT INTO byai.au_privilege_grant (
    privilege_grant_id,
    grant_type,
    oper_type,
    grant_obj_type,
    grant_obj_id,
    eff_date,
    exp_date,
    status_cd,
    create_staff,
    create_date,
    update_staff,
    update_date,
    grant_to_type,
    grant_to_obj_id,
    grant_to_obj_type,
    allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'),
    g.grant_type,
    g.oper_type,
    g.grant_obj_type,
    bycli.resource_id,
    g.eff_date,
    g.exp_date,
    g.status_cd,
    g.create_staff,
    g.create_date,
    g.update_staff,
    g.update_date,
    g.grant_to_type,
    g.grant_to_obj_id,
    g.grant_to_obj_type,
    g.allow_unsubscribe
FROM byai.au_privilege_grant g
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'bycli'
) bycli
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'knowledge-collection'
) knowledge_collection
WHERE g.grant_obj_id = knowledge_collection.resource_id
  AND NOT EXISTS (
      SELECT 1
      FROM byai.au_privilege_grant existing
      WHERE existing.grant_obj_id = bycli.resource_id
        AND existing.grant_type = g.grant_type
        AND existing.grant_to_type = g.grant_to_type
        AND existing.grant_to_obj_id = g.grant_to_obj_id
        AND existing.grant_to_obj_type = g.grant_to_obj_type
  );

-- 注册 agent-reach 为可被资源授权接口查询的内置 Skill。
-- resource_id 由序列生成，避免依赖固定 ID；各步骤均按 resource_code 幂等执行。
INSERT INTO byai.ss_resource (
    resource_id, system_code, resource_biz_type, resource_type, resource_name,
    resource_desc, resource_version_id, host_type, catalog_id, man_org_id,
    man_user_id, create_by, create_time, update_by, update_time, com_acct_id,
    resource_status, resource_d_verid, resource_r_verid, resource_code,
    publish_time, auth_status, publish_portal, parent_resource_id, publish_type,
    owner_type, impl_type, worker_agent_type
)
SELECT
    nextval('byai.seq_any_table'), 'BYAI', 'SKILL', 'ATOM', 'agent-reach',
    '路由公开互联网渠道能力，并按 ByClaw 覆盖规则选择 byCLI 等执行器。',
    '1.0', 'hosted', 10, -1, '10001', 10001, CURRENT_TIMESTAMP,
    10001, CURRENT_TIMESTAMP, 1, 2, -1, -1, 'agent-reach',
    CURRENT_TIMESTAMP, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource
    WHERE resource_code = 'agent-reach'
);

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
  AND r.resource_code = 'agent-reach';

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

-- 复制 knowledge-collection 的可用授权，使未传 ownerType 的技能列表也能发现 agent-reach。
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
        WHERE g.grant_obj_id = (SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'agent-reach')
    ) ranked
    WHERE ranked.row_num > 1
);

INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type,
    allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'),
    g.grant_type, g.oper_type, g.grant_obj_type, agent_reach.resource_id, g.eff_date, g.exp_date,
    g.status_cd, g.create_staff, g.create_date, g.update_staff, g.update_date,
    g.grant_to_type, g.grant_to_obj_id, g.grant_to_obj_type, g.allow_unsubscribe
FROM byai.au_privilege_grant g
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'agent-reach'
) agent_reach
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'knowledge-collection'
) knowledge_collection
WHERE g.grant_obj_id = knowledge_collection.resource_id
  AND NOT EXISTS (
      SELECT 1 FROM byai.au_privilege_grant existing
      WHERE existing.grant_obj_id = agent_reach.resource_id
        AND existing.grant_type = g.grant_type
        AND existing.grant_to_type = g.grant_to_type
        AND existing.grant_to_obj_id = g.grant_to_obj_id
        AND existing.grant_to_obj_type = g.grant_to_obj_type
  );

-- 将飞书 Lark 授权执行归属迁移到用户 OpenClaw 沙箱。
-- 通过幂等 JSONB 更新兼容已存在的 Lark Runtime Manifest。
UPDATE byai.byai_connector_info
SET runtime_manifest = jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    runtime_manifest::jsonb,
                    '{runtime,authorizeIn}',
                    '"user-sandbox"'::jsonb,
                    true
                ),
                '{authStorage,owner}',
                '"user-sandbox-auth-job"'::jsonb,
                true
            ),
            '{authStorage,runtimeMutation}',
            '"sandbox-native"'::jsonb,
            true
        ),
        '{runtime,commands,login}',
        '["lark-cli","auth","login","--domain","all","--no-wait","--json"]'::jsonb,
        true
    )::text,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code = 'lark'
  AND runtime_manifest IS NOT NULL;
