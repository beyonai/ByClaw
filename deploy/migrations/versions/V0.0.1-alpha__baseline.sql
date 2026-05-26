-- ============================================================
-- V0.0.1-alpha__baseline.sql
-- ByClaw 基线版本 — 等同于 deploy/middleware/initdb/ 的完整内容
-- 全新部署时由 OpenGauss docker-entrypoint-initdb.d 自动执行
-- 此文件用于版本追踪，已有数据库无需重复执行
-- ============================================================

-- ========== 1. Schema 与扩展 (01_init.sql) ==========
-- 初始化 byai schema 和扩展
CREATE SCHEMA IF NOT EXISTS byai;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS age;

-- 授权 gaussdb 用户访问 byai schema
GRANT ALL PRIVILEGES ON SCHEMA byai TO gaussdb;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA byai TO gaussdb;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA byai TO gaussdb;
ALTER DEFAULT PRIVILEGES IN SCHEMA byai GRANT ALL ON TABLES TO gaussdb;
ALTER DEFAULT PRIVILEGES IN SCHEMA byai GRANT ALL ON SEQUENCES TO gaussdb;

-- ========== 2. DDL（表、序列、索引、约束） (02_ddl.sql) ==========
-- byai 模式完整建表语句（DDL）

-- ========== 序列 ==========
CREATE SEQUENCE IF NOT EXISTS byai.seq_any_table;
CREATE SEQUENCE IF NOT EXISTS byai.ss_resource_rel_detail_resource_rel_detail_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.byai_message_relobj_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_record_id_seq;

