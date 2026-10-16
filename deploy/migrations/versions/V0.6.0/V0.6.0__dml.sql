-- V0.6.0：初始化文生图和语音模型连接器模板。
-- 完整模型凭据由 AK_SK Provider 加密保存，并投影到用户私有 Sandbox；模板不包含真实密钥。

INSERT INTO byai.byai_connector_info (
    connector_id, connector_code, connector_name, description, connector_type,
    provider_code, skill_code, auth_mode, auth_config, request_config,
    runtime_manifest, sort, status_cd
)
SELECT
    nextval('byai.seq_any_table'), seed.connector_code, seed.connector_name,
    seed.description, 'SYSTEM', seed.provider_code, NULL, 'AK_SK',
    seed.auth_config, '{}', seed.runtime_manifest, seed.sort, '00A'
FROM (
    SELECT
        'image-generation-model' AS connector_code,
        '文生图模型' AS connector_name,
        '配置个人文生图模型；开启后优先使用个人配置，关闭或未配置时使用系统默认模型。' AS description,
        'image-generation-model' AS provider_code,
        '{"credentialForm":{"helpUrl":"https://platform.openai.com/docs/guides/image-generation","helpLinkText":"查看文生图模型接入说明","helpText":"配置完整的文生图模型连接信息。Endpoint 必须使用 HTTPS；Token 和敏感 Headers 将加密保存，不会回传前端。Headers 请输入 JSON 数组，未配置时填写 []；高级参数未配置时填写 {}。","fields":[{"key":"modelName","label":"模型名称","inputType":"text","maxLength":256},{"key":"modelCode","label":"模型型号","inputType":"text","maxLength":256},{"key":"modelProtocol","label":"模型协议（首期 OPENAI_IMAGE）","inputType":"text","maxLength":128},{"key":"apiEndpoint","label":"API Endpoint","inputType":"text","maxLength":2048},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048},{"key":"headersJson","label":"Headers（JSON 数组）","inputType":"textarea","maxLength":8192},{"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4},{"key":"readTimeoutSeconds","label":"读取超时（秒）","inputType":"number","maxLength":4},{"key":"maxRetryCount","label":"最大重试次数","inputType":"number","maxLength":2},{"key":"retryIntervalSeconds","label":"重试间隔（秒）","inputType":"number","maxLength":4},{"key":"optionsJson","label":"高级参数（JSON 对象）","inputType":"textarea","maxLength":8192}]}}' AS auth_config,
        '{"schemaVersion":"1.0","id":"image-generation-model","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"mediaModelProjection":{"schemaVersion":1,"capability":"IMAGE","path":"/by/.connector-auth/.model/image.json"},"skill":{"code":"media-generation","source":"system-builtin","installScope":"user","grantScope":"agent"}}' AS runtime_manifest,
        60 AS sort
    UNION ALL
    SELECT
        'speech-generation-model',
        '语音模型',
        '配置个人语音合成模型；开启后优先使用个人配置，关闭或未配置时使用系统默认模型。',
        'speech-generation-model',
        '{"credentialForm":{"helpUrl":"https://www.volcengine.com/docs/6561/1598757","helpLinkText":"查看豆包语音模型接入说明","helpText":"配置完整的语音合成模型连接信息。Endpoint 必须使用 HTTPS；Token 和敏感 Headers 将加密保存，不会回传前端。Headers 请输入 JSON 数组，未配置时填写 []；高级参数可配置 resourceId、默认音色和默认格式，未配置时填写 {}。","fields":[{"key":"modelName","label":"模型名称","inputType":"text","maxLength":256},{"key":"modelCode","label":"模型型号","inputType":"text","maxLength":256},{"key":"modelProtocol","label":"模型协议（首期 VOLCENGINE_TTS_V3）","inputType":"text","maxLength":128},{"key":"apiEndpoint","label":"API Endpoint","inputType":"text","maxLength":2048},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048},{"key":"headersJson","label":"Headers（JSON 数组）","inputType":"textarea","maxLength":8192},{"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4},{"key":"readTimeoutSeconds","label":"读取超时（秒）","inputType":"number","maxLength":4},{"key":"maxRetryCount","label":"最大重试次数","inputType":"number","maxLength":2},{"key":"retryIntervalSeconds","label":"重试间隔（秒）","inputType":"number","maxLength":4},{"key":"optionsJson","label":"高级参数（JSON 对象）","inputType":"textarea","maxLength":8192}]}}',
        '{"schemaVersion":"1.0","id":"speech-generation-model","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"mediaModelProjection":{"schemaVersion":1,"capability":"TTS","path":"/by/.connector-auth/.model/tts.json"},"skill":{"code":"media-generation","source":"system-builtin","installScope":"user","grantScope":"agent"}}',
        61
) seed
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.byai_connector_info existing
    WHERE existing.connector_code = seed.connector_code
);

