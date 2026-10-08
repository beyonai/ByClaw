-- 邮箱连接器相关 DML 统一归属 V0.5.0；保留原 advisory lock 键以兼容旧版本并发重放。
-- Mail 内置 Skill 注册开始
-- CLI、provider runtime 与托管 byCLI adapter 均随 OpenClaw 镜像提供；本段只注册可发现资源和授权。
-- 会话锁覆盖自动提交模式下的多条 SQL；事务锁兼容外层事务，提交前不允许其他会话重放。
-- 使用同一连接顺序执行；失败时停止并关闭连接以释放会话锁，整体回滚由调用方事务负责。
SELECT pg_advisory_lock(hashtext('byclaw'), hashtext('V0.4.0:mail-skill'));
SELECT pg_advisory_xact_lock(hashtext('byclaw'), hashtext('V0.4.0:mail-skill'));

-- 仅修改合法 JSON 数组；NULL/非数组保持原值，非法 JSON 在显式 ::jsonb 转换时失败。
UPDATE byai.byai_system_config c
SET param_value = (
    jsonb_insert(c.param_value::jsonb, '{999999}', json_build_object(
        'skillName', 'Mail',
        'skillCode', 'mail',
        'skillDescZh', '通过统一邮箱运行时安全地读取和管理邮件。',
        'skillDescEn', 'Read and manage email safely through the unified mail runtime.'
    )::jsonb
)::text)
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND jsonb_typeof(c.param_value::jsonb) = 'array'
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
          CASE
              WHEN jsonb_typeof(c.param_value::jsonb) = 'array' THEN c.param_value::jsonb
              ELSE '[]'::jsonb
          END
      ) elem
      WHERE elem ->> 'skillCode' = 'mail'
  );

INSERT INTO byai.ss_resource (
    resource_id, system_code, resource_biz_type, resource_type, resource_name,
    resource_desc, resource_version_id, host_type, catalog_id, man_org_id,
    man_user_id, create_by, create_time, update_by, update_time, com_acct_id,
    resource_status, resource_d_verid, resource_r_verid, resource_code,
    publish_time, auth_status, publish_portal, parent_resource_id, publish_type,
    owner_type, impl_type, worker_agent_type
)
SELECT
    nextval('byai.seq_any_table'), 'BYAI', 'SKILL', 'ATOM', 'Mail',
    '通过统一邮箱运行时安全地读取和管理邮件。',
    '1.0.0', 'hosted', 10, -1, '10001', 10001, CURRENT_TIMESTAMP,
    10001, CURRENT_TIMESTAMP, 1, 2, -1, -1, 'mail',
    CURRENT_TIMESTAMP, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource WHERE resource_code = 'mail'
);

-- 规范资源取最小 resource_id。授权先重定向，再清理重复扩展和资源。
UPDATE byai.au_privilege_grant
SET grant_obj_id = (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'mail'
    ORDER BY resource_id
    LIMIT 1
)
WHERE grant_obj_id IN (
    SELECT resource_id FROM byai.ss_resource WHERE resource_code = 'mail'
)
  AND grant_obj_id <> (
      SELECT resource_id
      FROM byai.ss_resource
      WHERE resource_code = 'mail'
      ORDER BY resource_id
      LIMIT 1
  );

-- 重定向后按授权业务键去重，保留 ID 最小的历史记录并在后文刷新状态。
DELETE FROM byai.au_privilege_grant
WHERE privilege_grant_id IN (
    SELECT privilege_grant_id
    FROM (
        SELECT g.privilege_grant_id,
               ROW_NUMBER() OVER (
                   PARTITION BY g.grant_obj_id, g.grant_type, g.grant_to_type,
                                g.grant_to_obj_id, g.grant_to_obj_type
                   ORDER BY g.privilege_grant_id
               ) AS row_num
        FROM byai.au_privilege_grant g
        WHERE g.grant_obj_id = (
            SELECT resource_id
            FROM byai.ss_resource
            WHERE resource_code = 'mail'
            ORDER BY resource_id
            LIMIT 1
        )
    ) ranked
    WHERE ranked.row_num > 1
);

DELETE FROM byai.ss_res_ext_skill
WHERE resource_id IN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'mail'
      AND resource_id <> (
          SELECT resource_id
          FROM byai.ss_resource
          WHERE resource_code = 'mail'
          ORDER BY resource_id
          LIMIT 1
      )
);

DELETE FROM byai.ss_resource
WHERE resource_code = 'mail'
  AND resource_id <> (
      SELECT resource_id
      FROM byai.ss_resource
      WHERE resource_code = 'mail'
      ORDER BY resource_id
      LIMIT 1
  );

UPDATE byai.ss_resource
SET system_code = 'BYAI',
    resource_biz_type = 'SKILL',
    resource_type = 'ATOM',
    resource_name = 'Mail',
    resource_desc = '通过统一邮箱运行时安全地读取和管理邮件。',
    resource_version_id = '1.0.0',
    host_type = 'hosted',
    catalog_id = 10,
    man_org_id = -1,
    man_user_id = '10001',
    update_by = 10001,
    update_time = CURRENT_TIMESTAMP,
    com_acct_id = 1,
    resource_status = 2,
    resource_d_verid = -1,
    resource_r_verid = -1,
    publish_time = CURRENT_TIMESTAMP,
    auth_status = 'passed',
    publish_portal = 1,
    parent_resource_id = -1,
    publish_type = 'publish',
    owner_type = 'enterprise',
    impl_type = 'SKILL',
    worker_agent_type = 'NONE'