-- ========== 表结构 ==========
CREATE TABLE byai.au_privilege_grant (privilege_grant_id bigint, grant_type character varying(20), oper_type character varying(20), grant_obj_type character varying(20), grant_obj_id bigint, eff_date timestamp without time zone, exp_date timestamp without time zone, status_cd character varying(3), create_staff bigint, create_date timestamp without time zone, update_staff bigint, update_date timestamp without time zone, grant_to_type character varying(20), grant_to_obj_id bigint, grant_to_obj_type character varying(20), allow_unsubscribe character varying);
CREATE TABLE byai.authorized_object_data_permissions (id bigint, permission_group_id bigint, user_id bigint, permissions text, status character varying(32), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.authorized_objects (id bigint, object_type character varying(64), object_id character varying(128), object_name character varying, description text, status character varying(32), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, org_id bigint);
CREATE TABLE byai.byai_agent_server_relation (relation_id bigint, agent_id bigint, server_code character varying, create_time timestamp without time zone, update_time timestamp without time zone, create_by bigint, update_by bigint);
CREATE TABLE byai.byai_ai_prompt (prompt_id bigint, prompt_group_code character varying(50), prompt_code character varying(200), prompt_name character varying(200), prompt_desc character varying(500), prompt_filed_code character varying(100), prompt_zh_template text, prompt_en_template text, create_by bigint, create_time timestamp without time zone, update_time timestamp without time zone, model_code character varying(500));
CREATE TABLE byai.byai_aimodel (model_id bigint, model_type character varying(56), model_name character varying(512), model_no character varying(512), url character varying(2000), ori_url character(10), auth_token character varying(2000), status character varying(3), is_support_chart character varying(3), is_deepthink character varying(3), max_content_token integer, in_params text, create_by bigint, create_time timestamp without time zone, inparam_template character varying);
CREATE TABLE byai.byai_alert_info (alter_id bigint, target_type character varying(100), target_sub_type character varying(100), target_id character varying(100), alter_content character varying(500), alter_time timestamp without time zone, alter_content_sha256 character varying, instance_ip character varying, alert_info text, status character varying(50));
CREATE TABLE byai.byai_attach_file (attach_file_id bigint, source_file_id bigint, file_type character varying(256), file_name character varying(300), file_location_type character varying(10), file_location character varying(300), table_name character varying(30), table_pk_name character varying(30), table_pk_value bigint, table_field_name character varying(30), batch_id bigint, create_date timestamp with time zone, state character varying(10), source_id bigint, create_user_id bigint);
CREATE TABLE byai.byai_customer_leads (id bigint, company_name character varying(100), contact_name character varying(100), industry character varying(100), phone character varying(20), wechat character varying(50), demand text, create_time timestamp without time zone);
CREATE TABLE byai.byai_dbresource_rel (rel_id bigint, obj_id bigint, obj_type character varying, record_id bigint);
CREATE TABLE byai.byai_files (file_id bigint, file_name character varying(200), file_type character varying(16), length bigint, file_md5 character varying(128), file_url character varying(255), upload_date timestamp without time zone, create_by bigint, team_id bigint, dataset_id bigint, file_collect_id bigint, file_system_type character varying(16), upload_state character varying(50), chunk_size bigint, convert_file_url character varying, convert_file_name character varying(255), content_type character varying(100), is_aqs integer, convert_pdf character varying(32), dataset_type character varying(4), complete_time timestamp without time zone, build_conf text, filter_bits bytea, third_file_id character varying(64), tags character varying(512), chat_id bigint, build_extend_param text, effective_time_start timestamp without time zone, effective_time_end timestamp without time zone, file_status character varying(4), project_id bigint);
CREATE TABLE byai.byai_message (id bigint NOT NULL, access_terminal character varying(256), append_index bigint, archived_at timestamp without time zone, belong_date date, call_logs text, create_time timestamp without time zone, creator_id bigint, creator_name text, enterprise_id bigint, final_content text, final_message_struct text, infer_log text, is_complete boolean, message_content text, message_id bigint, message_ref bigint, message_struct text, metadata text, msg_status integer, project_id bigint, rel_message_id bigint, rel_objs text, related_resources text, res_com_id bigint, res_com_ids text, role text, session_id bigint, task_id bigint, update_time timestamp without time zone, usage integer, doc_access_terminal character varying(256), doc_belong_date date, doc_create_time character varying(256), doc_creator_id bigint, doc_infer_log text, doc_is_complete boolean, doc_message_content text, doc_message_id bigint, doc_message_struct text, doc_metadata text, doc_msg_status bigint, doc_project_id bigint, doc_related_resources text, doc_res_com_ids text, doc_session_id bigint, doc_task_id bigint, doc_usage bigint);
CREATE TABLE byai.byai_message_relobj (id bigint NOT NULL DEFAULT nextval('byai.byai_message_relobj_id_seq'::regclass), ask_access_terminal character varying(256), ask_content text, ask_content_tags character varying(256), ask_content_vector text, ask_msg_id bigint, ask_obj_id bigint, ask_obj_type character varying(256), ask_time timestamp without time zone, com_acct_id bigint, create_time timestamp without time zone, feedback_content text, feedback_label character varying(256), feedback_score double precision, feedback_time timestamp without time zone, feedback_type character varying(256), first_text_duration double precision, input_token_count double precision, output_token_count double precision, output_token_per_second double precision, project_id bigint, rel_id bigint, request_status integer, res_access_terminal character varying(256), res_content text, res_content_tags character varying(256), res_content_vector text, res_msg_id bigint, res_obj_id bigint, res_obj_type character varying(256), res_time timestamp without time zone, session_id bigint, task_due_time double precision, task_id bigint, doc_ask_access_terminal text, doc_ask_content text, doc_ask_msg_id bigint, doc_ask_obj_id bigint, doc_ask_obj_type text, doc_ask_time text, doc_com_acct_id bigint, doc_create_time text, doc_feedback_type text, doc_first_text_duration double precision, doc_input_token_count double precision, doc_output_token_count double precision, doc_output_token_per_second double precision, doc_project_id bigint, doc_request_status bigint, doc_res_access_terminal text, doc_res_content text, doc_res_msg_id bigint, doc_res_obj_id bigint, doc_res_obj_type text, doc_res_time text, doc_session_id bigint, doc_task_due_time double precision, doc_task_id bigint);
CREATE TABLE byai.byai_mode (mode_code character varying, mode_name character varying, show_digital_human smallint, is_default smallint);
CREATE TABLE byai.byai_mode_dig_rel (rel_id bigint, mode_code character varying, resource_id bigint);
CREATE TABLE byai.byai_monitor_instance (id bigint, target_sub_type character varying, instance_ip character varying, instance_port character varying, instance_name character varying, instance character varying, target_id bigint);
CREATE TABLE byai.byai_monitor_instance_interface (id bigint, target_sub_type character varying, availability smallint, alert_count bigint, create_time timestamp without time zone, update_time timestamp without time zone, create_by bigint, update_by bigint, instance character varying, instance_name character varying, target_id character varying, interface_name character varying);
CREATE TABLE byai.byai_monitor_target (target_id bigint, target_name character varying(200), target_type character varying(50), enabled smallint, alert_enabled smallint, availability smallint, alter_count bigint, target_sub_type character varying, create_time timestamp without time zone, update_time timestamp without time zone, create_by bigint, update_by bigint, agent_id bigint, target_quality character varying(32), quality_description character varying(2048));
CREATE TABLE byai.byai_monitor_target_config (config_id bigint, target_id bigint, config_code character varying(255), config_value character varying(1024), create_time timestamp without time zone, update_time timestamp without time zone, create_by bigint, update_by bigint);
CREATE TABLE byai.byai_notification (id bigint, title character varying(255), content text, biz_type smallint, priority smallint, is_read character varying(1), resource_biz_type character varying(255), resource_id bigint, is_deleted character varying(1), sender_id bigint, target_id bigint, create_time timestamp without time zone, read_time timestamp without time zone, expire_time timestamp without time zone, extra_info text);
CREATE TABLE byai.byai_schedule_task (task_id bigint, task_name character varying(50), task_type character varying(50), resource_id bigint, schedule_task_id bigint, schedule_dn_id bigint, status_cd character varying(50), executor_id bigint, execution_cycle character varying(50), execution_frequency character varying(50), execution_time character varying(50), execution_content text, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.byai_schedule_task_inst (task_inst_id bigint, task_id bigint, cycle_val character varying(20), start_time timestamp without time zone, end_time timestamp without time zone, execution_content text, execution_result text, execution_exception text, status_cd character varying(10), status_time timestamp without time zone);
CREATE TABLE byai.byai_sequence (sequence_id bigint, sequence_name character varying(128), current_value bigint, increment_by integer, seq_comment character varying(128));
CREATE TABLE byai.byai_session (session_id bigint, parent_session_id bigint, session_name character varying(255), create_time timestamp without time zone, creator_id bigint, object_type character varying(255), object_id bigint, enterprise_id bigint, session_content character varying(4000), is_debug integer, session_type character varying(10), update_by bigint, update_time timestamp without time zone, state text);
CREATE TABLE byai.byai_session_ext (ext_id bigint, session_id bigint, ext_param_name character varying(255), ext_param_code character varying(255), ext_param_value text);
CREATE TABLE byai.byai_session_member (byai_session_member_id bigint, session_id bigint, mem_obj_type character varying(32), mem_obj_id bigint, user_role character varying(10), create_time timestamp without time zone, creator_id bigint, com_acct_id bigint, mem_name character varying, request_count bigint);
CREATE TABLE byai.byai_session_workspace (id bigint, session_id bigint, name character varying, rel_count integer, create_time timestamp without time zone, create_by bigint, update_time timestamp without time zone, update_by bigint, icon character varying, file_id bigint, file_url character varying, is_exist smallint);
CREATE TABLE byai.byai_showcase (id bigint, session_id bigint, type character varying, task_id bigint, content character varying, name character varying, message_id bigint, agent_id bigint, agent_code character varying, session_mode character varying, create_time timestamp without time zone, update_time timestamp without time zone, create_by bigint, update_by bigint, url character varying, file_id character varying(128), file_code character varying, status character varying);
CREATE TABLE byai.byai_space_dir (dir_id bigint, parent_dir_id bigint, name character varying(100), dir_type character varying(50), sort integer, description character varying(500), create_by bigint, create_time timestamp without time zone, update_time timestamp without time zone, session_id bigint);
CREATE TABLE byai.byai_space_dir_rel (dir_rel_id bigint, dir_id bigint, data_id bigint, data_type character varying(100), ext_json text);
CREATE TABLE byai.byai_system_config (param_id bigint, param_type character varying(255), param_code character varying(255), param_name character varying(255), param_en_name character varying(255), param_value text, param_desc character varying(1024));
CREATE TABLE byai.byai_system_config_list (param_id bigint, param_group_code character varying(256), param_group_name character varying(500), param_name character varying(256), param_en_name character varying(256), param_value text, param_desc character varying(1024), param_seq integer);
CREATE TABLE byai.byai_system_feedback (id bigint, user_id bigint, feedback_type character varying(20), title character varying(100), content text, contact_info character varying(100), status character varying(20), priority smallint, system_version character varying(50), device_info character varying(200), ip_address character varying(50), screenshot_url character varying(255), create_date timestamp without time zone, update_date timestamp without time zone, process_user_id bigint, process_date timestamp without time zone, process_comment text);
CREATE TABLE byai.byai_tag_relation (relation_id bigint, tag_id bigint, obj_id bigint, obj_type character varying(64), create_time timestamp without time zone, creator_by bigint, obj_code character varying);
CREATE TABLE byai.byai_track_log (trace_id bigint, user_id bigint, event_code character varying(128), event_name character varying(64), event_type character varying(64), element_id character varying(128), element_code character varying(128), element_name character varying(128), object_id bigint, object_type character varying(128), page_path character varying(255), page_title character varying(255), browser_info character varying(1024), ip character varying(64), device_id character varying(100), device_model character varying(100), os_type character varying(100), create_time timestamp without time zone, ext_params text);
CREATE TABLE byai.byai_web_crawl_archive_doc (doc_archive_id bigint, request_id bigint, title character varying(1000), source_url character varying(2000), content_snippet text, status character varying(16), file_id bigint, failure_reason character varying(1000), score double precision, create_time timestamp without time zone, create_by bigint);
CREATE TABLE byai.byai_web_crawl_request (request_id bigint, session_id bigint, query character varying(2000), create_time timestamp without time zone, create_by bigint);
CREATE TABLE byai.datacloud_login_type (login_type_id bigint, login_type_code character varying(50), login_type_name character varying(100), login_type_description text, login_type_config text, is_active integer, sort_order integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.datacloud_script (script_id bigint, script_name character varying(255), script_type character varying(20), script_description text, script_status character varying(20), scenario_id bigint, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, version integer, tags character varying(500), step_count integer, publish_status integer, view_id bigint);
CREATE TABLE byai.datacloud_script_category (category_id bigint, category_name character varying(100), category_code character varying(50), parent_id bigint, category_description text, category_order integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_execution (execution_id bigint, script_id bigint, execution_name character varying(255), execution_status character varying(20), execution_params text, execution_result text, error_message text, start_time timestamp without time zone, end_time timestamp without time zone, duration bigint, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_history (history_id bigint, script_id bigint, version integer, script_content text, change_description text, change_type character varying(20), change_details text, step_count integer, step_changes text, status_before character varying(20), status_after character varying(20), enterprise_id bigint, creator_id bigint, create_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_scenario (scenario_id bigint, scenario_name character varying(255), scenario_description text, scenario_code character varying(100), target_url text, attribution_system character varying(500), parent_id bigint, login_type_id bigint, scenario_order integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_step (step_id bigint, script_id bigint, template_id bigint, script_content text, meta_infos text, step_order integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, script_desc text);
CREATE TABLE byai.datacloud_script_step_history (step_history_id bigint, step_id bigint, script_id bigint, step_name character varying(255), step_type character varying(50), step_content text, step_order integer, step_description text, selector_info text, expected_result text, input_schema text, output_schema text, param_mapping text, change_description text, change_type character varying(20), change_details text, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_template (template_id bigint, template_name character varying(255), template_type character varying(50), framework character varying(50), py_template_content text, node_template_content text, meta_infos text, template_description text, is_active integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.datacloud_script_view (view_id bigint, view_name character varying(255), view_description text, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, resource_id bigint, publish_status smallint, resource_project_id bigint, rel_obj_id bigint);
CREATE TABLE byai.datacloud_target_script (target_script_id bigint, script_id bigint, py_script_content text, node_script_content text, target_selector text, type character varying(50), ext_params text, target_order integer, enterprise_id bigint, creator_id bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, meta_infos text, next_page_selector character varying(500), max_pages character varying(255));
CREATE TABLE byai.default_data_permissions (id bigint, permission_group_id bigint, data_scope_type character varying(64), data_scope_config jsonb, field_permissions jsonb, row_permissions jsonb, status character varying(32), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.digital_position_user_relation (dig_position_rel_id bigint, position_id bigint, user_id bigint, create_by character varying(100), create_time timestamp without time zone, update_by character varying(100), update_time timestamp without time zone);
CREATE TABLE byai.error_import (error_code character varying(100));
CREATE TABLE byai.feedback_msg_info (feedback_msg_id bigint, create_user bigint, create_time timestamp without time zone, is_handle integer, assign_user bigint, handle_user bigint, handle_time timestamp without time zone, is_assign integer);
CREATE TABLE byai.function_menu_permission (id bigint, employee_id bigint, menu_code character varying(64), menu_name character varying(128), permission_type character varying(32), create_time timestamp without time zone, update_time timestamp without time zone);
CREATE TABLE byai.import_station_rela (user_id bigint, station character varying(255), station_id bigint, user_code character varying(20));
CREATE TABLE byai.kw_term_relation (term_relation_id character varying(64), term_spec_id character varying(64), p_term_spec_id character varying(64), relation_type character varying(32), create_time timestamp without time zone, create_by bigint, update_by bigint, update_date timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.kw_term_spec (term_spec_id character varying(64), term_id character varying(64), term_code character varying(64), term_name character varying(128), term_type character varying(32), validation_rule character varying(64), description character varying(1024), create_time timestamp without time zone, create_by bigint, update_by bigint, update_date timestamp without time zone, com_acct_id bigint, source_type character varying(255));
CREATE TABLE byai.kw_term_word (term_word_id character varying(64), term_spec_id character varying(64), term_type character varying(64), word_code character varying(64), word_name character varying(64), create_time timestamp without time zone, create_by bigint, update_by bigint, update_date timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.log_exception_info (request_id bigint, sys_code character varying(30), error_code character varying(50), error_module character varying(50), error_msg text, error_stack text, class_name character varying(200), method_name character varying(200), thread_name character varying(100), host_ip character varying(50), request_url character varying(500), request_header text, request_body text, user_id bigint, user_name character varying(100), create_time timestamp without time zone, session_id character varying(50));
CREATE TABLE byai.mem_adk_app_states (app_name character varying(128), state text, update_time timestamp without time zone);
CREATE TABLE byai.mem_adk_user_states (app_name character varying(128), user_id character varying(128), state text, update_time timestamp without time zone);
CREATE TABLE byai.memory_library (library_id bigint, mem_library_id bigint, agent_id bigint, user_id bigint, library_type character varying(50), is_enabled integer, create_by bigint, update_by bigint, create_time timestamp without time zone, update_time timestamp without time zone);
CREATE TABLE byai.men_res_com (res_com_id bigint, res_type integer, res_page text, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.men_task (task_id bigint, task_type character varying(32), title character varying(512), content text, res_com_id bigint, file_out_type character varying(32), file_out text, task_dealine_time timestamp without time zone, send_type character varying(10), send_obj_id bigint, deal_type character varying(10), deal_obj_id bigint, deal_desc text, session_id bigint, ori_task_id bigint, message_id bigint, message_step_code character varying(64), status_cd character varying(32), p_task_id bigint, task_ext_id character varying(128), priority character varying(32), page_id character varying(64), system_no character varying(64), load_sso_iframe_url character varying(256), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint, resource_biz_type character varying, approve_content character varying, resource_id bigint);
CREATE TABLE byai.men_task_catalog (task_catalog_id bigint, cata_name character varying(512), p_catalog_id character varying(64), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint, task_id bigint);
CREATE TABLE byai.men_task_rec_obj (task_rec_obj_id bigint, task_id bigint, reci_type character varying(50), reci_obj_id bigint, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.men_task_status_log (task_status_log_id bigint, task_id bigint, status_cd_old character varying(32), status_cd character varying(32), message_id bigint, message_step_code character varying(64), chang_desc text, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.message_share_link (link_id numeric(20,0), link_token character varying(128), creator_id numeric(20,0), status character varying(32), access_permission character varying(32), expire_time timestamp without time zone, max_access_count numeric(20,0), current_access_count numeric(20,0), last_access_time timestamp without time zone, create_time timestamp without time zone, update_time timestamp without time zone, com_acct_id numeric(20,0), title character varying(200));
CREATE TABLE byai.message_share_link_message (id numeric(20,0), link_id numeric(20,0), message_id numeric(20,0), create_time timestamp without time zone, com_acct_id numeric(20,0));
CREATE TABLE byai.permission_group_authorized_objects (id bigint, permission_group_id bigint, authorized_object_id bigint, effective_at timestamp without time zone, expires_at timestamp without time zone, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, object_type character varying(255));
CREATE TABLE byai.permission_group_categories (id bigint, category_name character varying, parent_id bigint, category_code character varying(128), description text, icon character varying(128), sort_order integer, status character varying(32), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, org_id bigint);
CREATE TABLE byai.permission_group_excluded_objects (id bigint, permission_group_id bigint, excluded_object_id bigint, object_type character varying(50), effective_at timestamp without time zone, expires_at timestamp without time zone, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.permission_group_resources (id bigint, permission_group_id bigint, resource_id bigint, permission_type character varying(64), permission_config jsonb, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, resource_type character varying(500));
CREATE TABLE byai.permission_groups (id bigint, category_id bigint, group_name character varying, parent_id bigint, group_code character varying(128), description text, sort_order integer, status character varying(32), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, org_id bigint);
CREATE TABLE byai.po_enterprise_info (enterprise_id bigint, com_acct_name character varying(200), com_acct_code character varying(100), system_name character varying(255), com_acct_address text, logo_data bytea, copyright character varying(500), demo_switch character(1), project_switch character(1));
CREATE TABLE byai.po_login_log (log_id bigint, user_id bigint, login_time timestamp without time zone, logout_time timestamp without time zone, ip_address character varying(50), status integer, error_reason character varying(255), device_id character varying(100), device_model character varying(100), os_type character varying(100), browser_info character varying(500), login_type character varying(20), session_id character varying(100), remark text);
CREATE TABLE byai.po_manage_log (log_id bigint, module_name character varying(100), module_description text, operator_user_id bigint, operator_user_name character varying(50), ip_from character varying(255), operator_param text, operator_response text, operator_time timestamp without time zone, class_name character varying(150), method character varying(100));
CREATE TABLE byai.po_org_external_system (po_org_external_system_id bigint, union_id character varying(56), source_type integer, source_dep_id bigint, source_dep_code character varying(255), source_dep_name character varying(255), source_parent_dep_id bigint, binding_time timestamp without time zone, org_id bigint);
CREATE TABLE byai.po_organization (org_id bigint, org_code character varying(250), org_name character varying(100), org_type character varying(4), parent_org_id bigint, org_level integer, org_index integer, create_date timestamp without time zone, update_date timestamp without time zone, path_code character varying(500), org_desc character varying(1000));
CREATE TABLE byai.po_position (position_id bigint, position_name character varying, position_desc character varying, is_digital_position smallint);
CREATE TABLE byai.po_position_ext_catalog (position_id bigint, catalog_id bigint, create_by character varying(100), create_time timestamp without time zone, update_by character varying(100), update_time timestamp without time zone);
CREATE TABLE byai.po_position_external (position_external_id bigint, union_id character varying(56), position_name character varying(255), position_desc character varying(255), source_type integer, position_id bigint);
CREATE TABLE byai.po_safe_account_msg (msg_id bigint, phone character varying(100), verify_code character varying(100), msg_type character varying(10), create_date timestamp without time zone, state character varying(10), effective_minutes integer, send_date timestamp without time zone, expire_date timestamp without time zone);
CREATE TABLE byai.po_source_system (po_external_system_id bigint, system_code character varying(56), system_name character varying(128), sso_url character varying(2000), app_key character varying(1024), app_secret character varying(2048), get_token_url character varying(2000), refresh_token_url character varying(2000), create_time timestamp without time zone, create_user bigint, com_acct_id bigint, redirect_uri character varying(200), enabled character varying(5), user_info_url character varying(200));
CREATE TABLE byai.po_station (station_id bigint, station_name character varying(200), station_type integer, station_id_path character varying(500), p_station_id bigint, is_abroad integer, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.po_user_access_token (user_access_token_id bigint, user_id bigint, access_token_name character varying(255), access_token character varying(2000), token_status character varying(3), start_time timestamp without time zone, end_time timestamp without time zone, create_user bigint, create_time timestamp without time zone, com_acct_id integer, last_active_time timestamp without time zone);
CREATE TABLE byai.po_user_account_change_log (change_log_id bigint, user_id bigint, change_type character varying(20), change_time timestamp without time zone, old_value character varying(255), new_value character varying(255), need_reverify smallint, create_time timestamp without time zone);
CREATE TABLE byai.po_user_common_ip (common_ip_id bigint, user_id bigint, ip_address character varying(50), first_use_time timestamp without time zone, last_use_time timestamp without time zone, use_count integer, create_time timestamp without time zone, update_time timestamp without time zone);
CREATE TABLE byai.po_user_external_system (id bigint, user_id bigint, source_type integer, source_account character varying(255), source_nickname character varying(255), source_email character varying(255), source_dep_id character varying(255), source_dep_name character varying(255), union_id character varying(255), binding_time timestamp without time zone);
CREATE TABLE byai.po_user_menu (user_id bigint, menu_detail text);
CREATE TABLE byai.po_users (user_id bigint, user_name character varying(255), email character varying(255), phone character varying(255), user_code character varying(255), pwd character varying(255), address text, remark character varying(255), user_eff_date timestamp without time zone, user_exp_date timestamp without time zone, create_date timestamp without time zone, update_date timestamp without time zone, state character(1), state_time timestamp without time zone, is_locked character(1), last_login_date timestamp without time zone, security_question_id numeric(3,0), security_answer character varying(120), thumbnail_uri character varying(400), ext_attr character varying(1000), assistant_id bigint, user_number character varying(300), station_id bigint, register_type smallint, apple_user_id character varying(255));
CREATE TABLE byai.po_users_organization (id bigint, user_id bigint, org_id bigint, position_id bigint, user_type character varying(50));
CREATE TABLE byai.po_users_organization_external_system (po_users_organization_external_id bigint, unionid character varying(56), po_user_external_system_id bigint, po_org_external_system_id bigint, source_type integer, users_organization_id bigint);
CREATE TABLE byai.query_config (query_id bigint, query_code character varying(100), name character varying(200), sql_template text, dimension_fields character varying(500), measure_fields character varying(500), condition_fields character varying(500), status integer, created_time timestamp without time zone, updated_time timestamp without time zone, created_by character varying(100), description character varying, query_type character varying, query_method character varying(20), db_type character varying(50));
CREATE TABLE byai.resource_attribute_permissions (id bigint, resource_id bigint, resource_attribute_id bigint, data_scope_type character varying(50), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone);
CREATE TABLE byai.resource_rule_enabled (resource_template_id bigint, template_id bigint, resource_id bigint, user_id bigint, resource_enabled smallint, update_by bigint, create_time timestamp without time zone, update_time timestamp without time zone);
CREATE TABLE byai.resource_template_relation (resource_template_id bigint, template_id bigint, resource_id bigint, create_time timestamp without time zone, create_by bigint, memory_rule_id character varying(50));
CREATE TABLE byai.sandbox_service_spec (service_key character varying(128) NOT NULL, spec_json text NOT NULL, template_json text, updated_at timestamp without time zone DEFAULT pg_systimestamp());
CREATE TABLE byai.sandbox_type_definitions (type_key character varying(128) NOT NULL, image character varying(512) NOT NULL, port integer NOT NULL, entrypoint character varying(1024), resource_limits text, mount_files character varying(1024) NOT NULL, mount_targets character varying(1024) NOT NULL, timeout integer, env_file_path character varying(1024), env_file_template text, updated_at timestamp without time zone DEFAULT pg_systimestamp());
CREATE TABLE byai.ss_res_ext_agent (resource_id bigint, agent_type character varying(3), agent_sse_url character varying(2000), agent_web_url character varying(2000), agent_admin_url character varying(2000), prologue text, agent_sse_url_ori character varying(2000), agent_web_url_ori character varying(2000), agent_admin_url_ori character varying(2000), agent_dev_type character varying(10), agent_sse_head text, auth_type character varying(32), integration_type character varying(20), source_content text, target_content text);
CREATE TABLE byai.ss_res_ext_attribute (ext_attribute_id bigint, resource_id bigint, attribute_type character varying(64), attribute_code character varying(255), attribute_value text, type character varying(64), format_exp_st character varying(1024), unit character varying(12), is_required smallint, term_type_code character varying(32), term_field character varying(12), attribute_desc character varying(3000), ext_meta text, sort integer, obj_id bigint);
CREATE TABLE byai.ss_res_ext_db (resource_id bigint, chatbi_base_id character varying(128));
CREATE TABLE byai.ss_res_ext_dbdataset (dataset_id bigint, resource_id bigint, table_join_info text, table_location text, execute_sql text, create_by character varying(100), create_time timestamp without time zone, update_time timestamp without time zone, main_data_source_id bigint);
CREATE TABLE byai.ss_res_ext_dig_employee (resource_id bigint, agent_type character varying(5), agent_dev_type character varying(10), agent_sse_head text, agent_sse_url character varying(2000), agent_web_url character varying(2000), agent_admin_url_list text, prologue text, agent_sse_url_ori character varying(2000), agent_web_url_ori character varying(2000), agent_admin_url_ori_list text, create_type character varying(20), agent_home_url character varying(2000), home_type character varying(128), auth_type character varying(32), integration_type character varying(20), ability character varying(4000), constraints character varying(4000), faqs character varying(4000), role_attributes character varying(4000), processing_flow character varying(5000), personality_dimensions character varying(4000), word_preferences character varying(4000), sentence_and_tone character varying(4000), terminal character varying(10) DEFAULT 'ALL'::character varying, tag_name character varying(255), core_competencies text, open_super_helper character(1) DEFAULT 'N'::bpchar, machine_channel character varying(500), core_persona_definition text, advanced_settings character varying(2000), skills text, target_content text );
CREATE TABLE byai.ss_res_ext_doc (resource_id bigint, resource_agent_id bigint, type character varying(20) DEFAULT 'dataset'::character varying, plugin_machine_id bigint, kdb_id bigint, resource_catalog_main character varying(50) DEFAULT 'personal'::character varying, resource_catalog_sub character varying(50), source_content text, target_content text);
CREATE TABLE byai.ss_res_ext_evaluate (evaluate_id bigint, resource_id bigint, evaluate_time timestamp without time zone, test_set_accuracy numeric(5,2), actual_use_accuracy numeric(5,2), conversation_error_rate numeric(5,2), avg_first_response_duration numeric(10,2), persona_specification_score numeric(5,2), ability_post_matching_score numeric(5,2), is_qualified_for_post smallint, create_by character varying(100), create_time timestamp without time zone, update_time timestamp without time zone, evaluate_result character varying(200));
CREATE TABLE byai.ss_res_ext_mcpserver (resource_id bigint, mcp_server_url character varying(2000), mcp_transfer_type character varying(20), mcp_header character varying(1024), mcp_command character varying(1024), mcp_args text, mcp_env text, mcp_timeout integer, mcp_server_url_ori character varying(2000));
CREATE TABLE byai.ss_res_ext_mcptool (resource_id bigint, input_schema text, method character varying(10), pathschema text, queryschema text, relresourcecode character varying(255));
CREATE TABLE byai.ss_res_ext_obj (resource_id bigint, table_id bigint, schema_id bigint);
CREATE TABLE byai.ss_res_ext_object (resource_id bigint, mcp_server_url character varying(200), mcp_transfer_type character varying(20), source_content text, target_content text);
CREATE TABLE byai.ss_res_ext_ontology (resource_id bigint, pid character varying(32));
CREATE TABLE byai.ss_res_ext_test_set (test_set_id bigint, resource_id bigint, batch_id character varying(100), file_id character varying(100), file_name character varying(100), file_url character varying(500), process_status smallint, fail_reason character varying(1000), test_set_accuracy numeric(5,2), test_set_intent_recognition_accuracy numeric(5,2), create_by character varying(100), create_time timestamp without time zone, update_time timestamp without time zone);
CREATE TABLE byai.ss_res_ext_tool (resource_id bigint, input_schema text, output_schema text, url character varying(2000), url_ori character varying(2000), method character varying(255), path_schema text, query_schema text, tool_add_type character varying(50), source_content text, target_content text);
CREATE TABLE byai.ss_res_ext_toolkit (resource_id bigint, headers text,source_content text,target_content text);
CREATE TABLE byai.ss_res_ext_mcp (resource_id INT8,source_content TEXT,target_content TEXT);
CREATE TABLE byai.ss_res_ext_view (resource_id bigint, mcp_server_url character varying(200), mcp_transfer_type character varying(20), source_content text, target_content text);
CREATE TABLE byai.ss_res_position_relation (resource_position_rel_id bigint, position_id bigint, resource_id bigint, status smallint, create_by character varying(100), approver character varying(100), on_job_time timestamp without time zone, approval_reason character varying(500), create_time timestamp without time zone, update_by character varying(100), update_time timestamp without time zone);
CREATE TABLE byai.ss_resource (resource_id bigint, system_code character varying(32), resource_source_pk_id bigint, resource_biz_type character varying(20), resource_type character varying(10), resource_name character varying(300), resource_desc character varying(4000), avatar character varying(1024), sample text, tags text, resource_version_id character varying(20), host_type character varying(10), catalog_id bigint, man_org_id bigint, man_user_id character varying(500), index_list text, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint, resource_status integer, resource_d_verid bigint, resource_r_verid bigint, resource_code character varying(255), publish_time timestamp without time zone, shelf_time timestamp without time zone, unshelf_time timestamp without time zone, auth_status character varying(10), publish_portal smallint, parent_resource_id bigint DEFAULT (-1), publish_type character varying(10), owner_type character varying(20), impl_type character varying(20), worker_agent_type character varying(20) );
CREATE TABLE byai.ss_resource_catalog (catalog_id bigint, catalog_name character varying(128), catalog_desc character varying(2000), p_catalog_id bigint, catalog_type integer, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint, catalog_path character varying(256), order_index integer, resource_id bigint);
CREATE TABLE byai.ss_resource_employee_tmp (resource_id bigint, system_code character varying(32), resource_source_pk_id bigint, resource_biz_type text, resource_type character varying(10), resource_name character varying(128), resource_desc character varying(1024), avatar character varying(1024), sample text, tags text, resource_version_id character varying(20), host_type character varying(10), catalog_id bigint, man_org_id bigint, man_user_id bigint, index_list text, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint, resource_status integer, resource_d_verid integer, resource_r_verid bigint, resource_code character varying(255), publish_time timestamp without time zone, shelf_time timestamp without time zone, unshelf_time timestamp without time zone, auth_status character varying(10));
CREATE TABLE byai.ss_resource_oper_log (resource_oper_log_id bigint, resource_id bigint, oper_type character varying(32), oper_user character varying(20), oper_desc character varying(512), oper_param text, version_no character varying(20), create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.ss_resource_position_relation (position_rel_id bigint, position_id bigint, resource_id bigint, status smallint, create_by character varying(100), approver character varying(100), on_job_time timestamp without time zone, approval_reason character varying(500), create_time timestamp without time zone, update_by character varying(100), update_time timestamp without time zone);
CREATE TABLE byai.ss_resource_rel_detail (resource_rel_detail_id bigint, resource_id bigint, rel_resource_id bigint, create_by bigint, create_time timestamp with time zone, update_by bigint, update_time timestamp with time zone, com_acct_id bigint, rel_type_name character varying(500), rel_status smallint, rel_resource_info text);
CREATE TABLE byai.ss_resource_syn (syn_id bigint NOT NULL, resource_id bigint, system_code character varying(32), resource_source_pk_id bigint, resource_biz_type character varying(20), resource_type character varying(10), resource_name character varying(128), resource_desc character varying(4000), create_by bigint, create_date timestamp without time zone, update_date timestamp without time zone, repository character varying(4000));
CREATE TABLE byai.ss_resource_version (resource_version_id bigint, resource_id bigint, system_code character varying(32), resource_source_pk_id bigint, resource_biz_type character varying(20), resource_type character varying(10), resource_name character varying(128), resource_desc character varying(1024), avatar character varying(1024), sample text, tags text, version_no character varying(20), catalog_id bigint, man_org_id bigint, man_user_id character varying(500), index_list text, publisher character varying(20), ext_info text, rel_resource_list text, resource_status integer, version_status integer, create_by bigint, create_time timestamp without time zone, update_by bigint, update_time timestamp without time zone, com_acct_id bigint);
CREATE TABLE byai.ss_resource_artifact ( artifact_id BIGINT NOT NULL, resource_id BIGINT NOT NULL, resource_biz_type VARCHAR(100) NOT NULL, artifact_type VARCHAR(100) NOT NULL, storage_type VARCHAR(32) NOT NULL, artifact_path VARCHAR(1024) NOT NULL, status_cd VARCHAR(8) NOT NULL DEFAULT 'A', remark VARCHAR(1000) DEFAULT NULL, create_by BIGINT DEFAULT NULL, create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, update_by BIGINT DEFAULT NULL, update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, com_acct_id BIGINT DEFAULT NULL, CONSTRAINT pk_ss_resource_artifact PRIMARY KEY (artifact_id) );
CREATE TABLE byai.ss_sandbox_record (id bigint NOT NULL DEFAULT nextval('byai.ss_sandbox_record_id_seq'::regclass), resource_id bigint NOT NULL, user_code character varying(500) NOT NULL, sandbox_type character varying(500) NOT NULL, endpoint character varying(3000), sandbox_id character varying(128), chat_id character varying(128), status character varying(32) NOT NULL DEFAULT 'RUNNING'::character varying, auto_release integer DEFAULT 1, lease_policy character varying(32) DEFAULT 'REMOTE_AUTO_EXPIRE'::character varying, timeout_seconds integer, remote_expires_at timestamp(6) without time zone, last_renew_at timestamp(6) without time zone, next_renew_at timestamp(6) without time zone, last_access_time timestamp(6) without time zone, release_time timestamp(6) without time zone, release_reason text, version integer DEFAULT 0, create_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp(), update_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp());
CREATE TABLE byai.ss_superassist_kw_catalog (kw_catalog_id bigint, superassist_id bigint, session_type character varying(200), is_last_session character varying(200), session_id bigint, session_datasetid bigint, catalog_id bigint, create_time timestamp without time zone, create_user bigint, enterprise_id bigint);
CREATE TABLE byai.suas_superassist (superassist_id bigint, avatar character varying(255), intro text, name character varying(255), create_time timestamp with time zone, prologue text, status character varying(2), com_acct_id bigint, session_dataset_id bigint, create_user bigint, default_dig_employee_id bigint);
CREATE TABLE byai.suas_superassist_resource_privilege (id bigint, superassist_id bigint, resource_id bigint, resource_type character varying(32), create_time timestamp without time zone, privilege_type character varying(5));
CREATE TABLE byai.suas_superassist_sub_agent (superassist_sub_agent_id bigint, superassist_id bigint, agent_id bigint, create_by bigint, update_by bigint, update_date timestamp without time zone, com_acct_id bigint, create_time timestamp without time zone, top_time timestamp without time zone, is_top smallint, agent_type character varying(32), is_sub smallint, sub_time timestamp without time zone, status_cd character varying(3));
CREATE TABLE byai.sys_app_version (version_id bigint, device_type character varying(10), app_version character varying(10), url character varying(255), update_type character varying(255), update_msg character varying(255), publish_time timestamp without time zone, update_status character varying);
CREATE TABLE byai.temp (resource_id bigint);
CREATE TABLE byai.template_rule_info (template_id bigint, template_type character varying(50), user_id bigint, rule_name character varying(255), rule_content text, update_by bigint, create_time timestamp without time zone, update_time timestamp without time zone, is_memory_template smallint);

-- ========== 索引 ==========
CREATE INDEX idx_sandbox_user_resource ON byai.ss_sandbox_record USING btree (user_code, resource_id, status) TABLESPACE pg_default;
CREATE INDEX idx_sandbox_status ON byai.ss_sandbox_record USING btree (status) TABLESPACE pg_default;
CREATE INDEX idx_sandbox_auto_release_timeout ON byai.ss_sandbox_record USING btree (status, auto_release, last_access_time) TABLESPACE pg_default;
CREATE UNIQUE INDEX ux_ss_sandbox_record_active ON byai.ss_sandbox_record USING btree (user_code, sandbox_type, resource_id) TABLESPACE pg_default WHERE status IN ('STARTING'::character varying, 'RUNNING'::character varying, 'RELEASING'::character varying);
CREATE INDEX idx_ss_sandbox_record_due_renew ON byai.ss_sandbox_record USING btree (status, lease_policy, next_renew_at) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_record_auto_release ON byai.ss_sandbox_record USING btree (status, auto_release, last_access_time) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_resid_status ON byai.ss_resource_artifact (resource_id, status_cd);
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_biztype_status ON byai.ss_resource_artifact (resource_biz_type, status_cd);
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_path_status ON byai.ss_resource_artifact (artifact_path, status_cd);
CREATE UNIQUE INDEX IF NOT EXISTS uk_ss_res_artifact_unique_active ON byai.ss_resource_artifact (resource_id, artifact_type, artifact_path, status_cd);

-- ========== 约束 ==========
ALTER TABLE byai.byai_message ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_message_relobj ADD PRIMARY KEY (id);
ALTER TABLE byai.sandbox_service_spec ADD PRIMARY KEY (service_key);
ALTER TABLE byai.sandbox_type_definitions ADD PRIMARY KEY (type_key);
ALTER TABLE byai.ss_resource_syn ADD PRIMARY KEY (syn_id);
ALTER TABLE byai.ss_sandbox_record ADD PRIMARY KEY (id);

-- ========== 注释 ==========
COMMENT ON TABLE byai.byai_system_config IS '系统静态参数配置表';
COMMENT ON COLUMN byai.byai_system_config.param_id IS '参数ID';
COMMENT ON COLUMN byai.byai_system_config.param_type IS '类型txt:文本,json:json字符';
COMMENT ON COLUMN byai.byai_system_config.param_code IS '静态参数参数编码码';
COMMENT ON COLUMN byai.byai_system_config.param_name IS '参数名称';
COMMENT ON COLUMN byai.byai_system_config.param_en_name IS '参数英文名称';
COMMENT ON COLUMN byai.byai_system_config.param_value IS '静态参数值';
COMMENT ON COLUMN byai.byai_system_config.param_desc IS '静态参数描述';
COMMENT ON TABLE byai.po_user_external_system IS '用户外部信息表';
COMMENT ON COLUMN byai.po_user_external_system.id IS '唯一标识';
COMMENT ON COLUMN byai.po_user_external_system.user_id IS '用户ID';
COMMENT ON COLUMN byai.po_user_external_system.source_type IS '来源类型:0-本系统用户；1-钉钉；2-企业微信；';
COMMENT ON COLUMN byai.po_user_external_system.source_account IS '外部系统账号';
COMMENT ON COLUMN byai.po_user_external_system.source_nickname IS '外部系统昵称';
COMMENT ON COLUMN byai.po_user_external_system.source_email IS '外部系统';
COMMENT ON COLUMN byai.po_user_external_system.source_dep_id IS '外部系统部门编码';
COMMENT ON COLUMN byai.po_user_external_system.source_dep_name IS '外部系统部门名称';
COMMENT ON COLUMN byai.po_user_external_system.union_id IS '唯一标识';
COMMENT ON COLUMN byai.po_user_external_system.binding_time IS '绑定时间';
COMMENT ON TABLE byai.po_users IS '用户表';
COMMENT ON COLUMN byai.po_users.user_id IS '用户唯一标识';
COMMENT ON COLUMN byai.po_users.user_name IS '用户名称';
COMMENT ON COLUMN byai.po_users.email IS '用户邮箱';
COMMENT ON COLUMN byai.po_users.phone IS '用户电话';
COMMENT ON COLUMN byai.po_users.user_code IS '用户登录标识';
COMMENT ON COLUMN byai.po_users.pwd IS '用户密码(md5加密)';
COMMENT ON COLUMN byai.po_users.address IS '用户地址';
COMMENT ON COLUMN byai.po_users.remark IS '用户备注';
COMMENT ON COLUMN byai.po_users.user_eff_date IS '预留';
COMMENT ON COLUMN byai.po_users.user_exp_date IS '用户过期日期';
COMMENT ON COLUMN byai.po_users.create_date IS '记录创建日期';
COMMENT ON COLUMN byai.po_users.update_date IS '记录更新日期';
COMMENT ON COLUMN byai.po_users.state IS '用户状态：A-正常;X-禁用';
COMMENT ON COLUMN byai.po_users.is_locked IS '是否锁定，''Y''-锁定，''N''-没有锁定，null表示''N''';
COMMENT ON COLUMN byai.po_users.last_login_date IS '用户最后一次登录时间';
COMMENT ON COLUMN byai.po_users.security_question_id IS '用户忘记密码找回密码问题';
COMMENT ON COLUMN byai.po_users.security_answer IS '用户忘记密码安全提示问题';
COMMENT ON COLUMN byai.po_users.thumbnail_uri IS '用户头像URL地址';
COMMENT ON COLUMN byai.po_users.ext_attr IS '用户扩展信息';
COMMENT ON COLUMN byai.po_users.assistant_id IS '一个员工对应一个超级助手';
COMMENT ON COLUMN byai.po_users.user_number IS '工号';
COMMENT ON COLUMN byai.po_users.station_id IS '所属驻地';
COMMENT ON COLUMN byai.po_users.register_type IS '注册类型 1-手机号注册';
COMMENT ON COLUMN byai.po_users.apple_user_id IS '苹果用户ID，用于苹果登录关联';
COMMENT ON TABLE byai.ss_res_ext_dig_employee IS '数字员工';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.resource_id IS '数字资源标识';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_type IS '智能体类型：001 agent（综合类智能体）、002 api_agent（流程操作类智能体）、003 doc_agent（文档问答类智能体）、004 db_agent（数据问答类智能体）';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_dev_type IS '智能体开发类型：byai/bot/dify/whaleAgent';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_sse_head IS '服务对接地址头信息（JSON格式）';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_sse_url IS '对话对接地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_web_url IS '页面对接地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_admin_url_list IS '管理页面地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.prologue IS '数字员工配置（JSON格式，包含modelInfo、descText等）';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_sse_url_ori IS '服务对接原始地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_web_url_ori IS '页面对接原始地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_admin_url_ori_list IS '管理页面地址原始地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.create_type IS '创建类型: FROM_MANUALLY-手工创建, FROM_THIRD-从第三方创建, FROM_DEMO-从模板复制';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.agent_home_url IS '首页地址';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.home_type IS '主页类型，default:默认模板，custom:自定义模板';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.auth_type IS '认证类型，session:共享session，oauth2:oauth2认证';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.integration_type IS '集成方式：默认为NONE，可选：PAGE（页面集成）、INTERFACE（接口集成）';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.ability IS '核心能力';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.constraints IS '能力边界';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.faqs IS '示例问法';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.role_attributes IS '角色属性';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.processing_flow IS '处理流程';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.personality_dimensions IS '性格维度';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.word_preferences IS '用词偏好';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.sentence_and_tone IS '句式和语气';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.terminal IS '终端类型 APP:APP端，PC:PC端，ALL:全端';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.tag_name IS '数字员工分类悬浮标签';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.core_competencies IS '数字员工核心能力存储,JSON字符串格式';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.open_super_helper IS '打开超级助手 Y-开启 N-关闭';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.machine_channel IS '数据员工机器渠道配置';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.core_persona_definition IS '核心人设';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.advanced_settings IS '高级设置';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.skills IS '数字员工技能';
COMMENT ON COLUMN byai.ss_res_ext_dig_employee.target_content IS '数字员工目标json';
COMMENT ON TABLE byai.ss_resource IS 'ss_resource resource_source_id & resource_pk_id 形成唯一索引';
COMMENT ON COLUMN byai.ss_resource.resource_id IS '资源标识';
COMMENT ON COLUMN byai.ss_resource.system_code IS '外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY';
COMMENT ON COLUMN byai.ss_resource.resource_source_pk_id IS '存放智能体平台或BOT的resourceId';
COMMENT ON COLUMN byai.ss_resource.resource_biz_type IS '资源类型:

DIG_EMPLOYEE-数字员工

AGENT-智能体

MCP:MCP服务

TOOL- 工具

MCP_TOOL:MCP工具,

TOOLKIT-插件

KG_DOC-文档知识库

KG_DB-数据知识库

KG_TERM-术语知识库

KG_QA-问答知识库

VIEW: 视图

OBJECT: 对象

ACTION: 动作';
COMMENT ON COLUMN byai.ss_resource.resource_type IS 'ATOM：原子资源/COMBIN：组合资源';
COMMENT ON COLUMN byai.ss_resource.resource_name IS '资源名称';
COMMENT ON COLUMN byai.ss_resource.resource_desc IS '资源描述';
COMMENT ON COLUMN byai.ss_resource.avatar IS '资源图标：前端提供的枚举值';
COMMENT ON COLUMN byai.ss_resource.sample IS '常见问题["今天广州的天气怎么样？","["明天广州的天气怎么样？"]';
COMMENT ON COLUMN byai.ss_resource.tags IS '标签:用于关键字检索匹配, ["天气"]';
COMMENT ON COLUMN byai.ss_resource.resource_version_id IS '引用资源版本';
COMMENT ON COLUMN byai.ss_resource.host_type IS '服务模式:hosted:远程，local:本地

托管：用户无需自己搭建服务器和部署环境，平台负责服务的运行、维护和管理，用户可以直接使用这些服务来实现相关的功能。

本地运行：需要用户自己在本地搭建运行环境，将相关的服务程序部署在本地设备上，然后才能使用该服务。';
COMMENT ON COLUMN byai.ss_resource.catalog_id IS '所属目录ID';
COMMENT ON COLUMN byai.ss_resource.man_org_id IS '归属组织';
COMMENT ON COLUMN byai.ss_resource.man_user_id IS '授权管理员';
COMMENT ON COLUMN byai.ss_resource.index_list IS '索引清单';
COMMENT ON COLUMN byai.ss_resource.create_by IS '创建人';
COMMENT ON COLUMN byai.ss_resource.create_time IS '创建时间';
COMMENT ON COLUMN byai.ss_resource.update_by IS '更新人';
COMMENT ON COLUMN byai.ss_resource.update_time IS '更新时间';
COMMENT ON COLUMN byai.ss_resource.com_acct_id IS '所属企业';
COMMENT ON COLUMN byai.ss_resource.resource_status IS '资源状态,status=0草稿,status=1待上架,status=2已上架,status=3已下架,4=审核中,5=审核不通过,6.发布';
COMMENT ON COLUMN byai.ss_resource.resource_d_verid IS '草稿版本号';
COMMENT ON COLUMN byai.ss_resource.resource_r_verid IS '正式版本号';
COMMENT ON COLUMN byai.ss_resource.auth_status IS '发布审批状态 passed: 通过， notPassed：不通过';
COMMENT ON COLUMN byai.ss_resource.publish_portal IS '是否发布到业务门户：1-是，0-否';
COMMENT ON COLUMN byai.ss_resource.parent_resource_id IS '父级资源标识';
COMMENT ON COLUMN byai.ss_resource.publish_type IS '资源发布类型,publish:公开审核,private:个有私有';
COMMENT ON COLUMN byai.ss_resource.owner_type IS '资源归属类型：enterprise-企业，personal-个人';
COMMENT ON COLUMN byai.ss_resource.impl_type IS '资源实现类型:
     1.resourceBizType=AGENT:
      1.1. 默认问答型: implType = ASK_AGENT,workerAgentType = BYCLAW_EXE
      1.2. 个人问答型: implType = ASK_PERSONAL, workerAgentType = BYCLAW_EXE
      1.3. API调用时: implType = API, workerAgentType = NONE
      1.4. SSE调用时: implType = SSE, workerAgentType = NONE

     2.resourceBizType=MCP：
      2.1. MCP调用时: implType = API, workerAgentType = NONE

     3.resourceBizType=TOOLKIT：
      3.1. MCP调用时: implType = API, workerAgentType = NONE

     4.resourceBizType=VIEW | OBJECT:
      4.1. 对象、视图调用时：implType = ASK_AGENT, workerAgentType = BYCLAW_DATA

     5.resourceBizType=KG_*（KG_DOC | KG_DB | KG_TERM | KG_QA）:
      5.1. 知识调用时: implType = ASK_AGENT, workerAgentType = BYCLAW_QA

     6.resourceBizType=DIG_EMPLOYEE：
      6.1. 代码类: implType = ASK_AGENT, workerAgentType = BYCLAW_CODE
      6.2. 综合类: implType = ASK_AGENT, workerAgentType = BYCLAW_EXE
      6.3. 问答类: implType = ASK_AGENT, workerAgentType = BYCLAW_DATA
      6.4. 问数类: implType = ASK_AGENT, workerAgentType = BYCLAW_QA
      6.5. 调试类：implType = ASK_AGENT, workerAgentType = DEBUG_{resourceId}
';
COMMENT ON COLUMN byai.ss_resource.worker_agent_type IS '资源工作类型:
     1.resourceBizType=AGENT:
      1.1. 默认问答型: implType = ASK_AGENT,workerAgentType = BYCLAW_EXE
      1.2. 个人问答型: implType = ASK_PERSONAL, workerAgentType = BYCLAW_EXE
      1.3. API调用时: implType = API, workerAgentType = NONE
      1.4. SSE调用时: implType = SSE, workerAgentType = NONE

     2.resourceBizType=MCP：
      2.1. MCP调用时: implType = API, workerAgentType = NONE

     3.resourceBizType=TOOLKIT：
      3.1. MCP调用时: implType = API, workerAgentType = NONE

     4.resourceBizType=VIEW | OBJECT:
      4.1. 对象、视图调用时：implType = ASK_AGENT, workerAgentType = BYCLAW_DATA

     5.resourceBizType=KG_*（KG_DOC | KG_DB | KG_TERM | KG_QA）:
      5.1. 知识调用时: implType = ASK_AGENT, workerAgentType = BYCLAW_QA

     6.resourceBizType=DIG_EMPLOYEE：
      6.1. 代码类: implType = ASK_AGENT, workerAgentType = BYCLAW_CODE
      6.2. 综合类: implType = ASK_AGENT, workerAgentType = BYCLAW_EXE
      6.3. 问答类: implType = ASK_AGENT, workerAgentType = BYCLAW_DATA
      6.4. 问数类: implType = ASK_AGENT, workerAgentType = BYCLAW_QA
      6.5. 调试类：implType = ASK_AGENT, workerAgentType = DEBUG_{resourceId}
';

COMMENT ON TABLE byai.ss_resource_artifact IS '资源产物映射表';
COMMENT ON COLUMN byai.ss_resource_artifact.artifact_id IS '主键ID';
COMMENT ON COLUMN byai.ss_resource_artifact.resource_id IS '资源ID';
COMMENT ON COLUMN byai.ss_resource_artifact.resource_biz_type IS '资源业务类型';
COMMENT ON COLUMN byai.ss_resource_artifact.artifact_type IS '产物类型: STANDARD_JSON/IMPORT_ZIP/IMPORT_BUNDLE_DIR';
COMMENT ON COLUMN byai.ss_resource_artifact.storage_type IS '存储类型: minio';
COMMENT ON COLUMN byai.ss_resource_artifact.artifact_path IS '资源根目录下的相对路径';
COMMENT ON COLUMN byai.ss_resource_artifact.status_cd IS '状态: A有效, X失效';
COMMENT ON COLUMN byai.ss_resource_artifact.remark IS '备注';
COMMENT ON COLUMN byai.ss_resource_artifact.create_by IS '创建人';
COMMENT ON COLUMN byai.ss_resource_artifact.create_time IS '创建时间';
COMMENT ON COLUMN byai.ss_resource_artifact.update_by IS '更新人';
COMMENT ON COLUMN byai.ss_resource_artifact.update_time IS '更新时间';
COMMENT ON COLUMN byai.ss_resource_artifact.com_acct_id IS '企业账号ID';

COMMENT ON COLUMN byai.ss_res_ext_tool.tool_add_type IS '技能添加方式：curl-curl方式导入、json-curl方式导入';
COMMENT ON COLUMN byai.ss_res_ext_tool.source_content IS '技能源内容：存放curl内容或json内容';
COMMENT ON COLUMN byai.ss_res_ext_tool.target_content IS '技能目标内容：存放json内容或curl转化后的json内容';
COMMENT ON TABLE byai.ss_resource_rel_detail IS '资源关联关系明细表';
COMMENT ON COLUMN byai.ss_resource_rel_detail.resource_rel_detail_id IS '关联关系明细ID';
COMMENT ON COLUMN byai.ss_resource_rel_detail.resource_id IS '资源来源ID';
COMMENT ON COLUMN byai.ss_resource_rel_detail.rel_resource_id IS '关联资源ID';
COMMENT ON COLUMN byai.ss_resource_rel_detail.create_by IS '创建人ID';
COMMENT ON COLUMN byai.ss_resource_rel_detail.create_time IS '创建时间';
COMMENT ON COLUMN byai.ss_resource_rel_detail.update_by IS '更新人ID';
COMMENT ON COLUMN byai.ss_resource_rel_detail.update_time IS '更新时间';
COMMENT ON COLUMN byai.ss_resource_rel_detail.com_acct_id IS '所属企业ID';
COMMENT ON TABLE byai.suas_superassist IS '超级助手信息表';
COMMENT ON COLUMN byai.suas_superassist.superassist_id IS '超级助手主键ID';
COMMENT ON COLUMN byai.suas_superassist.avatar IS '【待修改-引用附件表-文件id】';
COMMENT ON COLUMN byai.suas_superassist.intro IS '助手简介';
COMMENT ON COLUMN byai.suas_superassist.name IS '助手名称';
COMMENT ON COLUMN byai.suas_superassist.create_time IS '创建时间';
COMMENT ON COLUMN byai.suas_superassist.prologue IS '{

	"modelInfo": { #问答模型信息

		"model": "gpt-4-omni",

		"modelId": 418178579620,

		"history": 6,

		"maxToken": 1000,

		"temperature": 0.1

	},

	"multiModel": {}, #多模态模型信息

	"voiceModel": {}, #语音模型信息

	"descText": "", #人设

	"prologueText": "我是你亲爱的生活百问小助手哦" #开场白字段

}';
COMMENT ON COLUMN byai.suas_superassist.status IS '状态：00：正常，01：注销';
COMMENT ON COLUMN byai.suas_superassist.com_acct_id IS '企业账号ID';
COMMENT ON COLUMN byai.suas_superassist.session_dataset_id IS '助理关联唯一个知识库id，用于存储上传的文档';
COMMENT ON COLUMN byai.suas_superassist.create_user IS '创建人ID';
COMMENT ON COLUMN byai.suas_superassist.default_dig_employee_id IS '默认个人助理ID';
COMMENT ON TABLE byai.ss_sandbox_record IS '沙箱记录表';
COMMENT ON COLUMN byai.ss_sandbox_record.id IS '记录主键';
COMMENT ON COLUMN byai.ss_sandbox_record.resource_id IS '资源ID';
COMMENT ON COLUMN byai.ss_sandbox_record.user_code IS '用户编码';
COMMENT ON COLUMN byai.ss_sandbox_record.sandbox_type IS '沙箱类型';
COMMENT ON COLUMN byai.ss_sandbox_record.endpoint IS '沙箱访问端点地址';
COMMENT ON COLUMN byai.ss_sandbox_record.sandbox_id IS '沙箱运行时实例ID';
COMMENT ON COLUMN byai.ss_sandbox_record.chat_id IS '会话ID';
COMMENT ON COLUMN byai.ss_sandbox_record.status IS '沙箱状态：STARTING-启动中，RUNNING-运行中，RELEASING-释放中，RELEASED-已释放，FAILED-失败';
COMMENT ON COLUMN byai.ss_sandbox_record.auto_release IS '远端是否自动过期：1-OpenSandbox自动过期，0-不自动过期';
COMMENT ON COLUMN byai.ss_sandbox_record.lease_policy IS '生命周期策略：REMOTE_AUTO_EXPIRE-远端过期需续约，LOCAL_IDLE_RELEASE-本地空闲释放，MANUAL-人工释放';
COMMENT ON COLUMN byai.ss_sandbox_record.timeout_seconds IS '远端自动过期超时时间（秒）';
COMMENT ON COLUMN byai.ss_sandbox_record.remote_expires_at IS '远端过期时间';
COMMENT ON COLUMN byai.ss_sandbox_record.last_renew_at IS '最近一次远端续约时间';
COMMENT ON COLUMN byai.ss_sandbox_record.next_renew_at IS '下一次应检测续约时间';
COMMENT ON COLUMN byai.ss_sandbox_record.last_access_time IS '最近一次访问时间（用于空闲超时判断）';
COMMENT ON COLUMN byai.ss_sandbox_record.release_time IS '释放完成时间';
COMMENT ON COLUMN byai.ss_sandbox_record.release_reason IS '释放原因';
COMMENT ON COLUMN byai.ss_sandbox_record.version IS '乐观锁版本号';
COMMENT ON COLUMN byai.ss_sandbox_record.create_time IS '创建时间';
COMMENT ON COLUMN byai.ss_sandbox_record.update_time IS '更新时间';
COMMENT ON COLUMN byai.ss_res_ext_doc.resource_catalog_main IS '知识库一级分类：enterprise-企业知识库，personal-个人知识库';
COMMENT ON COLUMN byai.ss_res_ext_doc.resource_catalog_sub IS '知识库二级分类：KG_DOC-文档知识库，KG_DB-数据知识库，KG_TERM-术语知识库，KG_QA-问答知识库';
COMMENT ON COLUMN byai.ss_res_ext_doc.source_content IS '知识库来源json';
COMMENT ON COLUMN byai.ss_res_ext_doc.target_content IS '知识库目标json';
COMMENT ON TABLE byai.ss_res_ext_object IS '资源扩展对象表';
COMMENT ON COLUMN byai.ss_res_ext_object.resource_id IS '资源ID';
COMMENT ON COLUMN byai.ss_res_ext_object.mcp_server_url IS '对象mcp服务地址';
COMMENT ON COLUMN byai.ss_res_ext_object.mcp_transfer_type IS '对象mcp流类型';
COMMENT ON COLUMN byai.ss_res_ext_object.source_content IS '对象来源json';
COMMENT ON COLUMN byai.ss_res_ext_object.target_content IS '对象模板json';
COMMENT ON TABLE byai.ss_res_ext_view IS '资源扩展视图表';
COMMENT ON COLUMN byai.ss_res_ext_view.resource_id IS '资源ID';
COMMENT ON COLUMN byai.ss_res_ext_view.mcp_server_url IS '视图mcp服务地址';
COMMENT ON COLUMN byai.ss_res_ext_view.mcp_transfer_type IS '视图mcp流类型';
COMMENT ON COLUMN byai.ss_res_ext_view.source_content IS '视图来源json';
COMMENT ON COLUMN byai.ss_res_ext_view.target_content IS '视图模板json';
COMMENT ON COLUMN byai.ss_res_ext_mcp.resource_id IS '资源ID';
COMMENT ON COLUMN byai.ss_res_ext_mcp.source_content IS '请求json内容';
COMMENT ON COLUMN byai.ss_res_ext_mcp.target_content IS '目标json内容';
COMMENT ON COLUMN byai.ss_res_ext_agent.source_content IS '请求json内容';
COMMENT ON COLUMN byai.ss_res_ext_agent.target_content IS '目标json内容';

-- ========== 序列当前值 ==========
SELECT setval('byai.seq_any_table', 10000000, True);
SELECT setval('byai.ss_resource_rel_detail_resource_rel_detail_id_seq', 1, False);
SELECT setval('byai.byai_message_relobj_id_seq', 3258, True);
SELECT setval('byai.ss_sandbox_record_id_seq', 512, True);

-- ========== 3. 权限 (03_grant.sql) ==========
GRANT CREATE ON DATABASE postgres TO gaussdb;

-- 授权 gaussdb 用户访问 byai schema 下所有已创建的对象
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA byai TO gaussdb;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA byai TO gaussdb;

-- ========== 4. 种子数据 (04_dml.sql) ==========
SET search_path TO byai;

INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (101,'萧峰',NULL,NULL,'xiaofeng','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (102,'郭靖',NULL,NULL,'guojing','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (103,'令狐冲',NULL,NULL,'linghuchong','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (104,'韦小宝',NULL,NULL,'weixiaobao','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (105,'胡斐',NULL,NULL,'hufei','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (106,'陈家洛',NULL,NULL,'chenjialuo','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (107,'狄云',NULL,NULL,'diyun','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (108,'杨过',NULL,NULL,'yangguo','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (109,'张无忌',NULL,NULL,'zhangwuji','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (110,'黄蓉',NULL,NULL,'huangrong','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (111,'赵敏',NULL,NULL,'zhaomin','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (100,'张三丰',NULL,NULL,'zhangsanfeng','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,'221312',NULL,NULL,NULL),
	 (10001,'平台管理员adminvip','adminvip@byai.com','TvvjzLzE6+JUsjGVhw7yXw==','adminvip','defaultpwd',NULL,NULL,'2025-06-03 07:04:21.908',NULL,'2025-06-03 07:04:21.908','2026-04-28 20:12:43.395','A',NULL,'N','2026-04-28 20:12:43.394',NULL,NULL,NULL,NULL,10000004,'0000000002',576,NULL,NULL),
	 (10000009,'覃小迪',NULL,NULL,'0027002543','defaultpwd',NULL,NULL,'2026-04-28 11:04:11.689',NULL,'2026-04-28 11:04:11.689','2026-04-28 11:04:25.822','A','2026-04-28 11:04:11.689','N',NULL,NULL,NULL,NULL,NULL,10000009,'0027002543',NULL,NULL,NULL),
	 (10000022,'黄药师',NULL,NULL,'0027024630','defaultpwd',NULL,NULL,'2026-04-28 11:05:00.066',NULL,'2026-04-28 11:05:00.066',NULL,'A','2026-04-28 11:05:00.066','N',NULL,NULL,NULL,NULL,NULL,10000022,'0027024630',NULL,NULL,NULL),
	 (10000036,'无名',NULL,NULL,'0027000620','defaultpwd',NULL,NULL,'2026-04-28 11:06:49.140',NULL,'2026-04-28 11:06:49.140',NULL,'A','2026-04-28 11:06:49.140','N',NULL,NULL,NULL,NULL,NULL,10000036,'0027000620',NULL,NULL,NULL),
	 (10000043,'周伯通',NULL,NULL,'0027011326','defaultpwd',NULL,NULL,'2026-04-28 11:07:23.106',NULL,'2026-04-28 11:07:23.106',NULL,'A','2026-04-28 11:07:23.106','N',NULL,NULL,NULL,NULL,NULL,10000043,'0027011326',NULL,NULL,NULL),
	 (10000057,'陈舵主',NULL,NULL,'0027024710','defaultpwd',NULL,NULL,'2026-04-28 11:08:49.096',NULL,'2026-04-28 11:08:49.096',NULL,'A','2026-04-28 11:08:49.096','N',NULL,NULL,NULL,NULL,NULL,10000057,'0027024710',NULL,NULL,NULL),
	 (10000050,'谢逊飞',NULL,NULL,'0027023754','defaultpwd',NULL,NULL,'2026-04-28 11:08:07.481',NULL,'2026-04-28 11:08:07.481','2026-04-28 11:09:29.173','A','2026-04-28 11:08:07.481','N',NULL,NULL,NULL,NULL,NULL,10000050,'0027023754',NULL,NULL,NULL),
	 (10000070,'王重阳',NULL,NULL,'0027019281','defaultpwd',NULL,NULL,'2026-04-28 11:10:05.087',NULL,'2026-04-28 11:10:05.087',NULL,'A','2026-04-28 11:10:05.087','N',NULL,NULL,NULL,NULL,NULL,10000070,'0027019281',NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (10000077,'黎明',NULL,NULL,'0027011322','defaultpwd',NULL,NULL,'2026-04-28 11:11:15.240',NULL,'2026-04-28 11:11:15.240',NULL,'A','2026-04-28 11:11:15.240','N',NULL,NULL,NULL,NULL,NULL,10000077,'0027011322',NULL,NULL,NULL),
	 (10000091,'杜甫',NULL,NULL,'0027012991','defaultpwd',NULL,NULL,'2026-04-28 11:13:06.771',NULL,'2026-04-28 11:13:06.771',NULL,'A','2026-04-28 11:13:06.771','N',NULL,NULL,NULL,NULL,NULL,10000091,'0027012991',NULL,NULL,NULL),
	 (10000105,'萧峰',NULL,NULL,'0027016840','defaultpwd',NULL,NULL,'2026-04-28 11:15:48.839',NULL,'2026-04-28 11:15:48.839',NULL,'A','2026-04-28 11:15:48.839','N',NULL,NULL,NULL,NULL,NULL,10000105,'0027016840',NULL,NULL,NULL),
	 (10000098,'罗贯中',NULL,NULL,'0027028723','defaultpwd',NULL,NULL,'2026-04-28 11:14:57.120',NULL,'2026-04-28 11:14:57.120','2026-04-28 11:16:02.631','A','2026-04-28 11:14:57.120','N',NULL,NULL,NULL,NULL,NULL,10000098,'0027028723',NULL,NULL,NULL),
	 (112,'任盈盈',NULL,NULL,'renyingying','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (113,'小龙女',NULL,NULL,'xiaolongnv','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (114,'王语嫣',NULL,NULL,'wangyuyan','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (115,'霍青桐',NULL,NULL,'huoqingtong','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (116,'苗若兰',NULL,NULL,'miaoruolan','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (117,'洪七公',NULL,NULL,'hongqigong','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (118,'黄药师',NULL,NULL,'huangyaoshi','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (119,'欧阳锋',NULL,NULL,'ouyangfeng','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (120,'段誉',NULL,NULL,'duanyu','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (121,'虚竹',NULL,NULL,'xuzhu','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (122,'周伯通',NULL,NULL,'zhoubotong','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (123,'慕容复',NULL,NULL,'murongfu','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (124,'游坦之',NULL,NULL,'youtanzhi','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (125,'岳不群',NULL,NULL,'yuebuqun','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (126,'风清扬',NULL,NULL,'fengqingyang','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (127,'扫地僧',NULL,NULL,'saodiseng','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (128,'宋远桥',NULL,NULL,'songyuanqiao','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (129,'俞莲舟',NULL,NULL,'yulianzhou','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (130,'张翠山',NULL,NULL,'zhangcuishan','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (131,'殷素素',NULL,NULL,'yinsusu','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (132,'俞岱岩',NULL,NULL,'yudaiyan','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (133,'谢逊',NULL,NULL,'xiexun','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (134,'韦一笑',NULL,NULL,'weiyixiao','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (135,'杨逍',NULL,NULL,'yangxiao','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (136,'范遥',NULL,NULL,'fanyao','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (137,'成昆',NULL,NULL,'chengkun','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (138,'殷天正',NULL,NULL,'yintianzheng','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
	 (10000118,'刘皇叔',NULL,NULL,'0027030770','defaultpwd',NULL,NULL,'2026-04-28 11:17:10.014',NULL,'2026-04-28 11:17:10.014',NULL,'A','2026-04-28 11:17:10.014','N',NULL,NULL,NULL,NULL,NULL,10000118,'0027030770',NULL,NULL,NULL),
	 (10000084,'吴彦祖',NULL,NULL,'0027021534','defaultpwd',NULL,NULL,'2026-04-28 11:12:01.794',NULL,'2026-04-28 11:12:01.794','2026-04-28 11:17:54.221','A','2026-04-28 11:12:01.794','N',NULL,NULL,NULL,NULL,NULL,10000084,'0027021534',NULL,NULL,NULL),
	 (10000029,'梁小',NULL,NULL,'0027003719','defaultpwd',NULL,NULL,'2026-04-28 11:05:58.807',NULL,'2026-04-28 11:05:58.807',NULL,'A','2026-04-28 11:05:58.807','N',NULL,NULL,NULL,NULL,NULL,10000029,'0027003719',NULL,NULL,NULL),
	 (137,'成昆',NULL,NULL,'chengkun','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO byai.po_users (user_id,user_name,email,phone,user_code,pwd,address,remark,user_eff_date,user_exp_date,create_date,update_date,state,state_time,is_locked,last_login_date,security_question_id,security_answer,thumbnail_uri,ext_attr,assistant_id,user_number,station_id,register_type,apple_user_id) VALUES
	 (10,'鲍总',NULL,NULL,'101155','defaultpwd',NULL,NULL,NULL,NULL,'2026-04-28 07:46:39.977',NULL,'A',NULL,'N',NULL,NULL,NULL,NULL,NULL,NULL,'101155',NULL,NULL,NULL),
	 (11,'杨总',NULL,NULL,'0027010369','defaultpwd',NULL,NULL,'2026-04-28 11:17:10.014',NULL,'2026-04-28 11:17:10.014',NULL,'A','2026-04-28 11:17:10.014','N',NULL,NULL,NULL,NULL,NULL,NULL,'0027010369',NULL,NULL,NULL),
	 (12,'罗总',NULL,NULL,'0027000618','defaultpwd',NULL,NULL,'2026-04-28 11:12:01.794',NULL,'2026-04-28 11:12:01.794','2026-04-28 11:17:54.221','A','2026-04-28 11:12:01.794','N',NULL,NULL,NULL,NULL,NULL,NULL,'0027000618',NULL,NULL,NULL),
	 (13,'陈总',NULL,NULL,'0027002811','defaultpwd',NULL,NULL,'2026-04-28 11:05:58.807',NULL,'2026-04-28 11:05:58.807',NULL,'A','2026-04-28 11:05:58.807','N',NULL,NULL,NULL,NULL,NULL,NULL,'0027002811',NULL,NULL,NULL);

update byai.po_users set pwd=MD5(CONCAT('12345{',USER_CODE,'}')) where pwd='defaultpwd';

update byai.po_users set pwd=MD5(CONCAT('Byai@13579{',USER_CODE,'}')) where user_code='adminvip';


INSERT INTO byai.po_organization (org_id,org_code,org_name,org_type,parent_org_id,org_level,org_index,create_date,update_date,path_code,org_desc) VALUES
	 (202,'202','鲸智科技','0',-1,1,0,'2026-04-28 07:46:39.645',NULL,'-1.202',NULL),
	 (242,'242','华中-医疗组','0',215,4,3,'2026-04-28 07:46:39.912',NULL,'-1.202.210.215.242',NULL),
	 (241,'241','华中-政府组','0',215,4,2,'2026-04-28 07:46:39.912',NULL,'-1.202.210.215.241',NULL),
	 (240,'240','华中-金融组','0',215,4,1,'2026-04-28 07:46:39.912',NULL,'-1.202.210.215.240',NULL),
	 (239,'239','华西-制造组','0',214,4,2,'2026-04-28 07:46:39.912',NULL,'-1.202.210.214.239',NULL),
	 (238,'238','华西-政府组','0',214,4,1,'2026-04-28 07:46:39.912',NULL,'-1.202.210.214.238',NULL),
	 (237,'237','华南-政府组','0',213,4,2,'2026-04-28 07:46:39.912',NULL,'-1.202.210.213.237',NULL),
	 (236,'236','华南-金融组','0',213,4,1,'2026-04-28 07:46:39.912',NULL,'-1.202.210.213.236',NULL),
	 (235,'235','华东-制造组','0',212,4,3,'2026-04-28 07:46:39.912',NULL,'-1.202.210.212.235',NULL),
	 (234,'234','华东-政府组','0',212,4,2,'2026-04-28 07:46:39.912',NULL,'-1.202.210.212.234',NULL);
INSERT INTO byai.po_organization (org_id,org_code,org_name,org_type,parent_org_id,org_level,org_index,create_date,update_date,path_code,org_desc) VALUES
	 (233,'233','华东-金融组','0',212,4,1,'2026-04-28 07:46:39.912',NULL,'-1.202.210.212.233',NULL),
	 (232,'232','华北-政府组','0',211,4,2,'2026-04-28 07:46:39.912',NULL,'-1.202.210.211.232',NULL),
	 (231,'231','华北-金融组','0',211,4,1,'2026-04-28 07:46:39.912',NULL,'-1.202.210.211.231',NULL),
	 (224,'224','交付部','0',220,3,4,'2026-04-28 07:46:39.848',NULL,'-1.202.220.224',NULL),
	 (223,'223','CRM产品部','0',220,3,3,'2026-04-28 07:46:39.848',NULL,'-1.202.220.223',NULL),
	 (222,'222','BI产品部','0',220,3,2,'2026-04-28 07:46:39.848',NULL,'-1.202.220.222',NULL),
	 (221,'221','数据产品部','0',220,3,1,'2026-04-28 07:46:39.848',NULL,'-1.202.220.221',NULL),
	 (220,'220','研发与交付中心','0',202,2,2,'2026-04-28 07:46:39.717',NULL,'-1.202.220',NULL),
	 (215,'215','华中大区','0',210,3,5,'2026-04-28 07:46:39.783',NULL,'-1.202.210.215',NULL),
	 (214,'214','华西大区','0',210,3,4,'2026-04-28 07:46:39.783',NULL,'-1.202.210.214',NULL);
INSERT INTO byai.po_organization (org_id,org_code,org_name,org_type,parent_org_id,org_level,org_index,create_date,update_date,path_code,org_desc) VALUES
	 (213,'213','华南大区','0',210,3,3,'2026-04-28 07:46:39.783',NULL,'-1.202.210.213',NULL),
	 (212,'212','华东大区','0',210,3,2,'2026-04-28 07:46:39.783',NULL,'-1.202.210.212',NULL),
	 (211,'211','华北大区','0',210,3,1,'2026-04-28 07:46:39.783',NULL,'-1.202.210.211',NULL),
	 (210,'210','销售中心','0',202,2,1,'2026-04-28 07:46:39.717',NULL,'-1.202.210',NULL);




INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (52,10000098,220,31,'BUSINESS_MAN'),
	 (53,10000118,220,31,'BUSINESS_MAN'),
	 (54,10000084,220,31,'BUSINESS_MAN'),
	 (55,10000029,220,31,'BUSINESS_MAN'),
	 (1,1,103,1,'BUSINESS_MAN'),
	 (2,2,105,2,'BUSINESS_MAN'),
	 (3,100,210,27,'BUSINESS_MAN'),
	 (4,101,211,28,'BUSINESS_MAN'),
	 (5,102,212,28,'BUSINESS_MAN'),
	 (6,103,213,28,'BUSINESS_MAN');
INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (7,104,231,29,'BUSINESS_MAN'),
	 (8,105,233,29,'BUSINESS_MAN'),
	 (9,106,236,29,'BUSINESS_MAN'),
	 (10,107,234,29,'BUSINESS_MAN'),
	 (11,108,238,29,'BUSINESS_MAN'),
	 (12,109,240,29,'BUSINESS_MAN'),
	 (13,110,210,30,'BUSINESS_MAN'),
	 (14,111,210,30,'BUSINESS_MAN'),
	 (15,112,210,30,'BUSINESS_MAN'),
	 (16,113,210,30,'BUSINESS_MAN');
INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (17,114,210,30,'BUSINESS_MAN'),
	 (18,115,210,30,'BUSINESS_MAN'),
	 (19,116,210,30,'BUSINESS_MAN'),
	 (20,117,221,31,'BUSINESS_MAN'),
	 (21,118,222,31,'BUSINESS_MAN'),
	 (22,119,221,31,'BUSINESS_MAN'),
	 (23,120,222,31,'BUSINESS_MAN'),
	 (24,121,223,31,'BUSINESS_MAN'),
	 (25,122,221,31,'BUSINESS_MAN'),
	 (26,123,223,31,'BUSINESS_MAN');
INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (27,124,222,31,'BUSINESS_MAN'),
	 (28,125,223,31,'BUSINESS_MAN'),
	 (29,126,221,31,'BUSINESS_MAN'),
	 (30,127,220,31,'BUSINESS_MAN'),
	 (31,128,224,34,'BUSINESS_MAN'),
	 (32,129,224,34,'BUSINESS_MAN'),
	 (33,130,221,32,'BUSINESS_MAN'),
	 (34,131,222,32,'BUSINESS_MAN'),
	 (35,132,223,32,'BUSINESS_MAN'),
	 (36,133,224,33,'BUSINESS_MAN');
INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (37,134,224,33,'BUSINESS_MAN'),
	 (38,135,224,33,'BUSINESS_MAN'),
	 (39,136,224,33,'BUSINESS_MAN'),
	 (40,137,224,33,'BUSINESS_MAN'),
	 (41,138,224,33,'BUSINESS_MAN'),
	 (42,10000009,220,31,'BUSINESS_MAN'),
	 (43,10000022,220,31,'BUSINESS_MAN'),
	 (44,10000036,220,31,'BUSINESS_MAN'),
	 (45,10000043,220,31,'BUSINESS_MAN'),
	 (46,10000057,220,31,'BUSINESS_MAN');
INSERT INTO byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (47,10000050,220,31,'BUSINESS_MAN'),
	 (48,10000070,220,31,'BUSINESS_MAN'),
	 (49,10000077,220,31,'BUSINESS_MAN'),
	 (50,10000091,220,31,'BUSINESS_MAN'),
	 (51,10000105,220,31,'BUSINESS_MAN');

INSERT INTO  byai.po_users_organization (id,user_id,org_id,position_id,user_type) VALUES
	 (10000010,10001,202,1,'DEV_USER'),
	 (10000011,10001,202,1,'ORG_MAN'),
	 (10000012,10001,202,1,'PLAT_MAN');


INSERT INTO po_position (position_id, position_name, position_desc, is_digital_position) VALUES (1, '产品经理', '负责产品规划、需求梳理、功能设计及产品迭代', 0);
INSERT INTO po_position (position_id, position_name, position_desc, is_digital_position) VALUES (2, 'Java后端开发工程师', '负责后端服务开发、接口设计、数据库设计与系统优化', 0);
INSERT INTO po_position (position_id, position_name, position_desc, is_digital_position) VALUES (3, 'AI产品运营', '负责AI产品运营、用户运营、数据复盘及策略优化', 0);
INSERT INTO po_position (position_id, position_name, position_desc, is_digital_position) VALUES (4, '测试工程师', '负责功能测试、接口自动化测试、缺陷跟踪与质量保障', 0);
INSERT INTO po_position (position_id, position_name, position_desc, is_digital_position) VALUES (5, '运维工程师', '负责服务部署、环境维护、监控告警及稳定性保障', 0);


INSERT INTO byai_system_config (param_id,param_type,param_code,param_name,param_en_name,param_value,param_desc) VALUES
	 (54,'text','SYSTEM_MAX_ONLINE_USERS','系统最大访问用户数设置','SYSTEM_MAX_ONLINE_USERS','10000','系统最大访问用户数设置'),
	 (10865553,'text','ENABLE_SANDBOX','是否开启沙箱','ENABLE_SANDBOX','1','是否开启沙箱'),
	 (10865554,'text','SANDBOX_TYPE','沙箱类型','SANDBOX_TYPE','[
    {
        "sandboxType": "openclaw",
        "sandboxName": "OpenClaw",
        "icon": "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTIwIDEyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibG9ic3Rlci1ncmFkaWVudCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmZjRkNGQiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjOTkxYjFiIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8IS0tIEJvZHkgLS0+CiAgPHBhdGggZD0iTTYwIDEwIEMzMCAxMCAxNSAzNSAxNSA1NSBDMTUgNzUgMzAgOTUgNDUgMTAwIEw0NSAxMTAgTDU1IDExMCBMNTUgMTAwIEM1NSAxMDAgNjAgMTAyIDY1IDEwMCBMNjUgMTEwIEw3NSAxMTAgTDc1IDEwMCBDOTAgOTUgMTA1IDc1IDEwNSA1NSBDMTA1IDM1IDkwIDEwIDYwIDEwWiIgZmlsbD0idXJsKCNsb2JzdGVyLWdyYWRpZW50KSIvPgogIDwhLS0gTGVmdCBDbGF3IC0tPgogIDxwYXRoIGQ9Ik0yMCA0NSBDNSA0MCAwIDUwIDUgNjAgQzEwIDcwIDIwIDY1IDI1IDU1IEMyOCA0OCAyNSA0NSAyMCA0NVoiIGZpbGw9InVybCgjbG9ic3Rlci1ncmFkaWVudCkiLz4KICA8IS0tIFJpZ2h0IENsYXcgLS0+CiAgPHBhdGggZD0iTTEwMCA0NSBDMTE1IDQwIDEyMCA1MCAxMTUgNjAgQzExMCA3MCAxMDAgNjUgOTUgNTUgQzkyIDQ4IDk1IDQ1IDEwMCA0NVoiIGZpbGw9InVybCgjbG9ic3Rlci1ncmFkaWVudCkiLz4KICA8IS0tIEFudGVubmEgLS0+CiAgPHBhdGggZD0iTTQ1IDE1IFEzNSA1IDMwIDgiIHN0cm9rZT0iI2ZmNGQ0ZCIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8cGF0aCBkPSJNNzUgMTUgUTg1IDUgOTAgOCIgc3Ryb2tlPSIjZmY0ZDRkIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDwhLS0gRXllcyAtLT4KICA8Y2lyY2xlIGN4PSI0NSIgY3k9IjM1IiByPSI2IiBmaWxsPSIjMDUwODEwIi8+CiAgPGNpcmNsZSBjeD0iNzUiIGN5PSIzNSIgcj0iNiIgZmlsbD0iIzA1MDgxMCIvPgogIDxjaXJjbGUgY3g9IjQ2IiBjeT0iMzQiIHI9IjIuNSIgZmlsbD0iIzAwZTVjYyIvPgogIDxjaXJjbGUgY3g9Ijc2IiBjeT0iMzQiIHI9IjIuNSIgZmlsbD0iIzAwZTVjYyIvPgo8L3N2Zz4K"
    }
]','沙箱类型'),
	 (2,'text','AGENT_RES_OWN_ORG','默认资源所属组织ID(个人创建数字员工或文档库时，记录的所属组织ID为-1)','AGENT_RES_OWN_ORG','-1','默认资源所属组织ID(个人创建数字员工或文档库时，记录的所属组织ID为-1)，双方约定为 -1，且不能修改（约定人黄升/刘军华）'),
	 (8,'text','USER_DEFAULT_PWD','门户使用(用户默认密码，RSA密文)','USER_DEFAULT_PWD','A174D7A0752A1301330864BFE18E54B36021174EED382921EDB7BD5BBECD814889719DC1317A27C859C1234714A9E98A0C2A2E69BD1687520B2DD594B4A39E941E1F5D0586FDAB98D2DB52AC217CE7F60DB386B28C5541C77BABD1583E5F14AED5120E94E26EF87CB2A7FDD9FC2885D1FC342FF47886E1923CA2E8B9BA870100','百应管理后台-用户默认密码-RSA密文加密（约定人何杜明）'),
	 (1,'text','AGENT_RESOURCE_PROJECT_ID','百应AI','AGENT_RESOURCE_PROJECT_ID','-1000','百应产品在智能体平台的项目空间ID，双方约定为 -1000，且不能修改（约定人黄升/刘军华）'),
	 (38,'text','SYSTEM_PROMPT','系统提示词','SYSTEM_PROMPT','
-- 当前时间：当前时间是%s
-- 当前用户: 和你聊天的用户是%s
','SYSTEM_PROMPT（智能体默认提示词，约定人沛坤）'),
	 (65,'text','IS_ALLOW_OUT_KG','本地文档知识库、第三方文档知识库的分类,枚举值是YES|NO,当IS_ALLOW_OUT_KG=YES时展示第三方文档。','IS_ALLOW_OUT_KG','YES','本地文档知识库、第三方文档知识库的分类,枚举值是YES|NO,当IS_ALLOW_OUT_KG=YES时展示第三方文档。'),
	 (67,'text','DATA_CLOUD_TOOL_INDEX','datacloud工具索引','ES_CONFIG','tools_registry_test','datacloud工具索引');
INSERT INTO byai_system_config (param_id,param_type,param_code,param_name,param_en_name,param_value,param_desc) VALUES
	 (60,'text','DAILY_CHAT_LIMIT','每日会话调用限制','DAILY_CHAT_LIMIT','1500','每个用户每天可以调用会话接口的最大次数'),
	 (202,'text','IS_MINI_BYAI','是否迷你版本百应','IS_MINI_BYAI','false','是否迷你版本百应,默认fase'),
	 (56,'text','ENABLE_APPROVE','资源发布时是否开启审批待办','ENABLE_APPROVE','true','资源发布时是否开启审批待办'),
	 (10859476,'text','DATACLOUD_URL','DATACLOUD_URL地址配置','DATACLOUD_URL','','DATACLOUD_URL地址配置,默认通过环境变量读取'),
	 (88,'text','beyondLogo','默认logo','beyondLogo','','beyondlogo'),
	 (39,'text','ENV','项目运行环境','ENV','mobile,asr,scheduleTask','项目运行环境'),
	 (131,'text','CHAT_DIGITAL_EMPLOYEE_THRESHOLD','阈值','CHAT_DIGITAL_EMPLOYEE_THRESHOLD','','问答数字员工质量等级评级阈值'),
	 (133,'text','AUTHORIZATION_BEARER','智能体基础认证配置BEARER','AUTHORIZATION_BEARER','WhaleDI-Agent-4cd294f7ead8adcd1f2f05c8b4ae7252ce453157a39e7620089a1732ced5bbe0','智能体基础认证配置BEARER，用于配置BEARER令牌相关认证参数'),
	 (102,'text','beyondAssistant','默认超级助手图标','beyondAssistant','','默认超级助手图标'),
	 (101,'text','beyondFavicon','默认浏览器页面ICON','beyondFavicon','','默认浏览器页面ICON');
INSERT INTO byai_system_config (param_id,param_type,param_code,param_name,param_en_name,param_value,param_desc) VALUES
	 (89,'text','beyondTitle','默认标题','beyondTitle','','beyondtitle'),
	 (10000145,NULL,'ENABLE_USE_SANDBOX_NUM','允许创建的最大沙箱数量','ENABLE_USE_SANDBOX_NUM','30','允许创建的最大沙箱数量'),
	 (10863540,'text','DIG_EMPLOYEE_FILE_UPLOAD_CONFIG','数字员工文件上传全局配置','DIG_EMPLOYEE_FILE_UPLOAD_CONFIG','{
	"enabled": true,
	"allowedFileTypes": [".docx", ".doc", ".pdf", ".txt", ".md", ".xlsx", ".xls", ".csv", ".pptx", ".ppt", ".png", ".jpeg", ".jpg"],
	"maxFileSize": 10,
	"maxFileCount": 5
}','数字员工文件上传全局配置'),
	 (119,'text','IS_CHECK_EMPLOYEE_OPEN_API_PUBLISH','数字员工API(BOT)接口新增检查开关','IS_CHECK_EMPLOYEE_OPEN_API_PUBLISH','false','数字员工API(BOT)接口新增检查开关'),
	 (118,'text','IS_CHECK_EMPLOYEE_PUBLISH','数字员工发布稽核重复开关','IS_CHECK_EMPLOYEE_PUBLISH','false','数字员工发布稽核重复开关'),
	 (117,'text','IS_CHECK_EMPLOYEE_AUDIT','数字员工新增检查开关','IS_CHECK_EMPLOYEE_AUDIT','false','数字员工新增检查开关');


INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865555, 'text', 'OPENCLAW_BUNDLED_TOOLS', 'OpenClaw内置Tool清单', 'OPENCLAW_BUNDLED_TOOLS', '[
  {
    "toolName": "全部工具",
    "toolCode": "*",
    "toolDescZh": "relTools 专用通配符，表示允许 OpenClaw 全部工具。",
    "toolDescEn": "Wildcard for relTools, allowing all OpenClaw tools.",
    "toolGroup": "wildcard",
    "toolGroupName": "通配符",
    "profiles": ["full"],
    "isWildcard": true
  },
  {
    "toolName": "read",
    "toolCode": "read",
    "toolDescZh": "读取文件内容。",
    "toolDescEn": "Read file contents.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "write",
    "toolCode": "write",
    "toolDescZh": "创建或覆盖文件。",
    "toolDescEn": "Create or overwrite files.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "edit",
    "toolCode": "edit",
    "toolDescZh": "对文件进行精确编辑。",
    "toolDescEn": "Make precise edits.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "apply_patch",
    "toolCode": "apply_patch",
    "toolDescZh": "以 patch 方式修改文件。",
    "toolDescEn": "Patch files.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "exec",
    "toolCode": "exec",
    "toolDescZh": "运行立即启动的 Shell 命令。",
    "toolDescEn": "Run shell commands that start now.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "process",
    "toolCode": "process",
    "toolDescZh": "查看和控制正在运行的 exec 会话。",
    "toolDescEn": "Inspect and control running exec sessions.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "code_execution",
    "toolCode": "code_execution",
    "toolDescZh": "运行沙箱化远程分析。",
    "toolDescEn": "Run sandboxed remote analysis.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "web_search",
    "toolCode": "web_search",
    "toolDescZh": "搜索 Web 内容。",
    "toolDescEn": "Search the web.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "web_fetch",
    "toolCode": "web_fetch",
    "toolDescZh": "抓取 Web 内容。",
    "toolDescEn": "Fetch web content.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "x_search",
    "toolCode": "x_search",
    "toolDescZh": "搜索 X 帖子。",
    "toolDescEn": "Search X posts.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "memory_search",
    "toolCode": "memory_search",
    "toolDescZh": "进行语义记忆搜索。",
    "toolDescEn": "Semantic search.",
    "toolGroup": "memory",
    "toolGroupName": "记忆",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "memory_get",
    "toolCode": "memory_get",
    "toolDescZh": "读取记忆文件。",
    "toolDescEn": "Read memory files.",
    "toolGroup": "memory",
    "toolGroupName": "记忆",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_list",
    "toolCode": "sessions_list",
    "toolDescZh": "列出可见会话及可选的最近消息。",
    "toolDescEn": "List visible sessions and optional recent messages.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_history",
    "toolCode": "sessions_history",
    "toolDescZh": "读取可见会话的脱敏消息历史。",
    "toolDescEn": "Read sanitized message history for a visible session.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_send",
    "toolCode": "sessions_send",
    "toolDescZh": "向另一个可见会话发送消息。",
    "toolDescEn": "Send a message to another visible session.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_spawn",
    "toolCode": "sessions_spawn",
    "toolDescZh": "创建子 Agent 或 ACP 会话。",
    "toolDescEn": "Spawn sub-agent or ACP sessions.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_yield",
    "toolCode": "sessions_yield",
    "toolDescZh": "结束当前回合以接收子 Agent 结果。",
    "toolDescEn": "End turn to receive sub-agent results.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "subagents",
    "toolCode": "subagents",
    "toolDescZh": "管理子 Agent。",
    "toolDescEn": "Manage sub-agents.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "session_status",
    "toolCode": "session_status",
    "toolDescZh": "查看会话状态、用量和模型状态。",
    "toolDescEn": "Show session status, usage, and model state.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["minimal", "coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "browser",
    "toolCode": "browser",
    "toolDescZh": "控制 Web 浏览器。",
    "toolDescEn": "Control web browser.",
    "toolGroup": "ui",
    "toolGroupName": "界面",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "canvas",
    "toolCode": "canvas",
    "toolDescZh": "控制画布。",
    "toolDescEn": "Control canvases.",
    "toolGroup": "ui",
    "toolGroupName": "界面",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "message",
    "toolCode": "message",
    "toolDescZh": "发送消息。",
    "toolDescEn": "Send messages.",
    "toolGroup": "messaging",
    "toolGroupName": "消息",
    "profiles": ["messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "cron",
    "toolCode": "cron",
    "toolDescZh": "管理定时任务与自动化。",
    "toolDescEn": "Manage scheduled jobs and automations.",
    "toolGroup": "automation",
    "toolGroupName": "自动化",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "gateway",
    "toolCode": "gateway",
    "toolDescZh": "控制 Gateway。",
    "toolDescEn": "Gateway control.",
    "toolGroup": "automation",
    "toolGroupName": "自动化",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "nodes",
    "toolCode": "nodes",
    "toolDescZh": "管理节点与设备。",
    "toolDescEn": "Nodes and devices.",
    "toolGroup": "nodes",
    "toolGroupName": "节点",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "agents_list",
    "toolCode": "agents_list",
    "toolDescZh": "列出 Agent。",
    "toolDescEn": "List agents.",
    "toolGroup": "agents",
    "toolGroupName": "Agent",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "update_plan",
    "toolCode": "update_plan",
    "toolDescZh": "更新任务计划。",
    "toolDescEn": "Update task plan.",
    "toolGroup": "agents",
    "toolGroupName": "Agent",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "image",
    "toolCode": "image",
    "toolDescZh": "图片理解。",
    "toolDescEn": "Image understanding.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "image_generate",
    "toolCode": "image_generate",
    "toolDescZh": "图片生成。",
    "toolDescEn": "Image generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "music_generate",
    "toolCode": "music_generate",
    "toolDescZh": "音乐生成。",
    "toolDescEn": "Music generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "video_generate",
    "toolCode": "video_generate",
    "toolDescZh": "视频生成。",
    "toolDescEn": "Video generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "tts",
    "toolCode": "tts",
    "toolDescZh": "文本转语音。",
    "toolDescEn": "Text-to-speech conversion.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": [],
    "includeInOpenClawGroup": true
  }
]', 'OpenClaw 内置 Tools 清单，供 baiying-enhance 的 agent.json relTools 配置和角色默认配置引用。');


INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865556, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_SUPER_ASSISTANT', 'OpenClaw Agent角色模板-超级助手', 'OPENCLAW_AGENT_ROLE_TEMPLATE_SUPER_ASSISTANT', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "superAssistant",
  "roleNameZh": "超级助手",
  "roleNameEn": "Super Assistant",
  "roleDescZh": "主控、调度、会话管理、任务拆解、Agent 分派与结果汇总。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。超级助手固定为 superAssistant。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。字段存在时以缓存或 agent.json 配置为准。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。超级助手默认只开放主控所需工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
  "relSkills": [],
  "relTools": [
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "session_status",
    "agents_list",
    "update_plan",
    "read",
    "exec",
    "process"
  ],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "templates/main-agents.md": "超级助手主 AGENTS.md 默认模板" },
        { "relPrompt.AGENTS.md.priorityPrompt": "配置后替换主 Prompt 内容" }
      ]
    }
  }
}', '超级助手 Agent 角色配置模板，默认不绑定 skill，只开放主控、调度、会话、计划、读取、执行和进程相关工具。');

INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865557, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_PERSONAL_ASSISTANT', 'OpenClaw Agent角色模板-个人助理', 'OPENCLAW_AGENT_ROLE_TEMPLATE_PERSONAL_ASSISTANT', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "personalAssistant",
  "roleNameZh": "个人助理",
  "roleNameEn": "Personal Assistant",
  "roleDescZh": "面向个人知识库、DWS、日常事务与用户个人工作流。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。个人助理固定为 personalAssistant。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。个人助理默认开启 dws。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。配置 [\"*\"] 表示允许全部工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
  "relSkills": ["dws"],
  "relTools": ["*"],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格或指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE 或 A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name、value、key 明细" }
      ]
    },
    "IDENTITY.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceName": "详情格式下生成 Name" },
        { "name": "agent_list 格式下生成 Name" },
        { "avatar": "生成 Avatar source system path" }
      ]
    },
    "USER.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.openingQuestion": "详情格式下生成 Suggested opening questions" },
        { "openingQuestion": "agent_list 格式下生成 Suggested opening questions" }
      ]
    },
    "TOOLS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceId": "生成 DOC 类资源调用所需 agent_id 兜底" },
        { "relResourceInfoList": "生成 Available resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为资源列表兜底" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}', '个人助理 Agent 角色配置模板，默认绑定 dws skill，并通过 relTools 的 [\"*\"] 允许 OpenClaw 全部工具。');

INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865558, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_DIGITAL_EMPLOYEE', 'OpenClaw Agent角色模板-数字员工', 'OPENCLAW_AGENT_ROLE_TEMPLATE_DIGITAL_EMPLOYEE', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "digitalEmployee",
  "roleNameZh": "数字员工",
  "roleNameEn": "Digital Employee",
  "roleDescZh": "面向具体业务能力、知识库、工具调用和业务流程执行。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。数字员工固定为 digitalEmployee。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。数字员工默认不绑定 skill。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。配置 [\"*\"] 表示允许全部工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
  "relSkills": [],
  "relTools": ["*"],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格或指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE 或 A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name、value、key 明细" }
      ]
    },
    "IDENTITY.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceName": "详情格式下生成 Name" },
        { "name": "agent_list 格式下生成 Name" },
        { "avatar": "生成 Avatar source system path" }
      ]
    },
    "USER.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.openingQuestion": "详情格式下生成 Suggested opening questions" },
        { "openingQuestion": "agent_list 格式下生成 Suggested opening questions" }
      ]
    },
    "TOOLS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceId": "生成 DOC 类资源调用所需 agent_id 兜底" },
        { "relResourceInfoList": "生成 Available resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为资源列表兜底" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}', '数字员工 Agent 角色配置模板，默认不绑定 skill，并通过 relTools 的 [\"*\"] 允许 OpenClaw 全部工具。');



INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865554, 'text', 'OPENCLAW_BUNDLED_SKILLS', 'OpenClaw内置Skill清单', 'OPENCLAW_BUNDLED_SKILLS', '[
  {
    "skillName": "1password",
    "skillCode": "1password",
    "skillDescZh": "使用 1Password CLI 完成登录、与桌面端集成，以及读取或注入密钥。",
    "skillDescEn": "Set up and use 1Password CLI for sign-in, desktop integration, and reading or injecting secrets."
  },
  {
    "skillName": "apple-notes",
    "skillCode": "apple-notes",
    "skillDescZh": "在 macOS 上通过 memo CLI 创建、查看、编辑、删除、搜索、移动或导出 Apple 备忘录。",
    "skillDescEn": "Create, view, edit, delete, search, move, or export Apple Notes via the memo CLI on macOS."
  },
  {
    "skillName": "apple-reminders",
    "skillCode": "apple-reminders",
    "skillDescZh": "通过 remindctl 列出、添加、编辑、完成或删除 Apple 提醒事项与提醒列表。",
    "skillDescEn": "List, add, edit, complete, or delete Apple Reminders and reminder lists via remindctl."
  },
  {
    "skillName": "bear-notes",
    "skillCode": "bear-notes",
    "skillDescZh": "通过 grizzly CLI 创建、搜索与管理 Bear 笔记。",
    "skillDescEn": "Create, search, and manage Bear notes via grizzly CLI."
  },
  {
    "skillName": "blogwatcher",
    "skillCode": "blogwatcher",
    "skillDescZh": "使用 blogwatcher CLI 监控博客与 RSS/Atom 订阅更新。",
    "skillDescEn": "Monitor blogs and RSS/Atom feeds for updates using the blogwatcher CLI."
  },
  {
    "skillName": "blucli",
    "skillCode": "blucli",
    "skillDescZh": "BluOS 命令行工具 blu：设备发现、播放、分组与音量。",
    "skillDescEn": "BluOS CLI (blu) for discovery, playback, grouping, and volume."
  },
  {
    "skillName": "camsnap",
    "skillCode": "camsnap",
    "skillDescZh": "从 RTSP/ONVIF 摄像头截取画面或短片。",
    "skillDescEn": "Capture frames or clips from RTSP/ONVIF cameras."
  },
  {
    "skillName": "canvas",
    "skillCode": "canvas",
    "skillDescZh": "通过 canvas 工具在已连接的 OpenClaw 节点（Mac 应用、iOS、Android）上展示 HTML 内容。",
    "skillDescEn": "Display HTML content on connected OpenClaw nodes (Mac app, iOS, Android) via the canvas tool."
  },
  {
    "skillName": "clawhub",
    "skillCode": "clawhub",
    "skillDescZh": "使用 ClawHub CLI 与注册表搜索、安装、更新、同步或发布 Agent 技能。",
    "skillDescEn": "Search, install, update, sync, or publish agent skills with the ClawHub CLI and registry."
  },
  {
    "skillName": "coding-agent",
    "skillCode": "coding-agent",
    "skillDescZh": "通过立即后台进程将编码任务委托给 Codex、Claude Code、OpenCode 或 Pi。适用于：(1) 构建功能/应用；(2) 在临时克隆或 worktree 中审查 PR；(3) 大规模重构；(4) 需要浏览文件的迭代开发。不适用于：一行级小改（直接编辑）、仅读代码（使用读文件工具）、聊天中线程绑定的 ACP 请求（使用 sessions_spawn 且 runtime 为 acp）、或在 ~/clawd 工作区中的任何 spawn。所有 coding-agent 运行须立即以 background:true 启动。Claude Code：使用 --print --permission-mode bypassPermissions（无 PTY）。Codex/Pi/OpenCode：须 pty:true。完成通知须使用 openclaw message send，勿用系统事件或心跳。",
    "skillDescEn": "Delegate coding tasks to Codex, Claude Code, OpenCode, or Pi agents via immediate background processes. Use when: (1) building or creating features/apps, (2) reviewing PRs in a temp clone/worktree, (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-line fixes (just edit), reading code (use read tool), thread-bound ACP harness requests in chat (use sessions_spawn with runtime:\"acp\"), or any work in ~/clawd workspace (never spawn agents here). All coding-agent runs start with background:true immediately. Claude Code: use --print --permission-mode bypassPermissions (no PTY). Codex/Pi/OpenCode: pty:true required. Completion notification must use openclaw message send, not system event/heartbeat."
  },
  {
    "skillName": "discord",
    "skillCode": "discord",
    "skillDescZh": "通过消息工具执行 Discord 操作（channel=discord）。",
    "skillDescEn": "Discord ops via the message tool (channel=discord)."
  },
  {
    "skillName": "eightctl",
    "skillCode": "eightctl",
    "skillDescZh": "控制 Eight Sleep 智能床罩（状态、温度、闹钟、日程）。",
    "skillDescEn": "Control Eight Sleep pods (status, temperature, alarms, schedules)."
  },
  {
    "skillName": "gemini",
    "skillCode": "gemini",
    "skillDescZh": "Gemini CLI：一次性问答、摘要与生成。",
    "skillDescEn": "Gemini CLI for one-shot Q&A, summaries, and generation."
  },
  {
    "skillName": "gh-issues",
    "skillCode": "gh-issues",
    "skillDescZh": "获取 GitHub Issue、委托子代理修复、开启 PR、关注评审或执行 /gh-issues 工作流。",
    "skillDescEn": "Fetch GitHub issues, delegate fixes to subagents, open PRs, watch reviews, or run /gh-issues workflows."
  },
  {
    "skillName": "gifgrep",
    "skillCode": "gifgrep",
    "skillDescZh": "使用 CLI/TUI 搜索 GIF 提供商、下载结果并提取静帧或拼贴图。",
    "skillDescEn": "Search GIF providers with CLI/TUI, download results, and extract stills/sheets."
  },
  {
    "skillName": "github",
    "skillCode": "github",
    "skillDescZh": "使用 gh 处理 GitHub Issue、PR 状态、CI/日志、评论、评审、发布与 API 查询。",
    "skillDescEn": "Use gh for GitHub issues, PR status, CI/logs, comments, reviews, releases, and API queries."
  },
  {
    "skillName": "gog",
    "skillCode": "gog",
    "skillDescZh": "Google Workspace CLI：Gmail、日历、云端硬盘、通讯录、表格与文档。",
    "skillDescEn": "Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs."
  },
  {
    "skillName": "goplaces",
    "skillCode": "goplaces",
    "skillDescZh": "通过 goplaces 查询 Google Places：文本搜索、地点详情、解析、评论或可脚本化 JSON。",
    "skillDescEn": "Query Google Places for text search, place details, resolve, reviews, or scriptable JSON via goplaces."
  },
  {
    "skillName": "healthcheck",
    "skillCode": "healthcheck",
    "skillDescZh": "审计并加固运行 OpenClaw 的主机：SSH、防火墙、更新、暴露面、cron 检查与风险态势。",
    "skillDescEn": "Audit and harden hosts running OpenClaw for SSH, firewall, updates, exposure, cron checks, and risk posture."
  },
  {
    "skillName": "himalaya",
    "skillCode": "himalaya",
    "skillDescZh": "使用 himalaya 列出、阅读、搜索、撰写、回复、转发并整理 IMAP/SMTP 邮件。",
    "skillDescEn": "Use himalaya to list, read, search, compose, reply, forward, and organize IMAP/SMTP email."
  },
  {
    "skillName": "imsg",
    "skillCode": "imsg",
    "skillDescZh": "iMessage/SMS CLI：列出聊天与历史，并通过「信息」应用发送消息。",
    "skillDescEn": "iMessage/SMS CLI for listing chats, history, and sending messages via Messages.app."
  },
  {
    "skillName": "mcporter",
    "skillCode": "mcporter",
    "skillDescZh": "通过 HTTP 或 stdio 使用 mcporter 列出、配置、鉴权、调用并检查 MCP 服务器与工具。",
    "skillDescEn": "List, configure, authenticate, call, and inspect MCP servers/tools with mcporter over HTTP or stdio."
  },
  {
    "skillName": "model-usage",
    "skillCode": "model-usage",
    "skillDescZh": "按模型汇总 Codex 或 Claude 的 CodexBar 本地费用日志，含当前或完整明细。",
    "skillDescEn": "Summarize CodexBar local cost logs by model for Codex or Claude, including current or full breakdowns."
  },
  {
    "skillName": "nano-pdf",
    "skillCode": "nano-pdf",
    "skillDescZh": "使用 nano-pdf CLI，用自然语言指令编辑 PDF。",
    "skillDescEn": "Edit PDFs with natural-language instructions using the nano-pdf CLI."
  },
  {
    "skillName": "node-connect",
    "skillCode": "node-connect",
    "skillDescZh": "诊断 OpenClaw Android、iOS 或 macOS 节点的配对、二维码/安装码、路由、鉴权与连接故障。",
    "skillDescEn": "Diagnose OpenClaw Android, iOS, or macOS node pairing, QR/setup code, route, auth, and connection failures."
  },
  {
    "skillName": "notion",
    "skillCode": "notion",
    "skillDescZh": "Notion API：创建与管理页面、数据库与块。",
    "skillDescEn": "Notion API for creating and managing pages, databases, and blocks."
  },
  {
    "skillName": "obsidian",
    "skillCode": "obsidian",
    "skillDescZh": "处理 Obsidian 库（纯 Markdown 笔记）并通过 obsidian-cli 自动化。",
    "skillDescEn": "Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli."
  },
  {
    "skillName": "openai-whisper",
    "skillCode": "openai-whisper",
    "skillDescZh": "使用 Whisper CLI 在本地语音转文字（无需 API 密钥）。",
    "skillDescEn": "Local speech-to-text with the Whisper CLI (no API key)."
  },
  {
    "skillName": "openai-whisper-api",
    "skillCode": "openai-whisper-api",
    "skillDescZh": "通过 OpenAI 语音转写 API（Whisper）转录音频。",
    "skillDescEn": "Transcribe audio via OpenAI Audio Transcriptions API (Whisper)."
  },
  {
    "skillName": "openhue",
    "skillCode": "openhue",
    "skillDescZh": "通过 OpenHue CLI 控制飞利浦 Hue 灯光与场景。",
    "skillDescEn": "Control Philips Hue lights and scenes via the OpenHue CLI."
  },
  {
    "skillName": "oracle",
    "skillCode": "oracle",
    "skillDescZh": "使用 oracle CLI 打包提示词与文件，供第二模型进行调试、重构、设计或评审检查。",
    "skillDescEn": "Use oracle CLI to bundle prompts and files for second-model debugging, refactor, design, or review checks."
  },
  {
    "skillName": "ordercli",
    "skillCode": "ordercli",
    "skillDescZh": "仅支持 Foodora：查询历史订单与进行中的订单状态（Deliveroo 开发中）。",
    "skillDescEn": "Foodora-only CLI for checking past orders and active order status (Deliveroo WIP)."
  },
  {
    "skillName": "peekaboo",
    "skillCode": "peekaboo",
    "skillDescZh": "使用 Peekaboo CLI 截取并自动化 macOS 界面。",
    "skillDescEn": "Capture and automate macOS UI with the Peekaboo CLI."
  },
  {
    "skillName": "sag",
    "skillCode": "sag",
    "skillDescZh": "ElevenLabs 文字转语音，类 macOS say 的交互体验。",
    "skillDescEn": "ElevenLabs text-to-speech with mac-style say UX."
  },
  {
    "skillName": "session-logs",
    "skillCode": "session-logs",
    "skillDescZh": "使用 jq 搜索并分析本会话日志（较早或父级对话）。",
    "skillDescEn": "Search and analyze your own session logs (older/parent conversations) using jq."
  },
  {
    "skillName": "sherpa-onnx-tts",
    "skillCode": "sherpa-onnx-tts",
    "skillDescZh": "通过 sherpa-onnx 在本地文字转语音（离线、无云）。",
    "skillDescEn": "Local text-to-speech via sherpa-onnx (offline, no cloud)"
  },
  {
    "skillName": "skill-creator",
    "skillCode": "skill-creator",
    "skillDescZh": "创建、编辑、改进、整理、评审、审计或重构 AgentSkills 与 SKILL.md 文件。",
    "skillDescEn": "Create, edit, improve, tidy, review, audit, or restructure AgentSkills and SKILL.md files."
  },
  {
    "skillName": "slack",
    "skillCode": "slack",
    "skillDescZh": "使用 Slack 工具进行反应、置顶/取消置顶、发送、编辑、删除消息或获取成员信息。",
    "skillDescEn": "Use the Slack tool to react, pin/unpin, send, edit, delete messages, or fetch Slack member info."
  },
  {
    "skillName": "songsee",
    "skillCode": "songsee",
    "skillDescZh": "使用 songsee CLI 从音频生成频谱图与特征面板可视化。",
    "skillDescEn": "Generate spectrograms and feature-panel visualizations from audio with the songsee CLI."
  },
  {
    "skillName": "sonoscli",
    "skillCode": "sonoscli",
    "skillDescZh": "控制 Sonos 音箱：发现、状态、播放、音量、分组。",
    "skillDescEn": "Control Sonos speakers (discover/status/play/volume/group)."
  },
  {
    "skillName": "spotify-player",
    "skillCode": "spotify-player",
    "skillDescZh": "在终端通过 spogo（优先）或 spotify_player 进行 Spotify 播放与搜索。",
    "skillDescEn": "Terminal Spotify playback/search via spogo (preferred) or spotify_player."
  },
  {
    "skillName": "summarize",
    "skillCode": "summarize",
    "skillDescZh": "总结或转写 URL、YouTube/视频、播客、文章、字幕、PDF 与本地文件。",
    "skillDescEn": "Summarize or transcribe URLs, YouTube/videos, podcasts, articles, transcripts, PDFs, and local files."
  },
  {
    "skillName": "taskflow",
    "skillCode": "taskflow",
    "skillDescZh": "将多步离线任务协调为单一持久 TaskFlow 作业，含负责人上下文、状态、等待与子任务。",
    "skillDescEn": "Coordinate multi-step detached tasks as one durable TaskFlow job with owner context, state, waits, and child tasks."
  },
  {
    "skillName": "taskflow-inbox-triage",
    "skillCode": "taskflow-inbox-triage",
    "skillDescZh": "TaskFlow 示例模式：收件箱分流、意图路由、等待回复与后续摘要。",
    "skillDescEn": "Example TaskFlow pattern for inbox triage, intent routing, waiting on replies, and later summaries."
  },
  {
    "skillName": "things-mac",
    "skillCode": "things-mac",
    "skillDescZh": "在 macOS 上添加、更新、列出、搜索或查看 Things 3 待办、收件箱、今天、项目、区域与标签。",
    "skillDescEn": "Add, update, list, search, or inspect Things 3 todos, inbox, today, projects, areas, and tags on macOS."
  },
  {
    "skillName": "tmux",
    "skillCode": "tmux",
    "skillDescZh": "通过发送按键与抓取窗格输出远程控制 tmux 会话，以驱动交互式 CLI。",
    "skillDescEn": "Remote-control tmux sessions for interactive CLIs by sending keystrokes and scraping pane output."
  },
  {
    "skillName": "trello",
    "skillCode": "trello",
    "skillDescZh": "通过 Trello REST API 管理看板、列表与卡片。",
    "skillDescEn": "Manage Trello boards, lists, and cards via the Trello REST API."
  },
  {
    "skillName": "video-frames",
    "skillCode": "video-frames",
    "skillDescZh": "使用 ffmpeg 从视频提取帧或短视频片段。",
    "skillDescEn": "Extract frames or short clips from videos using ffmpeg."
  },
  {
    "skillName": "voice-call",
    "skillCode": "voice-call",
    "skillDescZh": "通过 OpenClaw voice-call 插件发起语音通话。",
    "skillDescEn": "Start voice calls via the OpenClaw voice-call plugin."
  },
  {
    "skillName": "wacli",
    "skillCode": "wacli",
    "skillDescZh": "通过 wacli 发送第三方 WhatsApp 消息或同步/搜索聊天记录（非日常活跃会话）。",
    "skillDescEn": "Send third-party WhatsApp messages or sync/search WhatsApp history via wacli, not normal active chats."
  },
  {
    "skillName": "weather",
    "skillCode": "weather",
    "skillDescZh": "获取指定地点或出行规划的当前天气、降雨、温度与预报。",
    "skillDescEn": "Get current weather, rain, temperature, and forecasts for locations or travel planning."
  },
  {
    "skillName": "xurl",
    "skillCode": "xurl",
    "skillDescZh": "使用 xurl 进行已认证的 X API 发帖、回复、搜索、私信、媒体上传、关注者或原始 v2 调用。",
    "skillDescEn": "Use xurl for authenticated X API posts, replies, search, DMs, media upload, followers, or raw v2 calls."
  },
  {
    "skillName": "dws",
    "skillCode": "dws",
    "skillDescZh": "仅通过 dws CLI 操作钉钉产品：AI 表格、日历、通讯录、群与机器人、待办、OA 审批、考勤、日志、DING、开放文档、钉钉文档、云盘、AI 听记、邮箱等；始终使用 --format json；参数以 dws schema 与 --help 为准；鉴权异常时执行 dws auth login --device。",
    "skillDescEn": "Use dws for DingTalk product operations via CLI only: AI tables, calendar, contacts, groups and bots, todos, OA approval, attendance, reports, DING, dev docs, DingTalk docs, drive, AI minutes, mail; always --format json, use dws schema/--help for params, and on auth errors run dws auth login --device."
  }
]', 'OpenClaw 仓库 skills/ 目录下内置（随安装分发）的 Agent Skill 元数据 JSON 数组');





INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (79,'TERMINAL','PC端','PC端','PC端','PC','PC端',7),
	 (80,'TERMINAL','APP端','APP端','APP端','APP','APP端',7),
	 (70,'TEMPLATE_TYPE','企业问答','企业问答','enterprise_qa','enterprise_qa','企业问答',1),
	 (71,'TEMPLATE_TYPE','高效工作','高效工作','efficient_work','efficient_work','高效工作',2),
	 (72,'TEMPLATE_TYPE','办公写作','办公写作','office_writing','office_writing','办公写作',3),
	 (73,'TEMPLATE_TYPE','ESG','ESG','esg','esg','ESG',4),
	 (74,'TEMPLATE_TYPE','数据分析','数据分析','data_analysis','data_analysis','数据分析',5);
INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (75,'TEMPLATE_TYPE','调研报告','调研报告','research_report','research_report','调研报告',6),
	 (76,'TEMPLATE_TYPE','市场分析','市场分析','market_analysis','market_analysis','市场分析',7),
	 (77,'TEMPLATE_TYPE','其他','其他','other','other','其他',8),
	 (78,'TERMINAL','全端','全端','全端','ALL','全端',7),
	 (120,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','全部','Quick Create','all','成果空间类型',1),
	 (121,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','文稿','Bot','text','成果空间类型',2),
	 (122,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','PPT','Dify','ppt','成果空间类型',3);
INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (123,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','Excel','Bot','excel','成果空间类型',4),
	 (124,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','图片','Quick Create','image','成果空间类型',7),
	 (125,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','pdf','Bot','pdf','成果空间类型',5),
	 (126,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','md','Dify','md','成果空间类型',6),
	 (127,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','其他文件','Quick Create','other','成果空间类型',8),
	 (128,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','对话记录','Dify','chat','成果空间类型',9),
	 (129,'ACHIEVEMENT_SPACE_TYPE','成果空间类型','录音纪要','Dify','record','成果空间类型',10),
	 (203,'FEEDBACK','反馈类型','答案不准确','','ANS_INACCURATE','未解决问题答案不准确（界面反馈展示用，约定人张志豪）',1),
	 (204,'FEEDBACK','反馈类型','找错人','','WRONG_PERSON','未解决问题找错人（界面反馈展示用，约定人张志豪）',2);
INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (10847520,'USER_TYPE','百应管理后台默认角色','平台管理','PLAT_MAN','PLAT_MAN','新增用户时角色可选列表取值-平台管理（约定人何杜明）',1),
	 (10847521,'USER_TYPE','百应管理后台默认角色','组织管理','ORG_MAN','ORG_MAN','新增用户时角色可选列表取值-组织管理（约定人何杜明）',2),
	 (10847522,'USER_TYPE','百应管理后台默认角色','业务管理','BUSINESS_MAN','BUSINESS_MAN','新增用户时角色可选列表取值-业务管理（约定人何杜明）',3),
	 (10847523,'USER_TYPE','百应管理后台默认角色','普通员工','ORD_USER','ORD_USER','新增用户时角色可选列表取值-普通用户（约定人何杜明）',4),
	 (10847524,'USER_TYPE','百应管理后台默认角色','平台运维','PLAT_DEVOPS','PLAT_DEVOPS','新增用户时角色可选列表取值-平台运维（约定人何杜明）',5),
	 (10847525,'USER_TYPE','百应管理后台默认角色','技术开发','DEV_USER','DEV_USER','使用平台开发智能体、工具、知识、和数字员工',6),
	 (205,'FEEDBACK','反馈类型','其他','','FEED_OTHER','未解决问题其他（界面反馈展示用，约定人张志豪）',3),
	 (10823884,'DEVELOP_TOOL_DIG_EMPLOYEE','集成开发工具','快速创建','Quick Create','BYAI','百应门户数字员工快速创建入口',1);
INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (10823885,'DEVELOP_TOOL_DIG_EMPLOYEE','集成开发工具','博特','Bot','BOTE','百应门户数字员工快速创建入口',2),
	 (10823886,'DEVELOP_TOOL_DIG_EMPLOYEE','集成开发工具','Dify','Dify','DIFY','百应门户数字员工快速创建入口',3),
	 (10023084,'DIG_EMPLOYEE_MACHINE_CHANNEL','数字员工渠道','钉钉','DingTalk','DingTalk','钉钉',1);
INSERT INTO byai_system_config_list (param_id,param_group_code,param_group_name,param_name,param_en_name,param_value,param_desc,param_seq) VALUES
	 (10035633,'MODEL_TAGS','模型打标','ByClaw','BY_CLAW','2','ByClaw使用',3),
	 (10035634,'MODEL_TAGS','模型打标','默认对话模型','DEFAULT_CHAT_MODEL','1','默认对话模型',1),
	 (10035636,'MODEL_TAGS','模型打标','对话模型','CHAT_MODEL','3','对话模型',2),
	 (10035637,'MODEL_TAGS','模型打标','DataCloud','DATA_CLOUD','5','DataCloud使用',4),
	 (10035638,'MODEL_TAGS','模型打标','QA','QA','6','qa使用',6);




-- 初始化模型表
INSERT INTO byai_aimodel (model_id,model_type,model_name,model_no,url,ori_url,auth_token,status,is_support_chart,is_deepthink,max_content_token,in_params,create_by,create_time,inparam_template) VALUES
	 (-2000,'LLM','glm-5-turbo','glm-5-turbo','https://请用户替换',NULL,'请用户替换','OOA','0',NULL,128000,'{"connectTimeoutSec":32,"headers":[{"value":"","key":""}],"readTimeoutSec":60,"topP":0.9,"abilities":["1","3"],"presencePenalty":0.0,"maxRetries":3,"temperature":0.7,"maxTokens":1024,"retryIntervalSec":1,"frequencyPenalty":0.0,"providerName":"OpenAI","updatedAt":"2026-04-17T11:20:58Z"}',10005,'2025-05-27 13:16:26.647',NULL),
	 (-2001,'EMBEDDING','text-embedding-3-small','text-embedding-3-small','https://请用户替换',NULL,'请用户替换','OOA',NULL,NULL,128000,'{"connectTimeoutSec":32,"headers":[{"value":"","key":""}],"presencePenalty":0.0,"maxRetries":3,"temperature":0.7,"maxTokens":1024,"retryIntervalSec":1,"readTimeoutSec":60,"topP":0.9,"frequencyPenalty":0.0,"updatedAt":"2026-04-17T11:03:55Z","dimensions": 1536,"maxBatchSize": 10}',NULL,'2026-04-17 09:13:32.165',NULL);

INSERT INTO byai_tag_relation (relation_id,tag_id,obj_id,obj_type,create_time,creator_by,obj_code) VALUES
	 (10035710,1,-2000,'AI_MODEL','2026-04-17 11:20:59.283',NULL,NULL);
INSERT INTO byai.byai_tag_relation (relation_id,tag_id,obj_id,obj_type,create_time,creator_by,obj_code) VALUES
	 (10000282,3,-2000,'AI_MODEL','2026-04-30 16:19:52.235',NULL,NULL),
	 (10000283,5,-2000,'AI_MODEL','2026-04-30 16:19:52.235',NULL,NULL),
	 (10000284,6,-2000,'AI_MODEL','2026-04-30 16:19:52.235',NULL,NULL);

-- 初始化沙箱服务表
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES ('openclaw', '{"env": {"TZ": "Asia/Shanghai", "MODEL_ID": "${MODEL_ID}", "NODE_ENV": "production", "USER_CODE": "${user_code}", "MODEL_NAME": "${MODEL_NAME}", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "MODEL_ALIAS": "${MODEL_ALIAS}", "OPENCLAW_TZ": "Asia/Shanghai", "BEYOND_TOKEN": "${BEYOND_TOKEN}", "NODE_OPTIONS": "--max-old-space-size=4096", "MODEL_API_KEY": "${MODEL_API_KEY}", "DWS_CONFIG_DIR": "/by/.openclaw/.dws", "MODEL_BASE_URL": "${MODEL_BASE_URL}", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "BAIYING_SESSION": "${BAIYING_SESSION}", "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}", "OPENCLAW_STATE_DIR": "/by/.openclaw", "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}", "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}"}, "image": "ghcr.io/beyonai/byclaw/byclaw-openclaw:main", "ports": [{"port": 8080, "protocol": "http"}, {"port": 8081, "protocol": "http"}, {"port": 9222, "protocol": "http"}, {"port": 5901, "protocol": "http"}, {"port": 18789, "protocol": "http"}], "startup": {"entrypoint": ["node", "dist/index.js", "gateway", "--bind=lan", "--port=8080", "--allow-unconfigured", "--verbose"]}, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}, {"scope": "PUBLIC", "subPath": "byclaw/resource", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by/.openclaw/byresources"}], "bootstrap": {"copyTemplate": {"copyIfMissing": true, "targetVolumeKey": "base"}}, "resourceLimits": {"cpu": "2", "memory": "4Gi"}}', '{
    "meta": {
        "lastTouchedAt": "2026-03-27T08:46:51.148Z",
        "lastTouchedVersion": "2026.3.28"
    },
    "hooks": {
        "internal": {
            "enabled": true,
            "entries": {
                "boot-md": {
                    "enabled": false
                },
                "session-memory": {
                    "enabled": true
                }
            }
        }
    },
    "tools": {
        "web": {
            "search": {
                "enabled": false
            }
        },
        "profile": "full"
    },
    "agents": {
        "list": [
            {
                "id": "main",
                "default": true,
                "skills": [

                ],
                "workspace": "${OPENCLAW_STATE_DIR}/workspace"
            }
        ],
        "defaults": {
            "model": {
                "primary": "iwhalecloud/${MODEL_ID} "
            },
            "models": {
                "iwhalecloud/glm-5-turbo": {
                    "alias": "${MODEL_ALIAS}"
                }
            },
            "subagents": {
                "maxConcurrent": 8
            },
            "compaction": {
                "mode": "safeguard"
            },
            "maxConcurrent": 4,
            "verboseDefault": "full",
            "embeddedHarness": {
                "runtime": "skip-prewarm",
                "fallback": "pi"
            },
            "thinkingDefault": "high",
            "blockStreamingBreak": "text_end",
            "blockStreamingDefault": "on"
        }
    },
    "models": {
        "providers": {
            "iwhalecloud": {
                "api": "openai-completions",
                "apiKey": "${MODEL_API_KEY}",
                "models": [
                    {
                        "id": "${MODEL_ID}",
                        "cost": {
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0
                        },
                        "name": "${MODEL_NAME}",
                        "input": [
                            "text"
                        ],
                        "maxTokens": 8192,
                        "reasoning": true,
                        "contextWindow": 128000
                    }
                ],
                "baseUrl": "${MODEL_BASE_URL}"
            }
        }
    },
    "skills": {
        "load": {
            "watch": true,
            "watchDebounceMs": 5000
        },
        "install": {
            "nodeManager": "pnpm"
        }
    },
    "wizard": {
        "lastRunAt": "2026-02-03T07:41:55.092Z",
        "lastRunMode": "local",
        "lastRunCommand": "configure",
        "lastRunVersion": "2026.1.30"
    },
    "gateway": {
        "auth": {
            "mode": "token",
            "token": "${OPENCLAW_GATEWAY_TOKEN}"
        },
        "bind": "lan",
        "mode": "local",
        "port": 18789,
        "controlUi": {
            "allowedOrigins": [
                "*"
            ],
            "allowInsecureAuth": true,
            "dangerouslyDisableDeviceAuth": true,
            "dangerouslyAllowHostHeaderOriginFallback": true
        },
        "tailscale": {
            "mode": "off",
            "resetOnExit": false
        }
    },
    "plugins": {
        "load": {
            "paths": [
                "/app/extensions/baiying-enhance",
                "/app/extensions/byai-channel",
                "/app/extensions/byclaw-sqlite"
            ]
        },
        "allow": [
            "byai-channel",
            "baiying-enhance"
        ],
        "enabled": true,
        "entries": {
            "xai": {
                "enabled": false
            },
            "byai-channel": {
                "enabled": true
            },
            "baiying-enhance": {
                "config": {
                    "agentConfigDir": "/by/.openclaw/byresources/dig_employee",
                    "watchDebounceMs": 500,
                    "mainParentAgentId": "main",
                    "workspaceAutoSeed": true,
                    "embedApiKeysFromJson": true,
                    "executorResourcesDir": "/by/.openclaw/byresources",
                    "mergeAllowSpawnForMain": true
                },
                "enabled": true
            }
        }
    },
    "channels": {
        "byai-channel": {
            "enabled": true,
            "dmPolicy": "open",
            "allowFrom": [
                "*"
            ],
            "webhookPath": "/webhook/byai-channel",
            "streamEnabled": true,
            "blockStreaming": true,
            "sessionKeyPerSessionId": true
        }
    },
    "commands": {
        "native": "auto",
        "restart": true,
        "nativeSkills": "auto",
        "ownerDisplay": "raw"
    }
}', '2026-04-08 07:57:03.636');


-- 初始化趋势图查询语句
INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(3, 'USER_STATICS', '用户登录和对话统计', 'WITH login_data AS (
  SELECT
    TO_CHAR(login_time, ''YYYY-MM-DD'') AS time,
    COUNT(1) AS loginCount
  FROM po_login_log
  WHERE status = 0
  and login_time >= ${start_time}
  and login_time <= ${end_time}
  GROUP BY time
),
chat_data AS (
  SELECT
    TO_CHAR(create_time, ''YYYY-MM-DD'') AS time,
    COUNT(1) AS chatCount
  FROM byai_session_member
  WHERE mem_obj_type = ''USER''
  and create_time >= ${start_time}
  and create_time <= ${end_time}
  GROUP BY time
)
SELECT
  COALESCE(l.time, c.time) AS time,
  COALESCE(l.loginCount, 0) AS login_count,
  COALESCE(c.chatCount, 0) AS chat_count
FROM login_data l
FULL JOIN chat_data c
  ON l.time = c.time
ORDER BY time ASC', 'time', 'login_count,chat_count', 'start_time,end_time', 1, '2025-11-21 15:52:43.941', '2025-11-21 15:52:43.941', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(7, 'ACTIVITY_TOP_ORG_LEVEL3', '三级组织活跃度top10', 'WITH current_period_data AS (
    SELECT
        org3.org_id,
        org3.org_name,
        COUNT(1) AS total_chat_cnt,
        COUNT(DISTINCT a.mem_obj_id) AS active_user_cnt
    FROM byai_session_member a
    LEFT JOIN po_users_organization b
        ON a.mem_obj_id = b.user_id
    LEFT JOIN po_organization user_org
        ON b.org_id = user_org.org_id
    LEFT JOIN po_organization org3
        ON org3.org_level = 2
        AND org3.org_id = substring(
            user_org.path_code,
            ''^(?:[^.]+.){3}([^.]+)''
        )
    WHERE org3.org_id IS NOT NULL
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY org3.org_id, org3.org_name
    ORDER BY total_chat_cnt DESC
    LIMIT 10
),
previous_period_data AS (
    SELECT
        org3.org_id,
        org3.org_name,
        COUNT(1) AS prev_total_chat_cnt,
        COUNT(DISTINCT a.mem_obj_id) AS prev_active_user_cnt
    FROM byai_session_member a
    LEFT JOIN po_users_organization b
        ON a.mem_obj_id = b.user_id
    LEFT JOIN po_organization user_org
        ON b.org_id = user_org.org_id
    LEFT JOIN po_organization org3
        ON org3.org_level = 2
        AND org3.org_id = substring(
            user_org.path_code,
            ''^(?:[^.]+.){3}([^.]+)''
        )
    WHERE org3.org_id IS NOT NULL
      AND a.create_time >= CASE ${period_type}
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND org3.org_id IN (SELECT org_id FROM current_period_data)
    GROUP BY org3.org_id, org3.org_name
)
SELECT
    COALESCE(cpd.org_name, ppd.org_name) AS three_level_org_name,
    COALESCE(cpd.total_chat_cnt, 0) AS current_total_chat_cnt,
    COALESCE(cpd.active_user_cnt, 0) AS current_active_user_cnt,
    COALESCE(ppd.prev_total_chat_cnt, 0) AS prev_total_chat_cnt,
    COALESCE(ppd.prev_active_user_cnt, 0) AS prev_active_user_cnt,
    CASE
        WHEN COALESCE(ppd.prev_total_chat_cnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.total_chat_cnt, 0) - COALESCE(ppd.prev_total_chat_cnt, 0)) * 100.0 /
                COALESCE(ppd.prev_total_chat_cnt, 0),
                2
            )
    END AS chat_cnt_growth_rate,
    CASE
        WHEN COALESCE(ppd.prev_active_user_cnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.active_user_cnt, 0) - COALESCE(ppd.prev_active_user_cnt, 0)) * 100.0 /
                COALESCE(ppd.prev_active_user_cnt, 0),
                2
            )
    END AS active_user_growth_rate
FROM current_period_data cpd
FULL OUTER JOIN previous_period_data ppd
    ON cpd.org_id = ppd.org_id
ORDER BY cpd.total_chat_cnt DESC NULLS LAST limit 10;', 'three_level_org_name', 'current_total_chat_cnt,active_user_growth_rate,current_total_chat_cnt,chat_cnt_growth_rate', 'start_time,end_time,period_type', 1, '2025-11-24 14:45:55.341', '2025-11-24 14:45:55.341', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(1, 'DIG_EMPLOYEE_SERVICE_TOP', '数字员工服务统计', 'WITH current_data AS (
    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        sum(a.request_count) AS curCnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON a.mem_obj_id = c.resource_id
    WHERE a.mem_obj_type = ''AGENT'' AND c.integration_type <> ''PAGE''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY b.resource_id, b.resource_name, b.avatar

    UNION ALL

    select
        CAST(temp_table.resource_id AS VARCHAR) AS resource_id,
        temp_table.resource_name,
        temp_table.avatar,
        temp_table.curCnt
    from
    (select
        b.resource_id,
        b.resource_name,
        b.avatar,
        btl.object_id,
        count(1) as curCnt
    from byai_track_log btl
    inner join ss_resource b
    on btl.object_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON btl.object_id = c.resource_id
    where btl.object_type = ''DIG_EMPLOYEE''
    and c.integration_type = ''PAGE''
    AND btl.create_time >= ${start_time}::TIMESTAMP
    AND btl.create_time <= ${end_time}::TIMESTAMP

    GROUP BY b.resource_id, b.resource_name, b.avatar, btl.object_id) as temp_table
),
previous_data AS (

    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        sum(a.request_count) AS preCnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON a.mem_obj_id = c.resource_id
    WHERE a.mem_obj_type = ''AGENT''
      AND c.integration_type <> ''PAGE''
      AND a.create_time >= CASE ${period_type}
          WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
    GROUP BY b.resource_id, b.resource_name, b.avatar

    UNION ALL

    select
        CAST(temp_table.resource_id AS VARCHAR) AS resource_id,
        temp_table.resource_name,
        temp_table.avatar,
        temp_table.preCnt
    from
    (select
        b.resource_id,
        b.resource_name,
        b.avatar,
        btl.object_id,
        count(1) as preCnt
    from byai_track_log btl
    inner join ss_resource b
    on btl.object_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON btl.object_id = c.resource_id
    where btl.object_type = ''DIG_EMPLOYEE''
    and c.integration_type = ''PAGE''
    AND btl.create_time >= CASE ${period_type}
        WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
        WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
        WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
    END
    AND btl.create_time <= CASE ${period_type}
        WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
        WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
        WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
    END
    GROUP BY b.resource_id, b.resource_name, b.avatar, btl.object_id) as temp_table
)
SELECT
    COALESCE(cd.resource_id, pd.resource_id) AS resource_id,
    COALESCE(cd.resource_name, pd.resource_name) AS resource_name,
    COALESCE(cd.curCnt, 0) AS current_service_count,
    COALESCE(pd.preCnt, 0) AS previous_service_count,
    COALESCE(cd.avatar, '''') AS avatar,
    CASE
        WHEN COALESCE(pd.preCnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cd.curCnt, 0) - COALESCE(pd.preCnt, 0)) * 100.0 /
                COALESCE(pd.preCnt, 0),
                2
            )
    END AS growth_rate,
    CASE ${period_type}
        WHEN ''day'' THEN ''日环比''
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_data cd
FULL OUTER JOIN previous_data pd
    ON cd.resource_id = pd.resource_id
    AND cd.resource_name = pd.resource_name
ORDER BY current_service_count DESC
limit 10;', 'resource_id,resource_name,period_type', 'current_service_count,growth_rate', 'start_time,end_time,period_type', 1, '2025-11-20 17:01:32.553', '2025-11-20 17:01:32.553', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(5, 'DIG_EMPLOYEE_QUALITY_DETAIL', '数字员工规范校验质量明细', 'SELECT
    b.resource_name,
    b.resource_id,
    b.avatar,
    c.user_name,
    a.target_quality AS score,
    a.quality_description AS "desc",
    COALESCE(
        (SELECT STRING_AGG(pu.user_name, '','')
         FROM po_users pu
         WHERE pu.user_id IN (
             SELECT apg.grant_to_obj_id
             FROM au_privilege_grant apg
             WHERE apg.grant_to_obj_type = ''USER''
               AND apg.grant_type = ''ALLOW_MANAGE''
               AND apg.grant_obj_id = a.agent_id
         )),
        ''''
    ) AS man_user_name
FROM byai_monitor_target a
INNER JOIN ss_resource b
    ON a.agent_id = b.resource_id
LEFT JOIN po_users c
    ON b.create_by = c.user_id
WHERE b.resource_status = 2
ORDER BY a.target_quality ASC, b.shelf_time DESC', '', 'resource_name,user_name,score,desc,avatar', 'page_size,page_index', 1, '2025-11-24 11:08:01.029', '2025-11-24 11:08:01.029', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(2, 'DIG_EMPLOYEE_SUBSCRIBE_TOP', '数字员工订阅统计', 'WITH current_period_data AS (
    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        COUNT(1) AS focus_count
    FROM au_privilege_grant a
    JOIN ss_resource b ON a.grant_obj_id = b.resource_id
    WHERE grant_type = ''AVAILABLE_USE''
      AND grant_to_obj_type = ''USER''
      AND grant_obj_type = ''DIG_EMPLOYEE''
      AND a.create_date >= ${start_time}
      AND a.create_date <= ${end_time}
    GROUP BY b.resource_id, b.resource_name, b.avatar
),
previous_period_data AS (
    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        COUNT(1) AS previous_focus_count
    FROM au_privilege_grant a
    JOIN ss_resource b ON a.grant_obj_id = b.resource_id
    WHERE grant_type = ''AVAILABLE_USE''
      AND grant_to_obj_type = ''USER''
      AND grant_obj_type = ''DIG_EMPLOYEE''
      AND a.create_date >=
          CASE ${period_type}
              WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
              WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
          END
      AND a.create_date <=
          CASE ${period_type}
              WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
              WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
          END
    GROUP BY b.resource_id, b.resource_name, b.avatar
)
SELECT
    COALESCE(cpd.resource_id, ppd.resource_id) AS resource_id,
    COALESCE(cpd.resource_name, ppd.resource_name) AS resource_name,
    COALESCE(cpd.avatar, '''') AS avatar,
    COALESCE(cpd.focus_count, 0) AS focus_count,
    COALESCE(ppd.previous_focus_count, 0) AS previous_focus_count,
    CASE
        WHEN COALESCE(ppd.previous_focus_count, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.focus_count, 0) - COALESCE(ppd.previous_focus_count, 0)) * 100.0 /
                COALESCE(ppd.previous_focus_count, 0),
                2
            )
    END AS growth_rate,
    CASE ${period_type}
        WHEN ''day'' THEN ''日环比''
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_period_data cpd
FULL OUTER JOIN previous_period_data ppd
    ON cpd.resource_id = ppd.resource_id
    AND cpd.resource_name = ppd.resource_name
ORDER BY focus_count DESC
LIMIT 10;', 'resource_id,resource_name,period_type', 'focus_count,growth_rate', 'start_time,end_time,period_type', 1, '2025-11-20 17:34:07.061', '2025-11-20 17:34:07.061', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(6, 'ACTIVITY_TOP_USER', '员工活跃度TOP10', 'WITH current_period_data AS (
    SELECT
        a.mem_obj_id AS user_id,
        b.user_name,
        COUNT(1) AS chat_cnt
    FROM byai_session_member a
    JOIN po_users b ON a.mem_obj_id = b.user_id
    WHERE a.mem_obj_type = ''USER''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY a.mem_obj_id, b.user_name
    ORDER BY chat_cnt DESC
    LIMIT 10
),
previous_period_data AS (
    SELECT
        a.mem_obj_id AS user_id,
        b.user_name,
        COUNT(1) AS previous_chat_cnt
    FROM byai_session_member a
    JOIN po_users b ON a.mem_obj_id = b.user_id
    WHERE a.mem_obj_type = ''USER''
      AND a.create_time >= CASE ${period_type}
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
    GROUP BY a.mem_obj_id, b.user_name
)
SELECT
    COALESCE(cpd.user_name, ppd.user_name) AS user_name,
    COALESCE(cpd.chat_cnt, 0) AS current_chat_cnt,
    COALESCE(ppd.previous_chat_cnt, 0) AS previous_chat_cnt,
    CASE
        WHEN COALESCE(ppd.previous_chat_cnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.chat_cnt, 0) - COALESCE(ppd.previous_chat_cnt, 0)) * 100.0 /
                COALESCE(ppd.previous_chat_cnt, 0),
                2
            )
    END AS growth_rate,
    CASE ${period_type}
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_period_data cpd
FULL OUTER JOIN previous_period_data ppd
    ON cpd.user_id = ppd.user_id
ORDER BY cpd.chat_cnt DESC NULLS LAST
LIMIT 10;', 'user_name', 'current_chat_cnt,growth_rate', 'start_time,end_time,period_type', 1, '2025-11-24 14:39:21.384', '2025-11-24 14:39:21.384', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(8, 'ACTIVITY_TOP_ORG_LEVEL4', '四级组织活跃度top10', 'WITH current_period_data AS (
    SELECT
        org4.org_id,
        org4.org_name,
        COUNT(1) AS total_chat_cnt,
        COUNT(DISTINCT a.mem_obj_id) AS active_user_cnt
    FROM byai_session_member a
    LEFT JOIN po_users_organization b
        ON a.mem_obj_id = b.user_id
    LEFT JOIN po_organization user_org
        ON b.org_id = user_org.org_id
    LEFT JOIN po_organization org4
        ON org4.org_level = 3
        AND org4.org_id = substring(
            user_org.path_code,
            ''^(?:[^.]+.){4}([^.]+)''
        )
    WHERE org4.org_id IS NOT NULL
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY org4.org_id, org4.org_name
    ORDER BY total_chat_cnt DESC
    LIMIT 10
),
previous_period_data AS (
    SELECT
        org4.org_id,
        org4.org_name,
        COUNT(1) AS prev_total_chat_cnt,
        COUNT(DISTINCT a.mem_obj_id) AS prev_active_user_cnt
    FROM byai_session_member a
    LEFT JOIN po_users_organization b
        ON a.mem_obj_id = b.user_id
    LEFT JOIN po_organization user_org
        ON b.org_id = user_org.org_id
    LEFT JOIN po_organization org4
        ON org4.org_level = 3
        AND org4.org_id = substring(
            user_org.path_code,
            ''^(?:[^.]+.){4}([^.]+)''
        )
    WHERE org4.org_id IS NOT NULL
      AND a.create_time >= CASE ${period_type}
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND org4.org_id IN (SELECT org_id FROM current_period_data)
    GROUP BY org4.org_id, org4.org_name
)
SELECT
    COALESCE(cpd.org_id, ppd.org_id) AS four_level_org_id,
    COALESCE(cpd.org_name, ppd.org_name) AS four_level_org_name,
    COALESCE(cpd.total_chat_cnt, 0) AS current_total_chat_cnt,
    COALESCE(cpd.active_user_cnt, 0) AS current_active_user_cnt,
    COALESCE(ppd.prev_total_chat_cnt, 0) AS prev_total_chat_cnt,
    COALESCE(ppd.prev_active_user_cnt, 0) AS prev_active_user_cnt,
    CASE
        WHEN COALESCE(ppd.prev_total_chat_cnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.total_chat_cnt, 0) - COALESCE(ppd.prev_total_chat_cnt, 0)) * 100.0 /
                COALESCE(ppd.prev_total_chat_cnt, 0),
                2
            )
    END AS chat_cnt_growth_rate,
    CASE
        WHEN COALESCE(ppd.prev_active_user_cnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cpd.active_user_cnt, 0) - COALESCE(ppd.prev_active_user_cnt, 0)) * 100.0 /
                COALESCE(ppd.prev_active_user_cnt, 0),
                2
            )
    END AS active_user_growth_rate,
    CASE ${period_type}
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_period_data cpd
FULL OUTER JOIN previous_period_data ppd
    ON cpd.org_id = ppd.org_id
ORDER BY cpd.total_chat_cnt DESC NULLS LAST;', 'four_level_org_name', 'current_total_chat_cnt,active_user_growth_rate,current_total_chat_cnt,chat_cnt_growth_rate', 'start_time,end_time,period_type', 1, '2025-11-24 14:46:20.214', '2025-11-24 14:46:20.214', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(10, 'DIG_EMPLOYEE_QUALITY', '数字员工质量统计', 'SELECT
    CAST(b.resource_id AS VARCHAR) AS resource_id,
    b.resource_name,
    b.avatar,
    a.target_quality
FROM byai_monitor_target a
INNER JOIN ss_resource b
    ON a.agent_id = b.resource_id
ORDER BY a.target_quality DESC
LIMIT 10;', 'resource_id,resource_name,avatar', 'target_quality', '', 1, '2025-11-24 20:31:48.167', '2025-11-24 20:31:48.167', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(11, 'SINGLE_DIG_EMPLOYEE_SERVICE', '单个数字员工服务数据统计', 'SELECT
  COALESCE(SUM(request_count), 0) AS service_count,
  COALESCE(COUNT(DISTINCT creator_id), 0) AS service_people_count,
  CASE
    WHEN COALESCE(COUNT(DISTINCT creator_id), 0) = 0 THEN 0.00
    ELSE ROUND(SUM(request_count) / COUNT(DISTINCT creator_id), 2)
  END AS avg_service_count
FROM byai_session_member
WHERE mem_obj_type = ''AGENT'' AND mem_obj_id = ${agent_id}
and create_time >= ${start_time} and create_time <=${end_time};
', NULL, 'service_count,service_people_count,avg_service_count', 'agent_id', 1, '2025-12-05 10:06:54.933', '2025-12-05 10:06:54.933', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(9, 'INDEX_TAB', 'tab卡片指标，数字员工已上架总数，数字员工活跃度，上线用户和数字员工服务总次数', 'WITH current_period_data AS (
    SELECT
        COALESCE(shelf.shelf_agent, 0) AS current_shelf_agent,
        COALESCE(login.login_user, 0) AS current_login_user,
        COALESCE(service.service_cnt, 0) AS current_service_cnt,
        COALESCE(active.active_agent, 0) AS current_active_agent,
        COALESCE(total_shelf_agent.shelf_agent, 0) AS cur_total_shelf_agent,
        CASE
            WHEN total_shelf_agent.shelf_agent = 0 THEN 0.00
            ELSE ROUND(active.active_agent * 100.0 / total_shelf_agent.shelf_agent, 2)
        END AS current_agent_activity_rate
    FROM (
        SELECT COUNT(1) AS shelf_agent
        FROM ss_resource
        WHERE resource_status = 2
          AND shelf_time >= ${start_time}::TIMESTAMP
          AND shelf_time <= ${end_time}::TIMESTAMP
    ) shelf,
    (
        SELECT COUNT(DISTINCT user_id) AS login_user
        FROM po_login_log
        WHERE login_time >= ${start_time}::TIMESTAMP
          AND login_time <= ${end_time}::TIMESTAMP
    ) login,
    (
        SELECT COUNT(1) AS shelf_agent
        FROM ss_resource
        WHERE resource_status = 2
          AND resource_biz_type = ''DIG_EMPLOYEE''
          AND shelf_time <= ${end_time}::TIMESTAMP
    ) total_shelf_agent,
    (
          SELECT SUM(total_num) AS service_cnt
            FROM (
                SELECT sum(request_count) AS total_num
                FROM byai_session_member a
                LEFT JOIN ss_res_ext_dig_employee b
                ON a.mem_obj_id = b.resource_id
                WHERE a.mem_obj_type = ''AGENT'' AND b.integration_type <> ''PAGE''
                AND create_time >= ${start_time}::TIMESTAMP
                AND create_time <= ${end_time}::TIMESTAMP

                UNION ALL
                SELECT sum(1) AS total_num
                FROM byai_track_log btl
                left join ss_res_ext_dig_employee srede
                on btl.object_id = srede.resource_id
                WHERE object_type = ''DIG_EMPLOYEE''
                and srede.integration_type = ''PAGE''
                AND create_time >= ${start_time}::TIMESTAMP
                AND create_time <= ${end_time}::TIMESTAMP
            ) AS temp_table
    ) service,
    (
        SELECT COUNT(DISTINCT agent_id) AS active_agent
        FROM (
            SELECT bsm.mem_obj_id AS agent_id
            FROM ss_resource sr
            JOIN byai_session_member bsm
                ON sr.resource_id = bsm.mem_obj_id
            LEFT JOIN ss_res_ext_dig_employee b
                ON bsm.mem_obj_id = b.resource_id
            WHERE sr.resource_status = 2
              AND bsm.mem_obj_type = ''AGENT''
              AND b.integration_type <> ''PAGE''
              AND bsm.create_time >= ${start_time}::TIMESTAMP
              AND bsm.create_time <= ${end_time}::TIMESTAMP

            UNION ALL

            SELECT btl.object_id AS agent_id
            FROM byai_track_log btl
            left join ss_res_ext_dig_employee srede
                on btl.object_id = srede.resource_id
            WHERE btl.object_type = ''DIG_EMPLOYEE''
                and srede.integration_type = ''PAGE''
              AND btl.create_time >= ${start_time}::TIMESTAMP
              AND btl.create_time <= ${end_time}::TIMESTAMP
        ) AS union_agent_ids
    ) active
),
previous_period_data AS (
    SELECT
        COALESCE(shelf.shelf_agent, 0) AS prev_shelf_agent,
        COALESCE(login.login_user, 0) AS prev_login_user,
        COALESCE(service.service_cnt, 0) AS prev_service_cnt,
        COALESCE(active.active_agent, 0) AS prev_active_agent,
        COALESCE(total_shelf_agent.shelf_agent, 0) AS pre_total_shelf_agent,
        CASE
            WHEN total_shelf_agent.shelf_agent = 0 THEN 0.00
            ELSE ROUND(active.active_agent * 100.0 / total_shelf_agent.shelf_agent, 2)
        END AS prev_agent_activity_rate
    FROM (
        SELECT COUNT(1) AS shelf_agent
        FROM ss_resource
        WHERE resource_status = 2
          AND shelf_time >= CASE ${period_type}
              WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
          END
          AND shelf_time <= CASE ${period_type}
              WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
          END
    ) shelf,
    (
        SELECT COUNT(DISTINCT user_id) AS login_user
        FROM po_login_log
        WHERE login_time >= CASE ${period_type}
              WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
          END
          AND login_time <= CASE ${period_type}
              WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
          END
    ) login,
    (
        SELECT COUNT(1) AS shelf_agent
        FROM ss_resource
        WHERE resource_status = 2
          AND resource_biz_type = ''DIG_EMPLOYEE''
          AND shelf_time <= CASE ${period_type}
              WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
              WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
          END
    ) total_shelf_agent,
    (
        SELECT SUM(total_num) AS service_cnt
        FROM (
            SELECT sum(request_count) AS total_num
            FROM byai_session_member a
            LEFT JOIN ss_res_ext_dig_employee b
            ON a.mem_obj_id = b.resource_id
            WHERE a.mem_obj_type = ''AGENT'' AND b.integration_type <> ''PAGE''
            AND create_time >= CASE ${period_type}
                WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
                WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
            END
            AND create_time <= CASE ${period_type}
                WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
                WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
            END
            UNION ALL
            SELECT sum(1) AS total_num
            FROM byai_track_log btl
            left join ss_res_ext_dig_employee srede
            on btl.object_id = srede.resource_id
            WHERE object_type = ''DIG_EMPLOYEE''
            and srede.integration_type = ''PAGE''
            AND create_time >= CASE ${period_type}
                WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
                WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
            END
            AND create_time <= CASE ${period_type}
                WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
                WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
            END
        ) AS temp_table
    ) service,
    (
        SELECT COUNT(DISTINCT agent_id) AS active_agent
        FROM (
            SELECT bsm.mem_obj_id AS agent_id
            FROM ss_resource sr
            JOIN byai_session_member bsm
                ON sr.resource_id = bsm.mem_obj_id
            LEFT JOIN ss_res_ext_dig_employee b
            ON bsm.mem_obj_id = b.resource_id
            WHERE sr.resource_status = 2
              AND bsm.mem_obj_type = ''AGENT''
              AND b.integration_type <> ''PAGE''
              AND bsm.create_time >= CASE ${period_type}
                  WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
                  WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
              END
              AND bsm.create_time <= CASE ${period_type}
                  WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
                  WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
              END
            UNION ALL
            SELECT btl.object_id AS agent_id
            FROM byai_track_log btl
            left join ss_res_ext_dig_employee srede
            on btl.object_id = srede.resource_id
            WHERE btl.object_type = ''DIG_EMPLOYEE''
            and srede.integration_type = ''PAGE''
              AND btl.create_time >= CASE ${period_type}
                  WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
                  WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
              END
              AND btl.create_time <= CASE ${period_type}
                  WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
                  WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
              END
        ) AS union_agent_ids
    ) active
)
SELECT
    cpd.current_shelf_agent,
    cpd.current_login_user,
    cpd.current_service_cnt,
    cpd.current_active_agent,
    cpd.cur_total_shelf_agent,
    ppd.pre_total_shelf_agent,
    ppd.prev_active_agent,
    ppd.prev_shelf_agent,
    ppd.prev_login_user,
    ppd.prev_service_cnt,
    cpd.current_agent_activity_rate,
    ppd.prev_agent_activity_rate,
    CASE
        WHEN ppd.prev_shelf_agent = 0 THEN NULL
        ELSE ROUND((cpd.current_shelf_agent - ppd.prev_shelf_agent) * 100.0 / ppd.prev_shelf_agent, 2)
    END AS shelf_agent_growth_rate,
    CASE
        WHEN ppd.prev_login_user = 0 THEN NULL
        ELSE ROUND((cpd.current_login_user - ppd.prev_login_user) * 100.0 / ppd.prev_login_user, 2)
    END AS login_user_growth_rate,
    CASE
        WHEN ppd.prev_service_cnt = 0 THEN NULL
        ELSE ROUND((cpd.current_service_cnt - ppd.prev_service_cnt) * 100.0 / ppd.prev_service_cnt, 2)
    END AS service_cnt_growth_rate,
    ROUND(cpd.current_agent_activity_rate - ppd.prev_agent_activity_rate, 2) AS activity_rate_growth,
    CASE ${period_type}
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_period_data cpd
CROSS JOIN previous_period_data ppd;', NULL, 'current_shelf_agent,shelf_agent_growth_rate,current_agent_activity_rate,activity_rate_growth,current_login_user,login_user_growth_rate,current_service_cnt,service_cnt_growth_rate', 'start_time,end_time,period_type', 1, '2025-11-24 18:20:16.252', '2025-11-24 18:20:16.252', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(12, 'SINGLE_DIG_EMPLOYEE_SERVICE_PERIOD', '单个数字员工服务数据周期趋势统计', '
WITH
date_series AS (
  SELECT generate_series(
           ${start_time}::date,
           ${end_time}::date,
           ''1 day''::interval
         )::date AS time
),
service_data AS (
  SELECT
    TO_CHAR(create_time, ''YYYY-MM-DD'') AS time,
    COALESCE(SUM(request_count), 0) AS service_count,
    COALESCE(COUNT(DISTINCT creator_id), 0) AS service_people_count,
    CASE
      WHEN COALESCE(COUNT(DISTINCT creator_id), 0) = 0 THEN 0.00
      ELSE ROUND(SUM(request_count) / COUNT(DISTINCT creator_id), 2)
    END AS avg_service_count
  FROM byai_session_member
  WHERE
    mem_obj_type = ''AGENT''
    AND mem_obj_id = ${agent_id}
    AND create_time >= ${start_time}
    AND create_time <= ${end_time}
  GROUP BY time
)
SELECT
  TO_CHAR(ds.time, ''YYYY-MM-DD'') AS time,
  COALESCE(sd.service_count, 0) AS service_count,
  COALESCE(sd.service_people_count, 0) AS service_people_count,
  COALESCE(sd.avg_service_count, 0.00) AS avg_service_count
FROM date_series ds
LEFT JOIN service_data sd
  ON TO_CHAR(ds.time, ''YYYY-MM-DD'') = sd.time
ORDER BY ds.time ASC;', NULL, NULL, 'start_time,end_time,period_type,agent_id', 1, '2025-12-05 10:51:59.826', '2025-12-05 10:51:59.826', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(4, 'DIG_EMPLOYEE_TREND_STATISTICS', '数字员工趋势统计', 'WITH
date_series AS (
    SELECT generate_series(
        ${start_time}::DATE,
        ${end_time}::DATE,
        interval ''1 day''
    ) AS stat_date
),
total_agent AS (
    SELECT COUNT(DISTINCT b.resource_id) AS total_cnt
    FROM ss_resource b
    WHERE b.resource_status = 2
	  AND b.resource_biz_type = ''DIG_EMPLOYEE''
      AND b.shelf_time <= ${end_time}::TIMESTAMP
),
agent_active_union AS (
    SELECT
        count(distinct a.mem_obj_id) AS active_agent,
        TO_CHAR(a.create_time, ''YYYY-MM-DD'') AS stat_date
    FROM byai_session_member a
    LEFT JOIN ss_res_ext_dig_employee b
    ON a.mem_obj_id = b.resource_id
    WHERE mem_obj_type = ''AGENT'' and b.integration_type <> ''PAGE''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY TO_CHAR(create_time, ''YYYY-MM-DD'')

    UNION ALL

    SELECT
    	count(distinct a.object_id) as active_agent,
    	TO_CHAR(a.create_time, ''YYYY-MM-DD'') AS stat_date
    FROM byai_track_log a
    LEFT JOIN ss_res_ext_dig_employee b
    ON a.object_id = b.resource_id
    WHERE a.object_type = ''DIG_EMPLOYEE'' and b.integration_type = ''PAGE''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY TO_CHAR(create_time, ''YYYY-MM-DD'')
),
service_agent_union AS (
    SELECT
        SUM(a.request_count) AS serviceCnt,
        TO_CHAR(a.create_time, ''YYYY-MM-DD'') AS stat_date
    FROM byai_session_member a
    LEFT JOIN ss_res_ext_dig_employee b
    ON a.mem_obj_id = b.resource_id
    WHERE mem_obj_type = ''AGENT'' and b.integration_type <> ''PAGE''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY TO_CHAR(create_time, ''YYYY-MM-DD'')

    UNION ALL

    SELECT
    	count(a.object_id) as serviceCnt,
    	TO_CHAR(a.create_time, ''YYYY-MM-DD'') AS stat_date
    FROM byai_track_log a
    LEFT JOIN ss_res_ext_dig_employee b
    ON a.object_id = b.resource_id
    WHERE a.object_type = ''DIG_EMPLOYEE'' and b.integration_type = ''PAGE''
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY TO_CHAR(create_time, ''YYYY-MM-DD'')
),
total_service_agent AS (
    SELECT
        stat_date,
        SUM(serviceCnt) AS serviceCnt
    FROM service_agent_union
    GROUP BY stat_date
    ORDER BY stat_date ASC
),
total_active_agent AS (
    SELECT
        stat_date,
        SUM(active_agent) AS active_agent
    FROM agent_active_union
    GROUP BY stat_date
    ORDER BY stat_date ASC
)
SELECT
    TO_CHAR(ds.stat_date, ''YYYY-MM-DD'') AS stat_date,
	COALESCE(tsa.serviceCnt, 0) AS chat_cnt,
	COALESCE(ta.total_cnt, 0) AS total_agent_cnt,
    ROUND(
        COALESCE(taa.active_agent::NUMERIC, 0) / NULLIF(ta.total_cnt::NUMERIC, 0) * 100,
        2
    ) AS activity
FROM date_series ds
LEFT JOIN total_service_agent tsa
	ON TO_CHAR(ds.stat_date, ''YYYY-MM-DD'') = tsa.stat_date
LEFT JOIN total_active_agent taa
	ON TO_CHAR(ds.stat_date, ''YYYY-MM-DD'') = taa.stat_date
CROSS JOIN total_agent ta
ORDER BY ds.stat_date ASC;', 'stat_date', 'chat_cnt,activity', 'start_time,end_time', 1, '2025-11-24 10:26:30.112', '2025-11-24 10:26:30.112', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(21, 'DATASET_DIG_EMPLOYEE_TOP5_CATALOG', '数据资产指标-数字员工使用前5', 'WITH current_data AS (
    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        sum(a.request_count) AS curCnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON a.mem_obj_id = c.resource_id
    WHERE a.mem_obj_type = ''AGENT'' AND c.integration_type <> ''PAGE''
      AND b.resource_status not in(1,6)
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
      AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
    GROUP BY b.resource_id, b.resource_name, b.avatar

    UNION ALL

    select
        CAST(temp_table.resource_id AS VARCHAR) AS resource_id,
        temp_table.resource_name,
        temp_table.avatar,
        temp_table.curCnt
    from
    (select
        b.resource_id,
        b.resource_name,
        b.avatar,
        btl.object_id,
        count(1) as curCnt
    from byai_track_log btl
    inner join ss_resource b
    on btl.object_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON btl.object_id = c.resource_id
    where btl.object_type = ''DIG_EMPLOYEE''
    AND b.resource_status not in(1,6)
    AND c.integration_type = ''PAGE''
    AND btl.create_time >= ${start_time}::TIMESTAMP
    AND btl.create_time <= ${end_time}::TIMESTAMP
    AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
    GROUP BY b.resource_id, b.resource_name, b.avatar, btl.object_id) as temp_table
),
previous_data AS (

    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        b.avatar,
        sum(a.request_count) AS preCnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON a.mem_obj_id = c.resource_id
    WHERE a.mem_obj_type = ''AGENT''
      AND c.integration_type <> ''PAGE''
      AND a.create_time >= CASE ${period_type}
          WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
    GROUP BY b.resource_id, b.resource_name, b.avatar

    UNION ALL

    select
        CAST(temp_table.resource_id AS VARCHAR) AS resource_id,
        temp_table.resource_name,
        temp_table.avatar,
        temp_table.preCnt
    from
    (select
        b.resource_id,
        b.resource_name,
        b.avatar,
        btl.object_id,
        count(1) as preCnt
    from byai_track_log btl
    inner join ss_resource b
    on btl.object_id = b.resource_id
    LEFT JOIN ss_res_ext_dig_employee c
        ON btl.object_id = c.resource_id
    where btl.object_type = ''DIG_EMPLOYEE''
    and c.integration_type = ''PAGE''
    AND btl.create_time >= CASE ${period_type}
        WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
        WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
        WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
    END
    AND btl.create_time <= CASE ${period_type}
        WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
        WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
        WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
    END
    AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
    GROUP BY b.resource_id, b.resource_name, b.avatar, btl.object_id) as temp_table
)
SELECT
    COALESCE(cd.resource_id, pd.resource_id) AS resource_id,
    COALESCE(cd.resource_name, pd.resource_name) AS resource_name,
    COALESCE(cd.curCnt, 0) AS current_service_count,
    COALESCE(pd.preCnt, 0) AS previous_service_count,
    COALESCE(cd.avatar, '''') AS avatar,
    CASE
        WHEN COALESCE(pd.preCnt, 0) = 0 THEN
            NULL
        ELSE
            ROUND(
                (COALESCE(cd.curCnt, 0) - COALESCE(pd.preCnt, 0)) * 100.0 /
                COALESCE(pd.preCnt, 0),
                2
            )
    END AS growth_rate,
    CASE ${period_type}
        WHEN ''day'' THEN ''日环比''
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_data cd
FULL OUTER JOIN previous_data pd
    ON cd.resource_id = pd.resource_id
    AND cd.resource_name = pd.resource_name
ORDER BY current_service_count DESC
limit 5;', NULL, NULL, 'catalog_id,start_time,end_time,period_type', 1, '2026-01-22 17:03:40.601', '2026-01-22 17:03:40.601', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(22, 'DATASET_DOC_OBTONOLOGY', '数据资产指标-知识库和本体内容的数量统计', 'SELECT
    COUNT(CASE WHEN resource_biz_type = ''KG_DOC''  THEN 1 END) AS KG_DOC,
    COUNT(CASE WHEN resource_biz_type = ''KG_DB''   THEN 1 END) AS KG_DB,
    COUNT(CASE WHEN resource_biz_type = ''KG_QA''   THEN 1 END) AS KG_QA,
    COUNT(CASE WHEN resource_biz_type = ''VIEW''    THEN 1 END) AS VIEW,
    COUNT(CASE WHEN resource_biz_type = ''OBJECT''  THEN 1 END) AS OBJECT
FROM ss_resource
WHERE resource_biz_type IN (''KG_DOC'',''KG_DB'',''KG_QA'',''VIEW'',''OBJECT'')  AND resource_status not in(1,6)
  AND (${catalog_id} < 0 OR catalog_id = ${catalog_id});', NULL, NULL, 'catalog_id', 1, '2026-01-23 09:20:03.825', '2026-01-23 09:20:03.825', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(23, 'DATASET_SKILLS', '数据资产指标-技能数量统计', 'SELECT
    COUNT(CASE WHEN type_group = ''AGENT''     THEN 1 END) AS AGENT,
    COUNT(CASE WHEN type_group = ''TOOLKIT''  THEN 1 END) AS TOOLKIT,
    COUNT(CASE WHEN type_group = ''未知类型'' THEN 1 END) AS 未知类型
FROM (
    SELECT
        COALESCE(
            CASE
                WHEN resource_biz_type = ''AGENT'' THEN ''AGENT''
                WHEN resource_biz_type IN (''TOOLKIT'', ''TOOL'', ''MCP'') THEN ''TOOLKIT''
            END,
            ''未知类型''
        ) AS type_group
    FROM ss_resource
    WHERE resource_biz_type IN (''AGENT'', ''TOOLKIT'', ''TOOL'', ''MCP'')  AND resource_status not in(1,6)
      AND parent_resource_id < 0
      AND (${catalog_id} < 0 OR catalog_id = ${catalog_id})
 AND system_code  = ${system_code}) AS temp;', NULL, NULL, 'catalog_id,system_code', 1, '2026-01-23 09:27:05.181', '2026-01-23 09:27:05.181', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(24, 'DATASET_DIG_EMPLOYEE', '数据资产指标-数字员工各类型数量统计', 'SELECT
    COUNT(CASE WHEN b.create_type = ''FROM_MANUALLY'' AND b.agent_type = ''001'' THEN 1 END) AS "001",
    COUNT(CASE WHEN b.create_type = ''FROM_MANUALLY'' AND b.agent_type = ''005'' THEN 1 END) AS "005",
    COUNT(CASE WHEN b.create_type = ''FROM_MANUALLY'' AND b.agent_type = ''006'' THEN 1 END) AS "006",
    COUNT(CASE WHEN b.create_type = ''FROM_THIRD'' THEN 1 END) AS third_party, COUNT(1) AS total
FROM ss_resource a
LEFT JOIN ss_res_ext_dig_employee b
    ON a.resource_id = b.resource_id
WHERE a.resource_biz_type = ''DIG_EMPLOYEE'' AND a.resource_status not in(1,6)
  AND (b.create_type = ''FROM_THIRD'' OR (b.create_type = ''FROM_MANUALLY'' AND b.agent_type IN (''001'',''005'',''006'')))
  AND (${catalog_id} < 0 OR a.catalog_id = ${catalog_id});', NULL, NULL, 'catalog_id', 1, '2026-01-23 09:32:16.457', '2026-01-23 09:32:16.457', NULL, NULL, NULL, 'DB', 'POSTGRESQL');

INSERT INTO query_config (query_id, query_code, "name", sql_template, dimension_fields, measure_fields, condition_fields, status, created_time, updated_time, created_by, description, query_type, query_method, db_type) VALUES(25, 'DATASET_DOC_TOP5_CATALOG', '数据资产指标-文档库调用量top5', 'WITH current_data AS (
    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        SUM(a.request_count) AS cur_cnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    WHERE a.mem_obj_type = ''DOC''
      AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
      AND a.create_time >= ${start_time}::TIMESTAMP
      AND a.create_time <= ${end_time}::TIMESTAMP
    GROUP BY b.resource_id, b.resource_name
),
previous_data AS (

    SELECT
        CAST(b.resource_id AS VARCHAR) AS resource_id,
        b.resource_name,
        SUM(a.request_count) AS pre_cnt
    FROM byai_session_member a
    INNER JOIN ss_resource b
        ON a.mem_obj_id = b.resource_id
    WHERE a.mem_obj_type = ''DOC'' AND b.resource_status not in(1,6)
      AND (${catalog_id} < 0 OR b.catalog_id = ${catalog_id})
      AND a.create_time >= CASE ${period_type}
          WHEN ''day'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${start_time}::TIMESTAMP - INTERVAL ''1 month''
      END
      AND a.create_time <= CASE ${period_type}
          WHEN ''day'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 day''
          WHEN ''week'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 week''
          WHEN ''month'' THEN ${end_time}::TIMESTAMP - INTERVAL ''1 month''
      END
    GROUP BY b.resource_id, b.resource_name
)

SELECT
    COALESCE(cd.resource_id, pd.resource_id) AS resource_id,
    COALESCE(cd.resource_name, pd.resource_name) AS resource_name,
    COALESCE(cd.cur_cnt, 0) AS current_count,
    COALESCE(pd.pre_cnt, 0) AS previous_count,
    CASE
        WHEN COALESCE(pd.pre_cnt, 0) = 0 THEN NULL
        ELSE ROUND((COALESCE(cd.cur_cnt, 0) - COALESCE(pd.pre_cnt, 0)) * 100.0 / pd.pre_cnt, 2)
    END AS growth_rate,
    CASE ${period_type}
        WHEN ''day'' THEN ''日环比''
        WHEN ''week'' THEN ''周环比''
        WHEN ''month'' THEN ''月环比''
    END AS period_type_name
FROM current_data cd
FULL OUTER JOIN previous_data pd
    ON cd.resource_id = pd.resource_id
    AND cd.resource_name = pd.resource_name
ORDER BY current_count DESC
LIMIT 5; ', NULL, NULL, 'catalog_id,start_time,end_time,period_type', 1, '2026-01-28 16:29:06.067', '2026-01-28 16:29:06.067', NULL, NULL, NULL, 'DB', 'POSTGRESQL');


INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (0, '其他领域', '无法归入以上分类', -1, 6, 1, '2099-10-31 23:00:00.000000', 7, '2025-12-03 21:08:01.277000', 1, '-1.0', 99);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (10, '平台能力', '百应揭榜挂帅和百应记忆引擎、知识引擎、决策引擎、插件引擎、业务门户、管理门户等提供通用能力', -1, 6, 1, '2025-11-07 23:00:00.000000', null, null, 1, '-1.10', 1);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (51, '行政办公', '管理固定资产、采购、各种IT服务相关数智资产和数智资源', -1, 6, 1, '2025-11-01 23:00:00.000000', 7, '2025-12-03 21:07:50.398000', 1, '-1.51', 8);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (52, '人力资源', '管理人力资源领域相关数智资产和数智资源，例如员工关系管理等', -1, 6, 1, '2025-11-03 23:00:00.000000', 7, '2025-12-03 21:07:27.670000', 1, '-1.52', 6);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (53, '研发领域', '管理产品研发、产品规划、产品质量等产品研发相关的数智资产和数智资源', -1, 6, 1, '2025-11-04 23:00:00.000000', 7, '2025-12-03 21:07:13.887000', 1, '-1.53', 4);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (54, '市场营销', '管理市场营销、客户交付相关的数智资产和数智资源', -1, 6, 1, '2025-11-05 23:00:00.000000', 7, '2025-12-03 21:06:56.538000', 1, '-1.54', 2);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (55, '销售领域', '管理销售线索、商机合同等销售领域相关的数智资产和数智资源', -1, 6, 1, '2025-11-06 23:00:00.000000', 7, '2025-12-03 21:07:04.510000', 1, '-1.55', 3);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (56, '交付领域', '管理项目交付、客户服务、项目运维等交付与服务领域相关的数智资产和数智资源', -1, 6, 1, '2025-11-07 23:00:00.000000', 7, '2025-12-03 21:07:21.898000', 1, '-1.56', 5);
INSERT INTO ss_resource_catalog (catalog_id, catalog_name, catalog_desc, p_catalog_id, catalog_type, create_by, create_time, update_by, update_time, com_acct_id, catalog_path, order_index) VALUES (57, '财务领域', '管理经营财务、市场财务、核算财务等财务相关数智资产和数智资源', -1, 6, 1, '2025-11-07 23:00:00.000000', 7, '2025-12-03 21:07:34.288000', 1, '-1.57', 7);

INSERT INTO po_source_system (po_external_system_id, system_code, system_name, sso_url, app_key, app_secret, get_token_url, refresh_token_url, create_time, create_user, com_acct_id, redirect_uri, enabled, user_info_url) VALUES (12, 'BYAI', '百应', null, null, null, null, null, '2025-06-06 20:08:18.000000', 1, 1, null, 'Y', null);
INSERT INTO po_source_system (po_external_system_id, system_code, system_name, sso_url, app_key, app_secret, get_token_url, refresh_token_url, create_time, create_user, com_acct_id, redirect_uri, enabled, user_info_url) VALUES (88, 'WHAGE_AGENT', '插件引擎', null, null, null, null, null, '2025-06-07 20:08:18.000000', 1, 1, null, 'Y', null);
INSERT INTO po_source_system (po_external_system_id, system_code, system_name, sso_url, app_key, app_secret, get_token_url, refresh_token_url, create_time, create_user, com_acct_id, redirect_uri, enabled, user_info_url) VALUES (100, 'OTHER', '其他', null, null, null, null, null, '2025-06-06 20:08:18.000000', 1, 1, null, 'Y', null);

delete from byai_ai_prompt where prompt_group_code in('DIG_EMPLOYEE_PROMPT');
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (1, 'DIG_EMPLOYEE_PROMPT', 'agentName', '智能体名称', '智能体名称', 'agentName', '你是一个智能体设计助手。请根据以下智能体信息生成一个专业的智能体名称：${description}要求：1. 符合专业背景 2. 体现服务态度 3. 10字以内', 'You are an agent design assistant. Please generate a professional agent name based on the following agent information: ${description}Requirements: 1. Match professional background 2. Reflect service attitude 3. Within 10 words', 1, '2025-11-01 11:42:01.437342', '2025-11-01 11:42:01.437342', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (2, 'DIG_EMPLOYEE_PROMPT', 'agentDescription', '智能体描述', '智能体描述', 'agentDescription', '你是一个智能体设计助手。请根据以下智能体信息生成一个专业的智能体描述：${description}要求：1. 符合专业背景 2. 体现服务态度 3. 50字以内', 'You are an agent design assistant. Please generate a professional agent description based on the following agent information: ${description}Requirements: 1. Match professional background 2. Reflect service attitude 3. Within 50 words', 1, '2025-11-01 11:42:01.810211', '2025-11-01 11:42:01.810211', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (4, 'DIG_EMPLOYEE_PROMPT', 'openingRemark', '开场白', '开场白', 'openingRemark', '你是一个智能体设计助手。请根据以下智能体信息生成一个友好的开场白，用于初次与用户交互：${description}要求：1. 包含自我介绍 2. 表达服务意愿 3. 30字以内', 'You are an agent design assistant. Please generate a friendly opening remark for initial user interaction based on the following agent information: ${description}Requirements: 1. Include self-introduction 2. Express service willingness 3. Within 30 words', 1, '2025-11-01 11:42:02.683154', '2025-11-01 11:42:02.683154', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (5, 'DIG_EMPLOYEE_PROMPT', 'commonQuestions', '常见问题', '常见问题', 'commonQuestions', e'你是一个智能体设计助手。请根据以下智能体信息列出3个用户最可能问的常见问题,要求如下：
1.严格使用JSON字符串数组格式返回,示例:["问题1","问题2","问题3"]
2.禁止编号,禁止出现换行符,禁止标点结尾,直接输出标准JSON数组返回
附智能体信息,如下：
${description}
请按照前面的要求直接返回输出JSON数组结果，不要输出其他多余东西', 'You are an agent design assistant. Please list the top 3 common questions users are most likely to ask based on the following agent information:${description}Format:1.Strictly use JSON array format: ["question1","question2","question3"]2.No numbering or ending punctuation in questions', 1, '2025-11-01 11:42:02.950015', '2025-11-01 11:42:02.950015', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (6, 'DIG_EMPLOYEE_PROMPT', 'recommendedQuestionPrompt', '对话问题推荐提示词', '对话问题推荐提示词', 'recommendedQuestionPrompt', '请为智能体生成一组用于指导AI生成追问类问题的提示词。# 智能体信息：${description}# 要求如下：- 这些提示词应能规范AI生成的问题必须与最近一轮回复内容紧密相关，并能引发进一步讨论。- 这些提示词应要求AI避免重复上文已经提问或回答过的问题。- 这些提示词应要求每句话只包含一个问题，也可以是具体的指令（不一定是问句）。- 这些提示词应要求AI只推荐其有能力回答的三个问题。- 输出为简明的分条提示语句，每条一句，适合直接作为AI的行为约束。请根据上述要求，生成一组用于指导AI生成追问类问题的提示词。', 'Please generate a set of prompts to guide the AI in generating follow-up questions.# Agent Information:${description}# Requirements:- These prompts should ensure that the AI''s generated questions are closely related to the most recent reply and can lead to further discussion.- These prompts should require the AI to avoid repeating questions or answers that have already been asked or answered above.- These prompts should require that each sentence contains only one question, or it can be a specific instruction (not necessarily a question).- These prompts should require the AI to recommend only three questions that it is capable of answering.- Output should be concise, with each prompt as a separate statement, suitable for directly constraining the AI''s behavior.Please generate a set of prompts according to the above requirements to guide the AI in generating follow-up questions.', 1, '2025-11-01 11:42:03.212601', '2025-11-01 11:42:03.212601', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (7, 'DIG_EMPLOYEE_PROMPT', 'agentTags', '智能体标签', '智能体标签', 'agentTags', e'你是一个智能体设计助手。请根据以下智能体信息生成适合的标签,要求如下：
1.生成3-5个标签
2.标签能准确描述智能体功能
3.输出标签JSON字符串数组结构的字符串,每个标签使用逗号分隔，例如:["标签1","标签2","标签3"]
附智能体信息,如下：
${description}
请按照前面的要求直接返回输出JSON数组结果，不要输出其他多余东西', 'You are an agent design assistant. Please generate appropriate tags based on the following agent information:**Agent Tags:**${description}**Generation Requirements:**1. Generate 3-5 tags2. Tags should accurately describe agent functions3. Output as a string array structure, with each tag separated by commas, for example: "[''tag1'',''tag2'',''tag3'']"', 1, '2025-11-01 11:42:03.551921', '2025-11-01 11:42:03.551921', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (8, 'DIG_EMPLOYEE_PROMPT', 'corePersonaDefinition', '人格定义', '人格定义', 'corePersonaDefinition', e'你是一个智能体设计助手。请根据以下智能体信息生成当前智能体的人格定义信息，要求如下:
1.根据给出智能体信息补充下面内容，1.我是谁 2.核心准则 3.边界 4.气质 5.连续性内容
2.定义格式如下:
#我是谁
我是你的xxx,写一段简介自己的内容

## 核心准则
这里补充自己的核心准则

## 边界
这里补充自己的边界能力

## 气质
这里补充自己谈吐气质

## 连续性
这里补充自己连续性内容

附智当前能体信息,如下:
${description}

请按照前面的要求格式直接返回输出文本结果，不要输出其他多余东西', 'You are an agent design assistant. Please generate a core ability description based on the following agent information:**Agent Information:**${description}**Generation Requirements:**1. List 3-5 core capabilities2. Each capability should be described concisely and clearly3. Highlight the agent''s professional strengths and distinctive features4. Within 200 words', 1, '2025-11-01 11:42:03.832222', '2025-11-01 11:42:03.832222', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (9, 'DIG_EMPLOYEE_PROMPT', 'faqs', '示例问法', '示例问法', 'faqs', e'你是一个智能体设计助手。请根据以下智能体信息生成示例问法，要求如下:
1.生成5-8个典型用户问题示例
2.问题应覆盖智能体的主要功能场景2. 问题应覆盖智能体的主要功能场景
3.问题表述自然口语化
4.输出标签JSON字符串数组结构的字符串,每个标签使用逗号分隔,例如:["问题1","问题2","问题3"]
附智能体信息,如下:
${description}
请按照前面的要求直接返回输出结果，不要输出其他多余东西', 'You are an agent design assistant. Please generate example questions based on the following agent information:**Agent Information:**${description}**Generation Requirements:**1. Generate 5-8 typical user question examples2. Questions should cover the agent''s main functional scenarios3. Questions should be naturally conversational4. Strictly use JSON array format: ["question1","question2","question3"]', 1, '2025-11-01 11:42:04.505584', '2025-11-01 11:42:04.505584', null);
INSERT INTO byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code) VALUES (10, 'DIG_EMPLOYEE_PROMPT', 'coreCompetencies', '核心能力', '核心能力', 'coreCompetencies', e'你是一个智能体设计助手。请根据以下智能体信息生成当前智能体的核心能力和拒绝能力边界，要求如下:
1.生成3-5组核心能力和边界组
2.coreCompetency为核心能力名称,description为核心能力描述,acceptBoundary为能力边界,rejectBoundary为拒绝能力边界,example为能力示例
2.问题应覆盖智能体的主要功能场景
3.问题表述自然口语化
4.输出标签JSON字符串数组结构的字符串,每组能力用逗号分隔,参考智能体:网球电子教练的格式，例如:
[{
	"coreCompetency": "网球技术指导",
	"description": "提供网球基本技术指导，包括正手、反手、发球、截击等动作要领讲解与训练建议。",
	"acceptBoundary": ["正手击球动作分析与改进", "反手击球动作优化", "发球技巧与训练方法", "截击和高压球技术指导", "步伐移动与站位建议"],
	"rejectBoundary": ["不提供比赛心理辅导", "不涉及专业体能训练计划"],
	"example": ["我的正手动作哪里不对？", "如何提高发球速度？", "截击球应该注意什么？", "双打站位有哪些技巧？"]
}, {
	"coreCompetency": "战术策略分析",
	"description": "根据对手特点和比赛情况，提供基础战术建议和应对策略，提升实战能力。",
	"acceptBoundary": ["单打基础战术建议", "双打配合策略", "针对不同场地的比赛策略", "应对不同打法的战术调整", "关键分处理技巧"],
	"rejectBoundary": ["不提供专业赛事数据分析", "不涉及职业比赛备战策略"],
	"example": ["我该怎么对付快攻型选手？", "红土场地上如何调整战术？", "双打如何配合更默契？", "关键分怎么打更稳妥？"]
}, {
	"coreCompetency": "训练计划制定",
	"description": "根据用户水平和目标，制定个性化训练计划，涵盖技术、体能和实战训练内容。",
	"acceptBoundary": ["初学者入门训练计划", "进阶选手提升计划", "专项技术强化训练", "周期性训练安排建议", "自我训练方法指导"],
	"rejectBoundary": ["不提供职业运动员定制计划", "不涉及康复性训练方案"],
	"example": ["我该怎么开始网球训练？", "一个月如何提升反手能力？", "如何安排每周训练内容？", "有哪些有效的发球训练方法？"]
}]

附智当前能体信息,如下:
${description}

请按照前面的要求直接返回输出JSON数组结果，不要输出其他多余东西', 'You are an agent design assistant. Please define personality dimensions based on the following agent information:**Agent Information:**${description}**Generation Requirements:**1. Describe the agent''s personality traits (e.g., professional, friendly, rigorous)2. Explain its emotional expression style3. Define its interaction style4. Within 150 words', 1, '2025-11-01 11:42:04.789458', '2025-11-01 11:42:04.789458', null);


delete from byai.byai_system_config_list where param_group_code in('TEMPLATE_PERSONAL_ASSISTANT');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_PERSONAL_ASSISTANT', '数字员工模板设置-个人助手', '工作规范', 'agent', '{"priorityPrompt": "", "sourceFields": [{ "prologue.descText": "生成 Greeting" }, { "resourceDesc": "生成 Capabilities overview" }, { "coreCompetencies": "生成 Core competencies" }, { "corePersonaDefinition": "生成百应业务拓展摘要" }, { "relResourceInfoList": "生成 Associated resources" }, { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }]}', '工作规范', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_PERSONAL_ASSISTANT', '数字员工模板设置-个人助手', '人格定义', 'soul', '{"priorityPrompt":"","sourceFields":[{"prologue.descText":"生成 Greeting"},{"resourceDesc":"生成 Capabilities overview"},{"coreCompetencies":"生成 Core competencies"},{"corePersonaDefinition":"生成百应业务拓展摘要"},{"relResourceInfoList":"生成 Associated resources"},{"relResourceList":"relResourceInfoList 缺失时作为关联资源兜底"}]}', '人格定义', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_PERSONAL_ASSISTANT', '数字员工模板设置-个人助手', '工具规范', 'tools', '{"priorityPrompt":"","sourceFields":[{"resourceId":"生成 DOC 类资源调用所需 agent_id 兜底"},{"relResourceInfoList":"生成 Available resources"},{"relResourceList":"relResourceInfoList 缺失时作为资源列表兜底"},{"resourceName":"生成资源展示名称"},{"resourceBizType":"生成资源类型，优先于 resourceType"},{"resourceType":"生成资源类型兜底"},{"resourceCode":"生成资源 code"},{"resourceDesc":"生成资源描述"}]}', '工具规范', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_PERSONAL_ASSISTANT', '数字员工模板设置-个人助手', '记忆规范', 'memory', '', '记忆规范', 4);

delete from byai.byai_system_config_list where param_group_code in('TEMPLATE_GENERAL_QUESTIONS_ANSWERS');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS', '数字员工模板设置-综合问答', '问题改写', 'rewrite', '', '问题改写', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS', '数字员工模板设置-综合问答', '问题分解', 'split', '', '问题分解', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS', '数字员工模板设置-综合问答', '单条总结', 'single-summary', '', '单条总结', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS', '数字员工模板设置-综合问答', '多条总结', 'multi-summary', '', '多条总结', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_GENERAL_QUESTIONS_ANSWERS', '数字员工模板设置-综合问答', '综合回答', 'answer', '', '综合回答', 5);

delete from byai.byai_system_config_list where param_group_code in('TEMPLATE_DEFAULT_OTHER');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'TEMPLATE_DEFAULT_OTHER', '数字员工模板设置-其他', '工作规范', 'agent', '', '工作规范', 1);


delete from byai.byai_system_config_list where param_group_code in('ACCESSTERMINAL');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'ACCESSTERMINAL', '来源终端类型', 'APP端', 'APP', 'APP', 'APP移动端', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'ACCESSTERMINAL', '来源终端类型', 'Electron端', 'ELECTRON', 'Electron', 'Electron端', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'ACCESSTERMINAL', '来源终端类型', '钉钉端', 'DINGDING', 'DingDing', '钉钉端', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'ACCESSTERMINAL', '来源终端类型', 'Wx微信端', 'WX', 'Wx', '微信端', 5);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'ACCESSTERMINAL', '来源终端类型', 'web端', 'WEB', 'Web', 'web端', 1);

delete from byai.byai_system_config_list where param_group_code in('FEEDBACK');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'FEEDBACK', 'Feedback Type', 'Inaccurate Answer', 'ANS_INACCURATE', 'ANS_INACCURATE', '未解决问题答案不准确（界面反馈展示用，约定人张志豪）', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'FEEDBACK', 'Feedback Type', 'Wrong Person', 'WRONG_PERSON', 'WRONG_PERSON', '未解决问题找错人（界面反馈展示用，约定人张志豪）', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'FEEDBACK', 'Feedback Type', 'Others', 'FEED_OTHER', 'FEED_OTHER', '未解决问题其他（界面反馈展示用，约定人张志豪）', 3);


delete from byai.byai_system_config_list where param_group_code in('DIG_EMPLOYEE_AGENT_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型', '助手', 'Assistant', '001', '助手', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型', '问答', 'QA', '006', '问答', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型', '问数', 'DataQuery', '005', '问数', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型', '调试', 'Debug', '010', '调试', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_AGENT_TYPE', '数字员工类型', '编码', 'Coding', '011', '编码', 5);

delete from byai.byai_system_config_list where param_group_name in('MENU_ICON_SHOW_TAB');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '工具', 'Tool', 'true', '工具', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '知识', 'Knowledge', 'true', '知识', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '视图', 'View', 'true', '视图', 5);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '对象', 'Object', 'true', '对象', 6);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '会话', 'Session', 'true', '会话', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'MENU_ICON_SHOW_TAB', '菜单图标显示', '员工', 'Employees', 'true', '员工', 2);

delete from byai.byai_system_config_list where param_group_code in('SYSTEM_MODEL_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'SYSTEM_MODEL_TYPE', '模型类型', '大语言模型（LLM）', 'LLM', 'LLM', '大语言模型（LLM）', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'SYSTEM_MODEL_TYPE', '模型类型', '重排模型（RERANK）', 'RERANK', 'RERANK', '重排模型（RERANK）', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'SYSTEM_MODEL_TYPE', '模型类型', '向量模型（EMBEDDING）', 'EMBEDDING', 'EMBEDDING', '向量模型（EMBEDDING）', 3);

delete from byai.byai_system_config where param_code in('BYAI_BRAND_VERSION');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10001781, null, 'BYAI_BRAND_VERSION', '百应商标版信息', 'BYAI_BRAND_VERSION', 'openSource', '百应商标版本，商用:commercial,开源:openSource');

delete from byai.byai_system_config_list where param_group_code in('DIG_EMPLOYEE_FILE_UPLOAD_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'doc', 'doc', '.doc', 'doc', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'docx', 'docx', '.docx', 'docx', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'xls', 'xls', '.xls', 'xls', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'png', 'png', '.png', 'png', 10);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'md', 'md', '.md', 'md', 8);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'pdf', 'pdf', '.pdf', 'pdf', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'ppt', 'ppt', '.ppt', 'ppt', 6);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'txt', 'txt', '.txt', 'txt', 9);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'csv', 'csv', '.csv', 'csv', 7);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'xlsx', 'xlsx', '.xlsx', 'xlsx', 5);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'zip', 'zip', '.zip', 'zip', 12);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE', '数字员工文件上传类型配置', 'jpeg', 'jpeg', '.jpeg', 'jpeg', 11);

INSERT INTO byai.po_enterprise_info (enterprise_id, com_acct_name, com_acct_code, system_name, com_acct_address, logo_data, copyright, demo_switch, project_switch) VALUES (1, '浩鲸云科技股份有限公司', 'iwhale', '浩鲸云科技股份有限公司', '广州市番禺区大石街石北路644号巨大创意产业园19栋301-308', '', null, '0', '0');