-- 重放时同步平台模板定义，但不修改或删除任何用户授权记录。
UPDATE byai.byai_connector_info
SET connector_name = CASE connector_code
        WHEN 'image-generation-model' THEN '文生图模型'
        WHEN 'speech-generation-model' THEN '语音模型'
    END,
    description = CASE connector_code
        WHEN 'image-generation-model' THEN '配置个人文生图模型；开启后优先使用个人配置，关闭或未配置时使用系统默认模型。'
        WHEN 'speech-generation-model' THEN '配置个人语音合成模型；开启后优先使用个人配置，关闭或未配置时使用系统默认模型。'
    END,
    connector_type = 'SYSTEM',
    provider_code = connector_code,
    skill_code = NULL,
    auth_mode = 'AK_SK',
    auth_config = CASE connector_code
        WHEN 'image-generation-model' THEN '{"credentialForm":{"helpUrl":"https://platform.openai.com/docs/guides/image-generation","helpLinkText":"查看文生图模型接入说明","helpText":"配置完整的文生图模型连接信息。Endpoint 必须使用 HTTPS；Token 和敏感 Headers 将加密保存，不会回传前端。Headers 请输入 JSON 数组，未配置时填写 []；高级参数未配置时填写 {}。","fields":[{"key":"modelName","label":"模型名称","inputType":"text","maxLength":256},{"key":"modelCode","label":"模型型号","inputType":"text","maxLength":256},{"key":"modelProtocol","label":"模型协议（首期 OPENAI_IMAGE）","inputType":"text","maxLength":128},{"key":"apiEndpoint","label":"API Endpoint","inputType":"text","maxLength":2048},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048},{"key":"headersJson","label":"Headers（JSON 数组）","inputType":"textarea","maxLength":8192},{"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4},{"key":"readTimeoutSeconds","label":"读取超时（秒）","inputType":"number","maxLength":4},{"key":"maxRetryCount","label":"最大重试次数","inputType":"number","maxLength":2},{"key":"retryIntervalSeconds","label":"重试间隔（秒）","inputType":"number","maxLength":4},{"key":"optionsJson","label":"高级参数（JSON 对象）","inputType":"textarea","maxLength":8192}]}}'
        WHEN 'speech-generation-model' THEN '{"credentialForm":{"helpUrl":"https://www.volcengine.com/docs/6561/1598757","helpLinkText":"查看豆包语音模型接入说明","helpText":"配置完整的语音合成模型连接信息。Endpoint 必须使用 HTTPS；Token 和敏感 Headers 将加密保存，不会回传前端。Headers 请输入 JSON 数组，未配置时填写 []；高级参数可配置 resourceId、默认音色和默认格式，未配置时填写 {}。","fields":[{"key":"modelName","label":"模型名称","inputType":"text","maxLength":256},{"key":"modelCode","label":"模型型号","inputType":"text","maxLength":256},{"key":"modelProtocol","label":"模型协议（首期 VOLCENGINE_TTS_V3）","inputType":"text","maxLength":128},{"key":"apiEndpoint","label":"API Endpoint","inputType":"text","maxLength":2048},{"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048},{"key":"headersJson","label":"Headers（JSON 数组）","inputType":"textarea","maxLength":8192},{"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4},{"key":"readTimeoutSeconds","label":"读取超时（秒）","inputType":"number","maxLength":4},{"key":"maxRetryCount","label":"最大重试次数","inputType":"number","maxLength":2},{"key":"retryIntervalSeconds","label":"重试间隔（秒）","inputType":"number","maxLength":4},{"key":"optionsJson","label":"高级参数（JSON 对象）","inputType":"textarea","maxLength":8192}]}}'
    END,
    request_config = '{}',
    runtime_manifest = CASE connector_code
        WHEN 'image-generation-model' THEN '{"schemaVersion":"1.0","id":"image-generation-model","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"mediaModelProjection":{"schemaVersion":1,"capability":"IMAGE","path":"/by/.connector-auth/.model/image.json"},"skill":{"code":"media-generation","source":"system-builtin","installScope":"user","grantScope":"agent"}}'
        WHEN 'speech-generation-model' THEN '{"schemaVersion":"1.0","id":"speech-generation-model","version":"1.0.0","runtime":{"type":"oauth2","authorizeIn":"be-auth-job"},"authStorage":{"mode":"credential-reference","owner":"be-auth-job","runtimeMutation":"provider-refresh-only","environment":{}},"mediaModelProjection":{"schemaVersion":1,"capability":"TTS","path":"/by/.connector-auth/.model/tts.json"},"skill":{"code":"media-generation","source":"system-builtin","installScope":"user","grantScope":"agent"}}'
    END,
    sort = CASE connector_code
        WHEN 'image-generation-model' THEN 60
        WHEN 'speech-generation-model' THEN 61
    END,
    status_cd = '00A',
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('image-generation-model', 'speech-generation-model');