WHERE resource_code = 'mail';

INSERT INTO byai.ss_res_ext_skill (
    resource_id, skill_type, source_type, version, skill_url,
    skill_package_format, skill_original_filename, skill_package_size,
    skill_package_hash, sync_status, sync_error, last_sync_time
)
SELECT
    r.resource_id, 'inner', 'SYSTEM_BUILTIN', '1.0.0', '', 'zip', NULL, NULL, NULL,
    'SUCCESS', NULL, CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
)
  AND r.resource_code = 'mail';

UPDATE byai.ss_res_ext_skill e
SET skill_type = 'inner',
    source_type = 'SYSTEM_BUILTIN',
    version = '1.0.0',
    skill_url = '',
    skill_package_format = 'zip',
    skill_original_filename = NULL,
    skill_package_size = NULL,
    skill_package_hash = NULL,
    sync_status = 'SUCCESS',
    sync_error = NULL,
    last_sync_time = CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'mail';

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
  AND r.resource_code = 'mail';

-- 复制 dws 的现有可见授权；每个授权维度都以 NOT EXISTS 防止重放产生重复行。
INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type, allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'),
    g.grant_type, g.oper_type, g.grant_obj_type, mail.resource_id,
    g.eff_date, g.exp_date, g.status_cd, g.create_staff, g.create_date,
    g.update_staff, g.update_date, g.grant_to_type, g.grant_to_obj_id,
    g.grant_to_obj_type, g.allow_unsubscribe
FROM (
    SELECT DISTINCT ON (
        source.grant_type, source.grant_to_type,
        source.grant_to_obj_id, source.grant_to_obj_type
    ) source.*
    FROM byai.au_privilege_grant source
    CROSS JOIN (
        SELECT resource_id
        FROM byai.ss_resource
        WHERE resource_code = 'dws'
        ORDER BY resource_id
        LIMIT 1
    ) source_dws
    WHERE source.grant_obj_id = source_dws.resource_id
    ORDER BY source.grant_type, source.grant_to_type,
             source.grant_to_obj_id, source.grant_to_obj_type,
             source.privilege_grant_id
) g
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'mail'
    ORDER BY resource_id
    LIMIT 1
) mail
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'dws'
    ORDER BY resource_id
    LIMIT 1
) dws
WHERE g.grant_obj_id = dws.resource_id
  AND NOT EXISTS (
      SELECT 1
      FROM byai.au_privilege_grant existing
      WHERE existing.grant_obj_id = mail.resource_id
        AND existing.grant_type IS NOT DISTINCT FROM g.grant_type
        AND existing.grant_to_type IS NOT DISTINCT FROM g.grant_to_type
        AND existing.grant_to_obj_id IS NOT DISTINCT FROM g.grant_to_obj_id
        AND existing.grant_to_obj_type IS NOT DISTINCT FROM g.grant_to_obj_type
  );

-- dws 尚未初始化授权时，至少授予内置管理员使用和管理权限。
INSERT INTO byai.au_privilege_grant (
    privilege_grant_id, grant_type, oper_type, grant_obj_type, grant_obj_id,
    eff_date, exp_date, status_cd, create_staff, create_date, update_staff,
    update_date, grant_to_type, grant_to_obj_id, grant_to_obj_type, allow_unsubscribe
)
SELECT
    nextval('byai.seq_any_table'), fallback.grant_type, 'READ', 'SKILL', mail.resource_id,
    CURRENT_TIMESTAMP, NULL, 'A', 10001, CURRENT_TIMESTAMP, 10001, CURRENT_TIMESTAMP,
    'RED', 10001, 'USER', 'Y'
FROM (VALUES ('AVAILABLE_USE'), ('ALLOW_MANAGE')) AS fallback(grant_type)
CROSS JOIN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'mail'
    ORDER BY resource_id
    LIMIT 1
) mail
WHERE NOT EXISTS (
    SELECT 1 FROM byai.au_privilege_grant existing
    WHERE existing.grant_obj_id = mail.resource_id
      AND existing.grant_type IS NOT DISTINCT FROM fallback.grant_type
      AND existing.grant_to_type IS NOT DISTINCT FROM 'RED'
      AND existing.grant_to_obj_id IS NOT DISTINCT FROM 10001
      AND existing.grant_to_obj_type IS NOT DISTINCT FROM 'USER'
);

-- mail 内置技能的既有授权统一恢复为当前有效状态。
UPDATE byai.au_privilege_grant g
SET oper_type = 'READ',
    grant_obj_type = 'SKILL',
    status_cd = 'A',
    update_staff = 10001,
    update_date = CURRENT_TIMESTAMP,
    allow_unsubscribe = 'Y'
WHERE g.grant_obj_id = (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'mail'
    ORDER BY resource_id
    LIMIT 1
);

SELECT pg_advisory_unlock(hashtext('byclaw'), hashtext('V0.4.0:mail-skill'));
-- Mail 内置 Skill 注册结束

