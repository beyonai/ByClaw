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

-- QQ/163/阿里及自定义 IMAP：补齐前端安全校验所需的表单元数据。
UPDATE byai.byai_connector_info
SET auth_config = CASE connector_code
    WHEN 'qq-mail' THEN '{"credentialForm":{"helpUrl":"https://service.mail.qq.com/","helpLinkText":"前往 QQ 邮箱获取授权码","helpText":"请先在 QQ 邮箱设置中开启 IMAP/SMTP 服务，并使用生成的授权码。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
    WHEN 'netease-163-mail' THEN '{"credentialForm":{"helpUrl":"https://mail.163.com/","helpLinkText":"前往 163 邮箱获取授权码","helpText":"请先在 163 邮箱设置中开启 IMAP/SMTP 服务，并使用生成的授权码。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
    WHEN 'aliyun-mail' THEN '{"credentialForm":{"helpUrl":"https://qiye.aliyun.com/","helpLinkText":"前往阿里邮箱获取安全密码","helpText":"请先在阿里邮箱设置中开启 IMAP/SMTP 服务，并使用安全密码。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"安全密码","inputType":"password","maxLength":2048,"required":true}]}}'
    WHEN 'custom-imap-mail' THEN '{"credentialForm":{"helpUrl":"https://www.rfc-editor.org/rfc/rfc9051","helpLinkText":"查看 IMAP 配置说明","helpText":"填写邮箱地址、应用专用密码，以及 IMAP/SMTP 服务器地址、端口和加密方式（ssl、starttls 或 tls）。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"应用专用密码","inputType":"password","maxLength":2048,"required":true},{"key":"imapHost","label":"IMAP 地址","inputType":"text","maxLength":255,"required":true},{"key":"imapPort","label":"IMAP 端口","inputType":"text","maxLength":5,"required":true},{"key":"imapEncryption","label":"IMAP 加密方式","inputType":"text","maxLength":10,"required":true},{"key":"smtpHost","label":"SMTP 地址","inputType":"text","maxLength":255,"required":true},{"key":"smtpPort","label":"SMTP 端口","inputType":"text","maxLength":5,"required":true},{"key":"smtpEncryption","label":"SMTP 加密方式","inputType":"text","maxLength":10,"required":true}]}}'
    ELSE auth_config
    END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('qq-mail', 'netease-163-mail', 'aliyun-mail', 'custom-imap-mail')
  AND connector_type = 'SYSTEM';

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
    ('qq-mail','QQ 邮箱','通过 IMAP/SMTP 连接 QQ 邮箱','mail-form','AK_SK','{"credentialForm":{"helpUrl":"https://service.mail.qq.com/","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}','qq',63),
    ('netease-163-mail','网易 163 邮箱','通过 IMAP/SMTP 连接网易 163 邮箱','mail-form','AK_SK','{"credentialForm":{"helpUrl":"https://mail.163.com/","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}','netease-163',64),
    ('aliyun-mail','阿里邮箱','通过 IMAP/SMTP 连接阿里邮箱','mail-form','AK_SK','{"credentialForm":{"helpUrl":"https://qiye.aliyun.com/","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"安全密码","inputType":"password","maxLength":2048,"required":true}]}}','aliyun-mail',65),
    ('custom-imap-mail','自定义 IMAP','通过自定义 IMAP/SMTP 服务器连接邮箱','mail-form','AK_SK','{"credentialForm":{"helpUrl":"https://www.rfc-editor.org/rfc/rfc9051","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"应用专用密码","inputType":"password","maxLength":2048,"required":true},{"key":"imapHost","label":"IMAP 地址","inputType":"text","maxLength":255,"required":true},{"key":"imapPort","label":"IMAP 端口","inputType":"text","maxLength":5,"required":true},{"key":"imapEncryption","label":"IMAP 加密方式","inputType":"text","maxLength":10,"required":true},{"key":"smtpHost","label":"SMTP 地址","inputType":"text","maxLength":255,"required":true},{"key":"smtpPort","label":"SMTP 端口","inputType":"text","maxLength":5,"required":true},{"key":"smtpEncryption","label":"SMTP 加密方式","inputType":"text","maxLength":10,"required":true}]}}','custom-imap',66)
) AS v(code,name,description,provider,mode,config,runtime_provider,sort)
WHERE NOT EXISTS (SELECT 1 FROM byai.byai_connector_info i WHERE i.connector_code = v.code);
