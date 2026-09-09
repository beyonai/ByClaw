-- Fastmail: 修复点击“连接”时凭据表单被校验器拒绝的问题。
-- 现有表单要求 HTTPS helpUrl、text/password 类型以及显式 maxLength。
-- 仅更新系统表单元数据；用户邮箱地址与 API Token 仍通过个人凭据流程保存。
UPDATE byai.byai_connector_info
SET auth_config = '{"credentialForm":{"helpUrl":"https://www.fastmail.com/","helpLinkText":"前往 Fastmail","helpText":"请使用自己的 Fastmail 邮箱地址和 API Token。凭据验证成功后将保存到当前用户的邮箱账号中。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048,"required":true}]}}',
    update_time = CURRENT_TIMESTAMP
WHERE connector_code = 'fastmail-mail'
  AND connector_type = 'SYSTEM'
  AND provider_code = 'mail-form'
  AND auth_mode = 'AK_SK'
  AND auth_config IS DISTINCT FROM '{"credentialForm":{"helpUrl":"https://www.fastmail.com/","helpLinkText":"前往 Fastmail","helpText":"请使用自己的 Fastmail 邮箱地址和 API Token。凭据验证成功后将保存到当前用户的邮箱账号中。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048,"required":true}]}}';

-- 补齐 V0.4.0 邮箱连接器；使用 AK_SK 路由到 mail-form Provider。
UPDATE byai.byai_connector_info
SET provider_code = CASE
        WHEN connector_code = 'gmail-mail' THEN 'gmail-oauth2'
        WHEN connector_code = 'microsoft-mail' THEN 'microsoft-mail-oauth2'
        ELSE 'mail-form'
    END,
    auth_mode = CASE WHEN connector_code IN ('gmail-mail', 'microsoft-mail') THEN 'OAUTH2' ELSE 'AK_SK' END,
    auth_config = CASE
        WHEN connector_code = 'gmail-mail' THEN '{"clientIdEnv":"GMAIL_OAUTH_CLIENT_ID","clientSecretEnv":"GMAIL_OAUTH_CLIENT_SECRET","redirectUriEnv":"GMAIL_OAUTH_REDIRECT_URI","scope":"openid email profile https://www.googleapis.com/auth/gmail.modify"}'
        WHEN connector_code = 'microsoft-mail' THEN '{"clientIdEnv":"MICROSOFT_MAIL_CLIENT_ID","clientSecretEnv":"MICROSOFT_MAIL_CLIENT_SECRET","redirectUriEnv":"MICROSOFT_MAIL_REDIRECT_URI","scope":"openid profile email offline_access User.Read Mail.ReadWrite Mail.Send"}'
        ELSE auth_config
    END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('gmail-mail', 'microsoft-mail', 'fastmail-mail', 'qq-mail',
                         'netease-163-mail', 'aliyun-mail', 'custom-imap-mail');

INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort, status_cd
)
SELECT nextval('byai.seq_any_table'), v.code, v.name, v.description, 'SYSTEM',
       v.provider, 'mail', v.mode, v.config, '{}',
       json_build_object('schemaVersion', '1.0', 'id', v.code, 'version', '1.0.0',
           'runtime', json_build_object('type', CASE WHEN v.mode = 'OAUTH2' THEN 'oauth2' ELSE 'mail' END,
               'provider', v.runtime_provider),
           'authStorage', json_build_object('mode', 'credential-reference',
               'projectionPath', '/by/.connector-auth/.mail/accounts.json'),
           'skill', json_build_object('code', 'mail', 'source', 'system-builtin',
               'installScope', 'user', 'grantScope', 'agent'))::text,
       v.sort, '00A'
FROM (VALUES
    ('gmail-mail','Gmail','通过 OAuth2 连接 Gmail 用户账号','gmail-oauth2','OAUTH2','{}','gmail',60),
    ('microsoft-mail','Microsoft 365','通过 OAuth2 连接 Microsoft 365 用户账号','microsoft-mail-oauth2','OAUTH2','{}','microsoft',61),
    ('fastmail-mail','Fastmail','通过 API Token 连接 Fastmail 用户账号','mail-form','AK_SK','{"credentialForm":{"fields":[{"key":"email","inputType":"text","required":true},{"key":"apiToken","inputType":"password","required":true}]}}','fastmail',62),
    ('qq-mail','QQ 邮箱','通过 IMAP/SMTP 连接 QQ 邮箱','mail-form','AK_SK','{"credentialForm":{"fields":[{"key":"email","inputType":"text","required":true},{"key":"authCode","inputType":"password","required":true}]}}','qq',63),
    ('netease-163-mail','网易 163 邮箱','通过 IMAP/SMTP 连接网易 163 邮箱','mail-form','AK_SK','{"credentialForm":{"fields":[{"key":"email","inputType":"text","required":true},{"key":"authCode","inputType":"password","required":true}]}}','netease-163',64),
    ('aliyun-mail','阿里邮箱','通过 IMAP/SMTP 连接阿里邮箱','mail-form','AK_SK','{"credentialForm":{"fields":[{"key":"email","inputType":"text","required":true},{"key":"authCode","inputType":"password","required":true}]}}','aliyun-mail',65),
    ('custom-imap-mail','自定义 IMAP','通过自定义 IMAP/SMTP 服务器连接邮箱','mail-form','AK_SK','{"credentialForm":{"fields":[{"key":"email","inputType":"text","required":true},{"key":"authCode","inputType":"password","required":true}]}}','custom-imap',66)
) AS v(code,name,description,provider,mode,config,runtime_provider,sort)
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_connector_info i WHERE i.connector_code = v.code);