-- 合并 V0.4.0 的七个邮箱连接器种子，保留原 runtime_manifest 的授权与投影约定。
-- 连接器不存在时补建最小系统记录；随后统一配置新旧记录，保证首次部署也写入完整 auth_config。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort, status_cd
)
SELECT nextval('byai.seq_any_table'), v.code, v.name, v.description, 'SYSTEM',
       v.provider, 'mail', v.mode, v.config, '{}',
       CASE WHEN v.mode = 'OAUTH2' THEN
         json_build_object('schemaVersion','1.0','id',v.code,'version','1.0.0',
           'runtime',json_build_object('type','oauth2','authorizeIn','be-auth-job'),
           'authStorage',json_build_object('mode','credential-reference','owner','be-auth-job',
             'runtimeMutation','shared-volume-projection',
             'projectionPath','/by/.connector-auth/.' || v.code || '/credential.json','environment',json_build_object()),
           'skill',json_build_object('code','mail','source','system-builtin','installScope','user','grantScope','agent'))::text
       ELSE
         json_build_object('schemaVersion','1.0','id',v.code,'version','1.0.0',
           'runtime',json_build_object('type','mail','provider',v.runtime_provider),
           'authStorage',json_build_object('mode','credential-reference','projectionPath','/by/.connector-auth/.mail/accounts.json'))::text
       END,
       v.sort, CASE WHEN v.code IN ('aliyun-mail','microsoft-mail','fastmail-mail','custom-imap-mail') THEN '00X' ELSE '00A' END
FROM (VALUES
 ('gmail-mail','Gmail','通过 OAuth2 连接 Gmail 用户账号','gmail-oauth2','OAUTH2','{}','gmail',60),
 ('microsoft-mail','Microsoft 365','通过 OAuth2 连接 Microsoft 365 用户账号','microsoft-mail-oauth2','OAUTH2','{}','microsoft',61),
 ('fastmail-mail','Fastmail','通过 API Token 连接 Fastmail 用户账号','mail-form','AK_SK','{}','fastmail',62),
 ('qq-mail','QQ 邮箱','通过 IMAP/SMTP 连接 QQ 邮箱','mail-form','AK_SK','{}','qq',63),
 ('netease-163-mail','网易 163 邮箱','通过 IMAP/SMTP 连接网易 163 邮箱','mail-form','AK_SK','{}','netease-163',64),
 ('aliyun-mail','阿里邮箱','通过 IMAP/SMTP 连接阿里邮箱','mail-form','AK_SK','{}','aliyun-mail',65),
 ('custom-imap-mail','自定义 IMAP','通过自定义 IMAP/SMTP 服务器连接邮箱','mail-form','AK_SK','{}','custom-imap',66)
) AS v(code,name,description,provider,mode,config,runtime_provider,sort)
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_connector_info i WHERE i.connector_code=v.code);

