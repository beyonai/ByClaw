-- V0.6.0 数字员工组类型字典（OpenGauss，可重复执行）。
SET search_path TO byai;

DELETE FROM byai.byai_system_config_list
WHERE param_group_code = 'DIG_EMPLOYEE_AGENT_TYPE'
  AND param_value = '017';

INSERT INTO byai.byai_system_config_list
    (param_id, param_group_code, param_group_name, param_name, param_en_name,
     param_value, param_desc, param_seq)
VALUES
    (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型',
     '数字员工组', 'Digital Employee Group', '017', '数字员工组', 6);
