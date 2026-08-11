SET search_path TO byai;

INSERT INTO byai_system_config (
    param_id,
    param_type,
    param_code,
    param_name,
    param_en_name,
    param_value,
    param_desc
)
SELECT
    nextval('seq_any_table'),
    'json',
    'DIGITAL_EMPLOYEE_TERMINOLOGY',
    'AI员工展示称谓',
    'Digital Employee Terminology',
    '{"zh-CN":{"singular":"数字员工","plural":"数字员工","entry":"员工","market":"员工市场"},"en-US":{"singular":"Digital Employee","plural":"Digital Employees","entry":"Employees","market":"Employee Marketplace"}}',
    '配置数字员工及AI员工入口在客户界面的中英文展示称谓；仅影响展示，不改变DIG_EMPLOYEE等内部协议标识'
WHERE NOT EXISTS (
    SELECT 1
    FROM byai_system_config
    WHERE param_code = 'DIGITAL_EMPLOYEE_TERMINOLOGY'
);