-- V0.5.0 邮箱连接器迁移，仅维护连接器目录，不迁移历史邮箱账号。
-- 表单字段配置需满足前端校验器：HTTPS helpUrl、text/password 类型及 maxLength。
-- 阿里邮箱、Microsoft 365、Fastmail、自定义 IMAP 暂不可用；其他已有连接器保持原状态。
UPDATE byai.byai_connector_info
SET provider_code = CASE WHEN connector_code='gmail-mail' THEN 'gmail-oauth2' WHEN connector_code='microsoft-mail' THEN 'microsoft-mail-oauth2' ELSE 'mail-form' END,
    status_cd = CASE WHEN connector_code IN ('aliyun-mail','microsoft-mail','fastmail-mail','custom-imap-mail') THEN '00X' ELSE status_cd END,
    auth_mode = CASE WHEN connector_code IN ('gmail-mail','microsoft-mail') THEN 'OAUTH2' ELSE 'AK_SK' END,
    auth_config = CASE
      WHEN connector_code='gmail-mail' THEN '{"clientIdEnv":"GMAIL_OAUTH_CLIENT_ID","clientSecretEnv":"GMAIL_OAUTH_CLIENT_SECRET","redirectUriEnv":"GMAIL_OAUTH_REDIRECT_URI","scope":"openid email profile https://www.googleapis.com/auth/gmail.modify","credentialForm":{"helpUrl":"https://support.google.com/accounts/answer/14012355?hl=zh-Hans","helpLinkText":"查看 Google 账号授权说明","helpText":"连接器作用：连接你的 Gmail，让数字员工按任务检索邮件、整理摘要、读取正文和下载附件；也可按你的指令发送、回复邮件或移入垃圾箱，实际能力以授权范围为准。\n\n获取步骤：\n1. 点击本页“立即前往授权”，在 Google 官方页面登录要连接的邮箱账号。\n2. 核对账号和应用名称，阅读并确认所需邮箱权限。\n3. 完成授权后返回 ByClaw，等待连接状态更新；未刷新时点击“我已完成授权，立即检查”。\n4. 连接成功后，可让数字员工查看今天收到的邮件或按主题搜索。\n\n注意事项：无需在 ByClaw 填写 Google 密码、应用专用密码或客户端密钥。若组织策略限制授权，请联系 Google Workspace 管理员；若提示应用未配置，请联系平台管理员。可在 Google 账号的第三方连接中撤销授权。","fields":[]}}'
      WHEN connector_code='microsoft-mail' THEN '{"clientIdEnv":"MICROSOFT_MAIL_CLIENT_ID","clientSecretEnv":"MICROSOFT_MAIL_CLIENT_SECRET","redirectUriEnv":"MICROSOFT_MAIL_REDIRECT_URI","scope":"openid profile email offline_access User.Read Mail.ReadWrite Mail.Send"}'
      WHEN connector_code='fastmail-mail' THEN '{"credentialForm":{"helpUrl":"https://www.fastmail.com/","helpLinkText":"前往 Fastmail","helpText":"请使用自己的 Fastmail 邮箱地址和 API Token。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='qq-mail' THEN '{"credentialForm":{"helpUrl":"https://mail.qq.com/","helpLinkText":"前往 QQ 邮箱获取授权码","helpText":"连接器作用：通过 IMAP/SMTP 连接你的 QQ 邮箱，让数字员工检索邮件、整理摘要、读取正文和下载附件；也可按你的指令发送、回复邮件。移入垃圾箱等操作以邮箱支持的能力为准。\n\n获取步骤：\n1. 点击下方链接，在浏览器登录要连接的 QQ 邮箱。\n2. 进入“设置” → “账户”，找到 POP3/IMAP/SMTP 等服务设置；新版界面可在账号或安全设置中查找。\n3. 开启 IMAP/SMTP 服务，按页面提示完成身份验证并生成授权码。\n4. 返回本页，填写完整邮箱地址和刚生成的授权码，点击“保存并连接”。\n5. 连接后可让数字员工查询账号并检查连接，再读取邮件。\n\n安全提示：授权码用于第三方客户端，不是 QQ 登录密码。请仅填入本页授权码输入框，不要发送到聊天或截图。撤销或重置后需更新连接凭据；若连接失败，先检查服务开关、账号和授权码是否对应。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='netease-163-mail' THEN '{"credentialForm":{"helpUrl":"https://mail.163.com/","helpLinkText":"前往 163 邮箱获取授权码","helpText":"连接器作用：通过 IMAP/SMTP 连接你的网易 163 邮箱，让数字员工检索邮件、整理摘要、读取正文和下载附件；也可按你的指令发送、回复邮件。移入垃圾箱等操作以邮箱支持的能力为准。\n\n获取步骤：\n1. 点击下方链接，在浏览器登录要连接的 163 邮箱。\n2. 进入“设置”，找到“POP3/SMTP/IMAP”或客户端授权设置。\n3. 开启 IMAP/SMTP 服务，按页面提示完成手机等身份验证，获取客户端授权码。\n4. 返回本页，填写完整的 @163.com 邮箱地址和授权码，点击“保存并连接”。\n5. 连接后可让数字员工查询账号并检查连接，再读取邮件。\n\n安全提示：请使用客户端授权码，不是邮箱网页登录密码。不要把授权码发送到聊天、截图或工单。撤销或重置后需更新连接凭据；若提示客户端访问受限，先检查邮箱服务设置并联系平台管理员排查，不要反复重置授权码。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='aliyun-mail' THEN '{"credentialForm":{"helpUrl":"https://qiye.aliyun.com/","helpLinkText":"前往阿里邮箱获取安全密码","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"安全密码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='custom-imap-mail' THEN '{"credentialForm":{"helpUrl":"https://www.rfc-editor.org/rfc/rfc9051","helpLinkText":"查看 IMAP 配置说明","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"应用专用密码","inputType":"password","maxLength":2048,"required":true},{"key":"imapHost","label":"IMAP 地址","inputType":"text","maxLength":255,"required":true},{"key":"imapPort","label":"IMAP 端口","inputType":"text","maxLength":5,"required":true},{"key":"imapEncryption","label":"IMAP 加密方式","inputType":"text","maxLength":10,"required":true},{"key":"smtpHost","label":"SMTP 地址","inputType":"text","maxLength":255,"required":true},{"key":"smtpPort","label":"SMTP 端口","inputType":"text","maxLength":5,"required":true},{"key":"smtpEncryption","label":"SMTP 加密方式","inputType":"text","maxLength":10,"required":true}]}}'
      ELSE auth_config END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('gmail-mail','microsoft-mail','fastmail-mail','qq-mail','netease-163-mail','aliyun-mail','custom-imap-mail');

-- 浩鲸邮箱网页账号模板开始
-- 沿用 IMA 的网页账号机制；登录态由账号浏览器持有，不生成 mail 凭据投影。
-- 重放不覆盖已有名称、配置或停用状态；用户级账号仍由模板服务按历史去重初始化。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort, status_cd
)
SELECT nextval('byai.seq_any_table'), 'iwhalecloud-mail-web', '浩鲸邮箱',
       '登录浩鲸邮箱网页端，通过 bycli 读取邮件和下载附件', 'ACCOUNT_TEMPLATE',
       NULL, NULL, 'NONE', '{}',
       '{"operationAccount":{"platformCode":"CustomLink","accountName":"浩鲸邮箱","accountCode":"","customUrl":"https://mail.iwhalecloud.com/"}}',
       NULL, 67, '00A'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_connector_info WHERE connector_code = 'iwhalecloud-mail-web'
);
-- 浩鲸邮箱网页账号模板结束

-- 下线 IMA OpenAPI 连接器，清理其受管参数和授权；保留 ima-web 及用户网页账号。
-- 删除顺序保证先清理关联记录；可重复执行。
DELETE FROM byai.po_user_private_param
WHERE param_source = 'CONNECTOR' AND source_ref = 'ima-openapi';

DELETE FROM byai.byai_connector_credential_secret
WHERE connector_id IN (
    SELECT connector_id FROM byai.byai_connector_info WHERE connector_code = 'ima-openapi'
);

DELETE FROM byai.byai_connector_auth
WHERE connector_id IN (
    SELECT connector_id FROM byai.byai_connector_info WHERE connector_code = 'ima-openapi'
);

DELETE FROM byai.byai_connector_info WHERE connector_code = 'ima-openapi';

