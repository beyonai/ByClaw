-- 扩展用户 MCP 允许地址：管理员可配置精确域名、内网 IP 或 localhost；不支持通配符。
UPDATE byai.byai_system_config
SET param_name = '用户 MCP 允许地址',
    param_en_name = 'User MCP allowed addresses',
    param_desc = '逗号分隔的精确主机；可填写域名、内网 IP 或 localhost；不支持通配符，仅允许 HTTPS 443'
WHERE param_code = 'BYAI_MCP_ALLOWED_ADDRESSES';
