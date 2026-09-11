-- 连接器不存在时补建最小系统记录；随后统一配置新旧记录，保证首次部署也写入完整 auth_config。
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