-- 禁用openclaw的cron子系统，改用 byclaw-cron-schedule
DELETE FROM "byai"."sandbox_service_spec" WHERE "service_key" = 'openclaw';
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES (
    'openclaw',
    '{"env": {"OPENCLAW_SKIP_CRON": 1,"TZ": "Asia/Shanghai","LANG": "zh_CN","MODEL_ID": "${MODEL_ID}","NODE_ENV": "production","USER_CODE": "${user_code}","MODEL_NAME": "${MODEL_NAME}","REDIS_HOST": "${REDIS_HOST}","REDIS_PORT": "${REDIS_PORT}","REDIS_CLUSTER_HOST": "${REDIS_CLUSTER_HOST}","REDIS_KEY_SCHEMA_VERSION": "${REDIS_KEY_SCHEMA_VERSION}","DEMO_SCHEMA": "${DEMO_SCHEMA}","GBRAIN_HOME": "/by/.openclaw/gbrain","MODEL_ALIAS": "${MODEL_ALIAS}","OPENCLAW_TZ": "Asia/Shanghai","BEYOND_TOKEN": "${BEYOND_TOKEN}","GBRAIN_MODEL": "openai:qwen-turbo","BE_DOMAINNAME": "${BE_DOMAINNAME}","QA_DOMAINNAME": "${QA_DOMAINNAME}","DATACLOUD_DOMAINNAME": "${DATACLOUD_DOMAINNAME}","MODEL_API_KEY": "${MODEL_API_KEY}","DWS_CONFIG_DIR": "/by/.openclaw/.dws","MODEL_BASE_URL": "${MODEL_BASE_URL}","REDIS_DATABASE": "${REDIS_DATABASE}","REDIS_PASSWORD": "${REDIS_PASSWORD}","REDIS_USERNAME": "${REDIS_USERNAME}","BAIYING_SESSION": "${BAIYING_SESSION}","FILEBROWSER_ROOT": "/by","DATACLOUD_DB_HOST": "${DB_HOST}","DATACLOUD_DB_PASS": "${DB_PASS}","DATACLOUD_DB_PORT": "${DB_PORT}","DATACLOUD_DB_TYPE": "${DB_TYPE}","DATACLOUD_DB_USER": "${DB_USER}","LANGFUSE_BASE_URL": "${LANGFUSE_BASE_URL}","BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}","OPENCLAW_STATE_DIR": "/by/.openclaw","DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}","LANGFUSE_PUBLIC_KEY": "${LANGFUSE_PUBLIC_KEY}","LANGFUSE_SECRET_KEY": "${LANGFUSE_SECRET_KEY}","DATACLOUD_DB_DATABASE": "${DB_DATABASE}","DATACLOUD_DB_PASSWORD": "${DB_PASS}","GBRAIN_EMBEDDING_MODEL": "openai:text-embedding-v4","OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}","LANGFUSE_OTEL_AUTH_SECRET": "${LANGFUSE_OTEL_AUTH_SECRET}","GBRAIN_EMBEDDING_DIMENSIONS": "1024","BYCLAW_SANDBOX_FILE_VOLUME_ROOT": "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}","DEFAULT_LLM_IDLE_TIMEOUT_SECONDS": 360},"image": "ghcr.io/beyonai/byclaw/byclaw-openclaw:latest","ports": [{"port": 8080,"instance": "openclaw","protocol": "http"},{"port": 8081,"instance": "vnc","protocol": "http"},{"port": 8082,"instance": "filebrowser","protocol": "http"},{"port": 9222,"protocol": "http"},{"port": 19825,"instance": "bycli","protocol": "http"}],"startup": {"entrypoint": ["/bin/sh","-c","umask 0000; mkdir -p /by/.sessions /by/.openclaw /by/.claude /by/.byclaw ; rm -r /by/.openclaw/openclaw.json.*; chmod 777 /by /by/.sessions /by/.openclaw /by/.claude /by/.byclaw 2>/dev/null || true; exec /usr/local/bin/startAll.sh"]},"timeout": 3000,"volumes": [{"key": "base","scope": "PRIVATE","subPath": "byclaw-${user_code}/by","hostPath": "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}","readOnly": false,"mountPath": "/by"}],"bootstrap": {"copyTemplate": {"copyIfMissing": true,"targetVolumeKey": "base"}},"sandboxType": "byclaw","servicePort": 8080,"resourceLimits": {"cpu": "0.5","memory": "1Gi"}}',
    '{"mcp": {"servers": {"env": {"GBRAIN_HOME": "/by/.openclaw/gbrain"},"gbrain": {"args": ["serve"],"command": "gbrain"}}},"meta": {"lastTouchedAt": "2026-07-17T09:07:17.583Z","lastTouchedVersion": "2026.6.6"},"hooks": {"internal": {"enabled": true,"entries": {"boot-md": {"enabled": false},"session-memory": {"enabled": true}}}},"tools": {"web": {"search": {"enabled": false}},"profile": "full"},"agents": {"list": [{"id": "main","skills": [],"default": true,"workspace": "${OPENCLAW_STATE_DIR}/workspace"}],"defaults": {"model": {},"models": {},"subagents": {"maxConcurrent": 8},"compaction": {"mode": "safeguard","memoryFlush": {"enabled": true},"postIndexSync": "await"},"memorySearch": {"store": {"fts": {"tokenizer": "trigram"}},"sources": ["memory","sessions"],"provider": "none","experimental": {"sessionMemory": true}},"maxConcurrent": 4,"skipBootstrap": true,"verboseDefault": "full","thinkingDefault": "high","blockStreamingBreak": "text_end","blockStreamingDefault": "on"}},"models": {"providers": {}},"skills": {"load": {"watch": true,"watchDebounceMs": 5000},"install": {"nodeManager": "pnpm"},"workshop": {"approvalPolicy": "auto"}},"wizard": {"lastRunAt": "2026-02-03T07:41:55.092Z","lastRunMode": "local","lastRunCommand": "configure","lastRunVersion": "2026.1.30"},"browser": {"enabled": true,"headless": false,"profiles": {"openclaw": {"color": "#1677FF","driver": "openclaw","cdpPort": 9222,"headless": false,"executablePath": "/usr/bin/chromium"}},"extraArgs": ["--load-extension=/opt/opencli/extension","--disable-extensions-except=/opt/opencli/extension","--disable-dev-shm-usage","--window-size=1365,768","--display=:99"],"noSandbox": true,"ssrfPolicy": {"allowedHostnames": ["localhost","127.0.0.1"]},"defaultProfile": "openclaw","executablePath": "/usr/bin/chromium","localLaunchTimeoutMs": 60000,"localCdpReadyTimeoutMs": 60000},"gateway": {"auth": {"mode": "token","token": "${OPENCLAW_GATEWAY_TOKEN}"},"bind": "lan","mode": "local","port": 18789,"controlUi": {"allowedOrigins": ["*"],"allowInsecureAuth": true,"dangerouslyDisableDeviceAuth": true,"dangerouslyAllowHostHeaderOriginFallback": true},"tailscale": {"mode": "off","resetOnExit": false}},"logging": {"file": "/by/.openclaw/logs/openclaw-yyyy-MM-dd.log","level": "info","maxFileBytes": 104857600},"plugins": {"load": {"paths": ["/app/dist-runtime/extensions/baiying-enhance","/app/dist-runtime/extensions/byai-channel","/app/dist-runtime/extensions/byclaw-acp-adapter"]},"allow": ["browser","byai-channel","baiying-enhance","diagnostics-otel","byclaw-acp-adapter","memory-core"],"slots": {"memory": "memory-core"},"enabled": true,"entries": {"xai": {"enabled": false},"browser": {"enabled": true},"memory-core": {"enabled": true},"byai-channel": {"hooks": {"allowConversationAccess": true},"enabled": true},"baiying-enhance": {"hooks": {"allowConversationAccess": true},"config": {"watchDebounceMs": 500,"mainParentAgentId": "main","workspaceAutoSeed": true,"embedApiKeysFromJson": true,"mergeAllowSpawnForMain": true},"enabled": true},"diagnostics-otel": {"enabled": false},"byclaw-acp-adapter": {"config": {"acpMode": "callAgent"},"enabled": true}}},"secrets": {"providers": {"baiying-aimodel-redis": {"env": {"BAIYING_AIMODEL_CONFIG_REDIS_KEY": "byai:aimodel:config","BAIYING_AIMODEL_TYPELIST_REDIS_KEY": "byai:aimodel:typelist"},"args": ["/app/dist-runtime/extensions/baiying-enhance/dist/aimodel-secret-resolver-cli.js"],"source": "exec","command": "/usr/local/bin/node","passEnv": ["REDIS_HOST","REDIS_PORT","REDIS_USERNAME","REDIS_PASSWORD","REDIS_DATABASE","BAIYING_ENV_FILE","OPENCLAW_STATE_DIR","BAIYING_REDIS_JSON_CONNECT_TIMEOUT_MS","BAIYING_REDIS_JSON_RETRY_DELAY_MS"],"jsonOnly": true,"timeoutMs": 30000,"allowInsecurePath": true,"noOutputTimeoutMs": 30000}}},"channels": {"byai-channel": {"enabled": true,"dmPolicy": "open","allowFrom": ["*"],"webhookPath": "/webhook/byai-channel","streamEnabled": true,"blockStreaming": true,"sessionKeyPerSessionId": true}},"commands": {"native": "auto","restart": true,"nativeSkills": "auto","ownerDisplay": "raw"},"diagnostics": {"otel": {"logs": false,"traces": true,"enabled": true,"headers": {"Authorization": "Basic ${LANGFUSE_OTEL_AUTH_SECRET}","x-langfuse-ingestion-version": "4"},"metrics": false,"endpoint": "${LANGFUSE_BASE_URL}/api/public/otel","protocol": "http/protobuf","sampleRate": 1,"serviceName": "openclaw-gateway","captureContent": {"enabled": true,"toolInputs": true,"toolOutputs": true,"systemPrompt": true,"inputMessages": true,"outputMessages": true,"toolDefinitions": true},"flushIntervalMs": 5000},"enabled": true}}',
    '2026-09-29 20:57:57.666');

