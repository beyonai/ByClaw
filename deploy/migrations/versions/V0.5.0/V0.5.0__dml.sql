-- V0.5.0 邮箱连接器迁移，内容从 V0.4.1 邮箱迁移复制而来。
-- 表单字段配置需满足前端校验器：HTTPS helpUrl、text/password 类型及 maxLength。
UPDATE byai.byai_connector_info
SET provider_code = CASE WHEN connector_code='gmail-mail' THEN 'gmail-oauth2' WHEN connector_code='microsoft-mail' THEN 'microsoft-mail-oauth2' ELSE 'mail-form' END,
    auth_mode = CASE WHEN connector_code IN ('gmail-mail','microsoft-mail') THEN 'OAUTH2' ELSE 'AK_SK' END,
    auth_config = CASE
      WHEN connector_code='gmail-mail' THEN '{"clientIdEnv":"GMAIL_OAUTH_CLIENT_ID","clientSecretEnv":"GMAIL_OAUTH_CLIENT_SECRET","redirectUriEnv":"GMAIL_OAUTH_REDIRECT_URI","scope":"openid email profile https://www.googleapis.com/auth/gmail.modify"}'
      WHEN connector_code='microsoft-mail' THEN '{"clientIdEnv":"MICROSOFT_MAIL_CLIENT_ID","clientSecretEnv":"MICROSOFT_MAIL_CLIENT_SECRET","redirectUriEnv":"MICROSOFT_MAIL_REDIRECT_URI","scope":"openid profile email offline_access User.Read Mail.ReadWrite Mail.Send"}'
      WHEN connector_code='fastmail-mail' THEN '{"credentialForm":{"helpUrl":"https://www.fastmail.com/","helpLinkText":"前往 Fastmail","helpText":"请使用自己的 Fastmail 邮箱地址和 API Token。","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='qq-mail' THEN '{"credentialForm":{"helpUrl":"https://service.mail.qq.com/","helpLinkText":"前往 QQ 邮箱获取授权码","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='netease-163-mail' THEN '{"credentialForm":{"helpUrl":"https://mail.163.com/","helpLinkText":"前往 163 邮箱获取授权码","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"授权码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='aliyun-mail' THEN '{"credentialForm":{"helpUrl":"https://qiye.aliyun.com/","helpLinkText":"前往阿里邮箱获取安全密码","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"安全密码","inputType":"password","maxLength":2048,"required":true}]}}'
      WHEN connector_code='custom-imap-mail' THEN '{"credentialForm":{"helpUrl":"https://www.rfc-editor.org/rfc/rfc9051","helpLinkText":"查看 IMAP 配置说明","fields":[{"key":"email","label":"邮箱地址","inputType":"text","maxLength":256,"required":true},{"key":"authCode","label":"应用专用密码","inputType":"password","maxLength":2048,"required":true},{"key":"imapHost","label":"IMAP 地址","inputType":"text","maxLength":255,"required":true},{"key":"imapPort","label":"IMAP 端口","inputType":"text","maxLength":5,"required":true},{"key":"imapEncryption","label":"IMAP 加密方式","inputType":"text","maxLength":10,"required":true},{"key":"smtpHost","label":"SMTP 地址","inputType":"text","maxLength":255,"required":true},{"key":"smtpPort","label":"SMTP 端口","inputType":"text","maxLength":5,"required":true},{"key":"smtpEncryption","label":"SMTP 加密方式","inputType":"text","maxLength":10,"required":true}]}}'
      ELSE auth_config END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('gmail-mail','microsoft-mail','fastmail-mail','qq-mail','netease-163-mail','aliyun-mail','custom-imap-mail');

-- 连接器不存在时补建最小系统记录；已存在记录由上面的幂等 UPDATE 维护。
INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config, runtime_manifest, sort, status_cd
)
SELECT nextval('byai.seq_any_table'), v.code, v.name, v.description, 'SYSTEM',
       v.provider, 'mail', v.mode, v.config, '{}',
       json_build_object('schemaVersion','1.0','id',v.code,'version','1.0.0',
         'runtime',json_build_object('type',CASE WHEN v.mode='OAUTH2' THEN 'oauth2' ELSE 'mail' END,'provider',v.runtime_provider),
         'authStorage',json_build_object('mode','credential-reference','projectionPath','/by/.connector-auth/.mail/accounts.json'),
         'skill',json_build_object('code','mail','source','system-builtin','installScope','user','grantScope','agent'))::text,
       v.sort, '00A'
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