-- 语音高级参数保留空对象作为安全默认值，并给出默认音色与可选音色的填写示例。
-- voices 是用户显式传入 voice 时的允许列表；voice 为空字符串、空白、null 或省略时，
-- DSH 不校验 voices，而是依次使用 defaultVoice、voice、speaker 中配置的默认音色。
UPDATE byai.byai_connector_info
SET auth_config =
        jsonb_set(
            jsonb_set(auth_config::jsonb,
                '{credentialForm,fields,10,placeholder}',
                '"{\"resourceId\":\"seed-tts-2.0\",\"defaultVoice\":\"zh_female_vv_jupiter_bigtts\",\"voices\":[{\"id\":\"zh_female_vv_jupiter_bigtts\",\"name\":\"Vivi\"}],\"format\":\"mp3\"}"'::jsonb, true),
            '{credentialForm,fields,10,description}',
            '"resourceId 填写模型资源 ID；defaultVoice 是未指定音色时使用的默认值；voices 是允许用户显式选择的音色列表。voice 为空字符串、空白、null 或省略时不校验 voices，并使用默认音色。示例仅说明格式，请替换为当前账号已授权的音色 ID。"'::jsonb, true)::text,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code = 'speech-generation-model';

-- 在协议和 Endpoint 字段旁展示可直接照填的示例与说明，避免把账号或 Endpoint ID 误填为 URL。
UPDATE byai.byai_connector_info
SET auth_config = CASE connector_code
    WHEN 'image-generation-model' THEN
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(auth_config::jsonb,
                        '{credentialForm,fields,2,placeholder}', '"OPENAI_IMAGE"'::jsonb, true),
                    '{credentialForm,fields,2,description}',
                    '"当前仅支持 OPENAI_IMAGE，表示调用兼容 OpenAI Images API 的 /images/generations 接口。"'::jsonb, true),
                '{credentialForm,fields,3,placeholder}',
                '"https://ark.cn-beijing.volces.com/api/v3/images/generations"'::jsonb, true),
            '{credentialForm,fields,3,description}',
            '"填写完整 HTTPS 请求地址，不是账号、应用 ID 或 Endpoint ID。火山方舟 Seedream 可使用上面的示例地址。"'::jsonb, true)::text
    WHEN 'speech-generation-model' THEN
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(auth_config::jsonb,
                        '{credentialForm,fields,2,placeholder}', '"VOLCENGINE_TTS_V3"'::jsonb, true),
                    '{credentialForm,fields,2,description}',
                    '"当前仅支持 VOLCENGINE_TTS_V3，表示调用火山引擎豆包语音合成 V3 单向流式接口。"'::jsonb, true),
                '{credentialForm,fields,3,placeholder}',
                '"https://openspeech.bytedance.com/api/v3/tts/unidirectional"'::jsonb, true),
            '{credentialForm,fields,3,description}',
            '"填写完整 HTTPS 请求地址，不是 AppID、账号或模型 ID；豆包语音合成可使用上面的示例地址。"'::jsonb, true)::text
    END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('image-generation-model', 'speech-generation-model');

-- 为非敏感、跨用户一致的字段提供表单默认值；API Token 永不设置默认值。
UPDATE byai.byai_connector_info
SET auth_config = CASE connector_code
    WHEN 'image-generation-model' THEN
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            jsonb_set(
                                jsonb_set(auth_config::jsonb,
                                    '{credentialForm,fields,2,defaultValue}', '"OPENAI_IMAGE"'::jsonb, true),
                                '{credentialForm,fields,5,defaultValue}', '"[]"'::jsonb, true),
                            '{credentialForm,fields,6,defaultValue}', '"30"'::jsonb, true),
                        '{credentialForm,fields,7,defaultValue}', '"120"'::jsonb, true),
                    '{credentialForm,fields,8,defaultValue}', '"3"'::jsonb, true),
                '{credentialForm,fields,9,defaultValue}', '"1"'::jsonb, true),
            '{credentialForm,fields,10,defaultValue}', '"{}"'::jsonb, true)::text
    WHEN 'speech-generation-model' THEN
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            jsonb_set(
                                jsonb_set(
                                    jsonb_set(auth_config::jsonb,
                                        '{credentialForm,fields,2,defaultValue}', '"VOLCENGINE_TTS_V3"'::jsonb, true),
                                    '{credentialForm,fields,3,defaultValue}',
                                    '"https://openspeech.bytedance.com/api/v3/tts/unidirectional"'::jsonb, true),
                                '{credentialForm,fields,5,defaultValue}', '"[]"'::jsonb, true),
                            '{credentialForm,fields,6,defaultValue}', '"32"'::jsonb, true),
                        '{credentialForm,fields,7,defaultValue}', '"60"'::jsonb, true),
                    '{credentialForm,fields,8,defaultValue}', '"3"'::jsonb, true),
                '{credentialForm,fields,9,defaultValue}', '"1"'::jsonb, true),
            '{credentialForm,fields,10,defaultValue}', '"{}"'::jsonb, true)::text
    END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('image-generation-model', 'speech-generation-model');