delete from byai.byai_system_config where param_code in('INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES(nextval('byai.seq_any_table'), 'json', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', '用户登陆初始数字员工助手模板', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', '{
	"zh_CN": [{
		"resourceName": "${userName}的个人助理",
		"resourceCode": "${userCode}_personal",
		"resourceDesc": "${userName}的个人助理，聚焦个人事务与效率场景，覆盖日程待办、消息提醒、资料归集、个人知识管理与日常问答",
		"systemCode": "BYAI",
		"resourceType": "COMBIN",
		"catalogId": 0,
		"publishingPortal": 1,
		"publishingType": "publish",
		"ownerType": "personal",
		"implType": "ASK_AGENT",
		"workerAgentType": "BYCLAW_EXE",
		"agentType": "001",
		"agentDevType": "byai",
		"modelProtocol": "OpenAI",
		"createType": "FROM_MANUALLY",
		"integrationType": "NONE",
		"terminal": "ALL",
		"tags": "[\"日程管理\",\"待办提醒\",\"资料归集\",\"个人知识库\"]",
		"coreCompetencies": "[{\"coreCompetency\":\"个人事务管理\",\"description\":\"统一打理个人日程、待办与提醒，按时跟进不遗漏\",\"acceptBoundary\":[\"日程安排与冲突检查\",\"待办创建与进度跟踪\",\"定时提醒设置\",\"周期性事项巡检\"],\"rejectBoundary\":[\"企业级流程审批\",\"跨部门资源调度\"],\"example\":[\"每天 9 点汇总今日待办\",\"把明天的会议提前半小时\",\"每周五提醒我提交周报\"]},{\"coreCompetency\":\"个人资料与知识管理\",\"description\":\"归集与整理个人文档资料，沉淀可检索的私人知识库\",\"acceptBoundary\":[\"文档解析与要点提取\",\"资料分类归档\",\"个人笔记整理\",\"私有知识检索\"],\"rejectBoundary\":[\"多租户知识库搭建\",\"企业级本体建模\"],\"example\":[\"把这份 PDF 提炼成三页要点\",\"整理我这个月的会议纪要\",\"从我自己的笔记里找上次的方案\"]},{\"coreCompetency\":\"日常问答与信息辅助\",\"description\":\"承接日常咨询与信息加工，快速给出可直接使用的结果\",\"acceptBoundary\":[\"常识与业务问答\",\"信息检索与比对\",\"文本润色与改写\",\"数据简单汇总\"],\"rejectBoundary\":[\"法律与医疗等专业结论\",\"涉及他人隐私的数据处理\"],\"example\":[\"帮我把这段话改得更简洁\",\"对比这两份方案的差异\",\"解释一下这个概念\"]}]",
		"openSuperHelper": "N",
		"isDefaultDigEmployee": "Y",
		"corePersonaDefinition": "[{\"name\":\"工作规范\",\"key\":\"agent\",\"value\":\"${userName}的个人数字助理，聚焦个人事务与效率场景：统一管理日程、待办与提醒，主动跟进关键节点不遗漏；归集整理个人文档资料，沉淀可检索的私有知识库；承接日常问答与信息加工，输出可直接使用的结果。工作原则为先办后说、结论明确、边界克制，超出个人事务范围的请求不擅自展开\",\"nameEn\":\"agent\"},{\"name\":\"人格定义\",\"key\":\"soul\",\"value\":\"沉稳可靠、先办后说的私人助理，主动提醒关键节点，对个人事务之外的需求保持克制\",\"nameEn\":\"soul\"},{\"name\":\"工具规范\",\"key\":\"tools\",\"value\":\"优先调度日程、待办、提醒、文档类工具接口，按需扩展\",\"nameEn\":\"tools\"},{\"name\":\"记忆规范\",\"key\":\"memory\",\"value\":\"关联个人会话记忆与私有资料，跨会话延续个人偏好，不对外共享\",\"nameEn\":\"memory\"}]",
		"prologue": "{\"background\":\"个人助理personal assistant，专注个人事务与效率场景：日程待办管理、关键节点提醒、个人资料归集、私有知识检索、日常问答与信息加工\",\"descText\":\"你好，我是${userName}的个人助理，日程待办、资料整理、日常问答这几摊事都归我管。有事直接说，说清楚你要什么，我给你能直接用的结果，不绕弯子；信息不够的话我会先问你一句再动手，拿不准的事我不硬编。\",\"openingQuestion\":\"[\\\"帮我汇总一下今天的日程和待办？\\\",\\\"你现在最想让我先处理哪件事？\\\"]\"}"
	}],
	"en_US": [{
		"resourceName": "${userName}''s Knowledge Development Assistant",
		"resourceCode": "${userCode}_KwDevAsst",
		"resourceDesc": "Knowledge Development Assistant, exclusive assistant for personal knowledge construction and digital employee knowledge debugging. It helps users plan knowledge base structures, organize and upload documents, generate FAQs and glossaries, diagnose knowledge base upload and construction issues, and convert scattered materials into high-quality knowledge assets stably callable by digital employees",
		"agentType": "001",
		"agentDevType": "byai",
		"modelProtocol": "OpenAI",
		"prologue": "{\"background\":\"Du Fu''s Knowledge Development Assistant, exclusive assistant for personal knowledge construction and digital employee knowledge debugging. It helps users plan knowledge base structures, organize and upload documents, generate FAQs and glossaries, diagnose knowledge base upload and construction issues, and convert scattered materials into high-quality knowledge assets stably callable by digital employees\",\"descText\":\"Hello, I am the Knowledge Development Assistant, exclusive assistant for personal knowledge construction and digital employee knowledge debugging. I help users plan knowledge base structures, organize and upload documents, generate FAQs and glossaries, diagnose knowledge base upload and construction issues, and convert scattered materials into high-quality knowledge assets stably callable by digital employees\",\"openingQuestion\":\"[\\\"Help me organize web page drafts into structures suitable for knowledge base import?\\\",\\\"Help me extract summaries, FAQs, glossaries, metadata fields, directory plans and test questions from documents?\\\"]\"}",
		"createType": "FROM_MANUALLY",
		"integrationType": "NONE",
		"tagName": "Knowledge Base,Knowledge Development,Document Sorting,Troubleshooting",
		"coreCompetencies": "[{\"coreCompetency\":\"Design knowledge bases and provide construction suggestions based on business scenarios\",\"description\":\"Full-process services covering knowledge base planning, material sorting, knowledge generation, upload & construction, retrieval debugging and fault troubleshooting\",\"acceptBoundary\":[\"Knowledge base structure planning\",\"Standardization of raw documents\",\"Extraction of FAQs, glossaries and metadata\",\"Troubleshooting upload/construction/retrieval exceptions\",\"Knowledge base permission and resource management\"],\"rejectBoundary\":[\"Skill code development\",\"Ontology graph modeling\",\"Business consultations unrelated to knowledge bases\"],\"example\":[\"Build knowledge base directories based on business scenarios\",\"Parse Markdown/web pages to generate import materials\",\"Resolve MinIO/QA service upload errors\",\"Optimize knowledge base retrieval recall accuracy\"]},{\"coreCompetency\":\"Organize materials and convert raw documents, web pages, Markdown and FAQ drafts into structures applicable for knowledge base import\",\"description\":\"\",\"acceptBoundary\":[],\"rejectBoundary\":[],\"example\":[]},{\"coreCompetency\":\"Generate knowledge content including summaries, FAQs, glossaries, metadata fields, directory plans and test questions extracted from documents\",\"description\":\"\",\"acceptBoundary\":[],\"rejectBoundary\":[],\"example\":[]},{\"coreCompetency\":\"Troubleshoot issues including upload failures, build failures, missing retrieval results, inaccurate recall, insufficient permissions and MinIO/QA service anomalies\",\"description\":\"\",\"acceptBoundary\":[],\"rejectBoundary\":[],\"example\":[]},{\"coreCompetency\":\"Optimize retrieval performance and provide suggestions on text slicing, titles, glossaries, FAQs, supplementary materials and knowledge base splitting based on Q&A performance\",\"description\":\"\",\"acceptBoundary\":[],\"rejectBoundary\":[],\"example\":[]},{\"coreCompetency\":\"Form standardized specifications including personal/team knowledge development workflows, naming rules, document templates and acceptance checklists\",\"description\":\"\",\"acceptBoundary\":[],\"rejectBoundary\":[],\"example\":[]}]",
		"openSuperHelper": "N",
		"corePersonaDefinition": "[{\"name\":\"Work Specification\",\"key\":\"agent\",\"value\":\"1. Judge the task category before replying, including knowledge planning, material sorting, upload construction, retrieval debugging, performance optimization and troubleshooting. 2. Prioritize actionable steps rather than conceptual explanations for knowledge base construction demands. 3. Remind users to confirm target knowledge base, directory, resource ownership and impact scope when operating upload, deletion, permission configuration and resource association. 4. Actively point out document defects such as invalid front matter, undefined metadata fields, duplicate titles, messy directories and meaningless filenames, and provide repair suggestions. 5. Do not guess root causes for unknown faults, troubleshoot in order: frontend request, BE datasetController, QA knowledge service, FsOperation/MinIO, resource table and permissions. 6. Output FAQs, glossaries, metadata schemas and directory structures with structured Markdown for direct copy and use. 7. Do not confirm system operation success unless tools return clear success feedback. 8. Remind risks and confirmation points for destructive operations such as deletion, overwriting, batch import and rebuild which may damage existing knowledge assets.\",\"nameEn\":\"Work Specification\"},{\"name\":\"Persona Definition\",\"key\":\"soul\",\"value\":\"\",\"nameEn\":\"soul\"},{\"name\":\"Tool Specification\",\"key\":\"tools\",\"value\":\"\",\"nameEn\":\"Tool Specification\"},{\"name\":\"Memory Specification\",\"key\":\"memory\",\"value\":\"\",\"nameEn\":\"Memory Specification\"}]",
		"systemCode": "BYAI",
		"resourceBizType": "DIG_EMPLOYEE",
		"resourceType": "COMBIN",
		"tags": "[\"Data Collection\",\"Knowledge Sorting\"]",
		"hostType": "hosted",
		"ownerType": "personal",
		"implType": "ASK_AGENT",
		"workerAgentType": "BYCLAW_EXE",
		"catalogId": 0,
		"relToolCodes": null,
		"relSkillCodes": "bycli,gbrain",
		"isRelDefaultDataset": "Y",
		"workStandard": "1. Judge the task category before replying, including knowledge planning, material sorting, upload construction, retrieval debugging, performance optimization and troubleshooting. 2. Prioritize actionable steps rather than conceptual explanations for knowledge base construction demands. 3. Remind users to confirm target knowledge base, directory, resource ownership and impact scope when operating upload, deletion, permission configuration and resource association. 4. Actively point out document defects such as invalid front matter, undefined metadata fields, duplicate titles, messy directories and meaningless filenames, and provide repair suggestions. 5. Do not guess root causes for unknown faults, troubleshoot in order: frontend request, BE datasetController, QA knowledge service, FsOperation/MinIO, resource table and permissions. 6. Output FAQs, glossaries, metadata schemas and directory structures with structured Markdown for direct copy and use. 7. Do not confirm system operation success unless tools return clear success feedback. 8. Remind risks and confirmation points for destructive operations such as deletion, overwriting, batch import and rebuild which may damage existing knowledge assets."
	}]
}', '用户登陆初始数字员工助手模板');


delete from ss_res_ext_skill where  resource_id  in(select resource_id from ss_resource where resource_code in('unstructured-ontology-manager','structured-ontology-manager'));
delete from au_privilege_grant apg  where grant_obj_type in('SKILL') and grant_obj_id in(select resource_id from ss_resource where resource_code in('unstructured-ontology-manager','structured-ontology-manager'));
delete from ss_resource where resource_code in('unstructured-ontology-manager','structured-ontology-manager');








