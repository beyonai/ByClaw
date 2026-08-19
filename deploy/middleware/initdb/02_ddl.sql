-- byai 模式完整建表语句（DDL）

-- ========== 序列 ==========
CREATE SEQUENCE IF NOT EXISTS byai.seq_any_table;
CREATE SEQUENCE IF NOT EXISTS byai.ss_resource_rel_detail_resource_rel_detail_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.byai_message_relobj_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_record_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_resize_record_id_seq;

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
CREATE TABLE byai.sandbox_service_spec (service_key character varying(128) NOT NULL, spec_json text NOT NULL, template_json text, service_type character varying(128), display_name character varying(128), enabled integer DEFAULT 1, default_profile_key character varying(64), autoscale_enabled integer DEFAULT 0, updated_at timestamp without time zone DEFAULT pg_systimestamp());
CREATE TABLE byai.sandbox_service_profile (id bigint NOT NULL DEFAULT nextval('byai.seq_any_table'::regclass), service_type character varying(128) NOT NULL, profile_key character varying(64) NOT NULL, resource_requests jsonb, resource_limits jsonb, template_patch_json jsonb, resize_enabled integer DEFAULT 0, resize_strategy character varying(32) DEFAULT 'IN_PLACE'::character varying, enabled integer DEFAULT 1, sort_order integer DEFAULT 0, updated_at timestamp without time zone DEFAULT pg_systimestamp());
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
CREATE TABLE byai.ss_sandbox_record (id bigint NOT NULL DEFAULT nextval('byai.ss_sandbox_record_id_seq'::regclass), resource_id bigint NOT NULL, user_code character varying(500) NOT NULL, sandbox_type character varying(500) NOT NULL, service_type character varying(128), profile_key character varying(64), resource_requests jsonb, resource_limits jsonb, endpoint character varying(3000), sandbox_id character varying(128), chat_id character varying(128), status character varying(32) NOT NULL DEFAULT 'RUNNING'::character varying, auto_release integer DEFAULT 1, lease_policy character varying(32) DEFAULT 'REMOTE_AUTO_EXPIRE'::character varying, timeout_seconds integer, remote_expires_at timestamp(6) without time zone, last_renew_at timestamp(6) without time zone, next_renew_at timestamp(6) without time zone, last_access_time timestamp(6) without time zone, release_time timestamp(6) without time zone, release_reason text, resize_status character varying(32), last_resize_at timestamp(6) without time zone, last_resize_reason text, last_resize_duration_ms bigint, last_resize_success integer, last_resize_from_profile character varying(64), last_resize_to_profile character varying(64), last_resize_error text, version integer DEFAULT 0, create_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp(), update_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp());
CREATE TABLE byai.ss_sandbox_resize_record (id bigint NOT NULL DEFAULT nextval('byai.ss_sandbox_resize_record_id_seq'::regclass), sandbox_record_id bigint NOT NULL, sandbox_id character varying(128), user_code character varying(500) NOT NULL, service_type character varying(128), from_profile_key character varying(64), to_profile_key character varying(64), from_resource_requests jsonb, from_resource_limits jsonb, to_resource_requests jsonb, to_resource_limits jsonb, trigger_source character varying(64), reason_code character varying(128), reason_detail text, resize_type character varying(32), idempotency_key character varying(512), status character varying(32) NOT NULL DEFAULT 'REQUESTED'::character varying, success integer, started_at timestamp(6) without time zone, finished_at timestamp(6) without time zone, duration_ms bigint, opensandbox_request_id character varying(128), opensandbox_response jsonb, error_message text, skip_reason text, create_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp(), update_time timestamp(6) without time zone NOT NULL DEFAULT pg_systimestamp());
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
CREATE UNIQUE INDEX ux_sandbox_service_profile_type_key ON byai.sandbox_service_profile USING btree (service_type, profile_key) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_resize_record_record ON byai.ss_sandbox_resize_record USING btree (sandbox_record_id, started_at DESC) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_resize_record_user ON byai.ss_sandbox_resize_record USING btree (user_code, started_at DESC) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_resize_record_sandbox ON byai.ss_sandbox_resize_record USING btree (sandbox_id) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_resize_record_status ON byai.ss_sandbox_resize_record USING btree (status, started_at) TABLESPACE pg_default;
CREATE INDEX idx_ss_sandbox_resize_record_idempotency ON byai.ss_sandbox_resize_record USING btree (idempotency_key, started_at DESC) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_resid_status ON byai.ss_resource_artifact (resource_id, status_cd);
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_biztype_status ON byai.ss_resource_artifact (resource_biz_type, status_cd);
CREATE INDEX IF NOT EXISTS idx_ss_res_artifact_path_status ON byai.ss_resource_artifact (artifact_path, status_cd);
CREATE UNIQUE INDEX IF NOT EXISTS uk_ss_res_artifact_unique_active ON byai.ss_resource_artifact (resource_id, artifact_type, artifact_path, status_cd);

-- ========== 约束 ==========
ALTER TABLE byai.byai_message ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_message_relobj ADD PRIMARY KEY (id);
ALTER TABLE byai.sandbox_service_spec ADD PRIMARY KEY (service_key);
ALTER TABLE byai.sandbox_service_profile ADD PRIMARY KEY (id);
ALTER TABLE byai.sandbox_type_definitions ADD PRIMARY KEY (type_key);
ALTER TABLE byai.ss_resource_syn ADD PRIMARY KEY (syn_id);
ALTER TABLE byai.ss_sandbox_record ADD PRIMARY KEY (id);
ALTER TABLE byai.ss_sandbox_resize_record ADD PRIMARY KEY (id);

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
COMMENT ON COLUMN byai.ss_sandbox_record.service_type IS '沙箱服务类型，例如 openclaw';
COMMENT ON COLUMN byai.ss_sandbox_record.profile_key IS '沙箱资源规格分层，例如 xs/s/m/l';
COMMENT ON COLUMN byai.ss_sandbox_record.resource_requests IS '当前沙箱资源 requests JSON';
COMMENT ON COLUMN byai.ss_sandbox_record.resource_limits IS '当前沙箱资源 limits JSON';
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
COMMENT ON COLUMN byai.ss_sandbox_record.resize_status IS '最近一次动态扩缩容状态';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_at IS '最近一次动态扩缩容时间';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_reason IS '最近一次动态扩缩容原因';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_duration_ms IS '最近一次动态扩缩容耗时毫秒';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_success IS '最近一次动态扩缩容是否成功：1-成功，0-失败';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_from_profile IS '最近一次动态扩缩容来源规格';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_to_profile IS '最近一次动态扩缩容目标规格';
COMMENT ON COLUMN byai.ss_sandbox_record.last_resize_error IS '最近一次动态扩缩容错误信息';
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
SELECT setval('byai.ss_sandbox_resize_record_id_seq', 512, True);

-- ========== V0.0.1 (merged at 2026-05-21 09:56:18) ==========
ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN lock_version integer DEFAULT 0 NOT NULL;
COMMENT ON COLUMN byai.ss_sandbox_record.version IS '业务生命周期版本号';
COMMENT ON COLUMN byai.ss_sandbox_record.lock_version IS '乐观锁版本号';
ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN gateway_token character varying(128);
COMMENT ON COLUMN byai.ss_sandbox_record.gateway_token IS '绑定到沙箱实例的网关访问token';

-- ========== V0.1.0 (merged at 2026-07-06 10:27:58) ==========
DROP TABLE IF EXISTS byai.bykc_ec_import_record CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_artifact_signal CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_artifact CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_sync_run_step CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_sync_run CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_sync_task CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_connection CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_collector_agent CASCADE;


DROP TABLE IF EXISTS byai.bykc_ec_connector CASCADE;



CREATE TABLE IF NOT EXISTS byai.bykc_ec_collector_agent (
                                                            agent_id BIGINT PRIMARY KEY,
                                                            user_id BIGINT NOT NULL,
                                                            agent_name VARCHAR(128) NOT NULL,
    runtime_name VARCHAR(64) NOT NULL DEFAULT 'ByClaw Browser Bridge',
    runtime_version VARCHAR(64),
    browser_bridge_status VARCHAR(32),
    chrome_profile VARCHAR(128),
    site_sessions JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
    last_heartbeat_time TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_connection (
                                                       connection_id BIGINT PRIMARY KEY,
                                                       connector_code VARCHAR(64) NOT NULL,
    owner_type VARCHAR(32) NOT NULL DEFAULT 'PERSONAL',
    auth_type VARCHAR(32) NOT NULL,
    connection_name VARCHAR(128) NOT NULL,
    run_location VARCHAR(32) NOT NULL,
    credential_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    runtime_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    site_sessions JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    last_check_time TIMESTAMP WITH TIME ZONE,
    created_by BIGINT NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_task (
                                                      task_id BIGINT PRIMARY KEY,
                                                      task_name VARCHAR(255) NOT NULL,
    connector_code VARCHAR(64) NOT NULL,
    connection_id BIGINT,
    owner_type VARCHAR(32) NOT NULL DEFAULT 'PERSONAL',
    run_location VARCHAR(32) NOT NULL,
    source_url VARCHAR(2048),
    scope_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    target_type VARCHAR(64) NOT NULL,
    target_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    signal_config JSONB NOT NULL DEFAULT CAST('[]' AS JSONB),
    schedule_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    schedule_config JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    next_run_time TIMESTAMP WITH TIME ZONE,
    last_scheduled_run_time TIMESTAMP WITH TIME ZONE,
                                          options JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    created_by BIGINT NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_run (
                                                     run_id BIGINT PRIMARY KEY,
                                                     task_id BIGINT NOT NULL,
                                                     trigger_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    status VARCHAR(32) NOT NULL,
    current_step VARCHAR(64),
    total_count INTEGER NOT NULL DEFAULT 0,
    markdown_count INTEGER NOT NULL DEFAULT 0,
    asset_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    need_action_type VARCHAR(64),
    need_action_payload JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    storage_path VARCHAR(1024),
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_sync_run_step (
                                                          step_id BIGINT PRIMARY KEY,
                                                          run_id BIGINT NOT NULL,
                                                          step_code VARCHAR(64) NOT NULL,
    step_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    message VARCHAR(2048),
    step_order INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_artifact (
                                                     artifact_id BIGINT PRIMARY KEY,
                                                     run_id BIGINT NOT NULL,
                                                     artifact_type VARCHAR(32),
    artifact_name VARCHAR(512),
    source_url VARCHAR(2048),
    title VARCHAR(512),
    markdown_path VARCHAR(1024),
    raw_path VARCHAR(1024),
    asset_dir VARCHAR(1024),
    manifest_path VARCHAR(1024),
    item_count INTEGER NOT NULL DEFAULT 0,
    file_id BIGINT,
    file_url VARCHAR(2048),
    content_type VARCHAR(128),
    file_system_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_artifact_signal (
                                                            signal_id BIGINT PRIMARY KEY,
                                                            artifact_id BIGINT,
                                                            run_id BIGINT NOT NULL,
                                                            signal_type VARCHAR(64) NOT NULL,
    signal_type_name VARCHAR(128),
    signal_code VARCHAR(128) NOT NULL,
    signal_name VARCHAR(255) NOT NULL,
    confidence NUMERIC(5, 4),
    signal_source VARCHAR(32) NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE TABLE IF NOT EXISTS byai.bykc_ec_import_record (
                                                          import_id BIGINT PRIMARY KEY,
                                                          run_id BIGINT NOT NULL,
                                                          artifact_id BIGINT,
                                                          target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128),
    target_path VARCHAR(1024),
    status VARCHAR(32) NOT NULL,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );



CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_task_created_by ON byai.bykc_ec_sync_task (created_by);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_connection_created_by ON byai.bykc_ec_connection (created_by);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_connection_connector ON byai.bykc_ec_connection (connector_code);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_task_next_run_time ON byai.bykc_ec_sync_task (status, next_run_time);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_run_task_id ON byai.bykc_ec_sync_run (task_id);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_sync_run_step_run_id ON byai.bykc_ec_sync_run_step (run_id);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_artifact_run_id ON byai.bykc_ec_artifact (run_id);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_artifact_signal_run_id ON byai.bykc_ec_artifact_signal (run_id);


CREATE INDEX IF NOT EXISTS idx_bykc_ec_import_record_run_id ON byai.bykc_ec_import_record (run_id);



COMMENT ON TABLE byai.bykc_ec_collector_agent IS 'ByKC Browser Bridge连接状态表';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.agent_id IS 'Browser Bridge客户端主键';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.user_id IS '所属用户ID';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.agent_name IS 'Browser Bridge客户端名称';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.runtime_name IS 'Browser Bridge运行时名称';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.runtime_version IS 'Browser Bridge版本';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.browser_bridge_status IS 'Browser Bridge连接状态';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.chrome_profile IS '绑定的浏览器Profile标识';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.site_sessions IS 'Browser Bridge上报的目标站点登录态列表，JSON数组';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.status IS 'Browser Bridge在线状态，ONLINE在线，OFFLINE离线';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.last_heartbeat_time IS '最近一次心跳时间';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.create_time IS '创建时间';


COMMENT ON COLUMN byai.bykc_ec_collector_agent.update_time IS '更新时间';



COMMENT ON TABLE byai.bykc_ec_connection IS 'ByKC生态采集用户连接配置表';


COMMENT ON COLUMN byai.bykc_ec_connection.connection_id IS '用户连接主键';


COMMENT ON COLUMN byai.bykc_ec_connection.connector_code IS '运行时生态能力编码，来自OpenCLI manifest或ByClaw Browser Bridge虚拟能力';


COMMENT ON COLUMN byai.bykc_ec_connection.owner_type IS '连接归属类型，PERSONAL个人，ENTERPRISE企业';


COMMENT ON COLUMN byai.bykc_ec_connection.auth_type IS '认证方式，例如BROWSER、TOKEN、OAUTH、IMAP、PUBLIC_URL';


COMMENT ON COLUMN byai.bykc_ec_connection.connection_name IS '用户连接名称';


COMMENT ON COLUMN byai.bykc_ec_connection.run_location IS '连接运行位置，LOCAL用户浏览器桥接侧，SERVER平台侧';


COMMENT ON COLUMN byai.bykc_ec_connection.credential_config IS '连接凭证配置，JSON结构，敏感信息不在查询接口明文返回';


COMMENT ON COLUMN byai.bykc_ec_connection.runtime_config IS '连接运行配置，JSON结构，例如Browser Bridge绑定信息或OpenCLI运行参数';


COMMENT ON COLUMN byai.bykc_ec_connection.site_sessions IS 'Browser Bridge上报的站点登录态状态，JSON数组';


COMMENT ON COLUMN byai.bykc_ec_connection.status IS '连接状态，例如CREATED、READY、NEED_AUTH、FAILED';


COMMENT ON COLUMN byai.bykc_ec_connection.last_check_time IS '最近一次连接检测时间';


COMMENT ON COLUMN byai.bykc_ec_connection.created_by IS '创建用户ID';


COMMENT ON COLUMN byai.bykc_ec_connection.create_time IS '创建时间';


COMMENT ON COLUMN byai.bykc_ec_connection.update_time IS '更新时间';



COMMENT ON TABLE byai.bykc_ec_sync_task IS 'ByKC生态采集同步任务表';


COMMENT ON COLUMN byai.bykc_ec_sync_task.task_id IS '采集任务主键';


COMMENT ON COLUMN byai.bykc_ec_sync_task.task_name IS '采集任务名称';


COMMENT ON COLUMN byai.bykc_ec_sync_task.connector_code IS '运行时生态能力编码';


COMMENT ON COLUMN byai.bykc_ec_sync_task.connection_id IS '用户连接ID，P1连接管理使用';


COMMENT ON COLUMN byai.bykc_ec_sync_task.owner_type IS '任务归属类型，personal个人，enterprise企业';


COMMENT ON COLUMN byai.bykc_ec_sync_task.run_location IS '任务运行位置，LOCAL用户浏览器桥接侧，SERVER平台侧';


COMMENT ON COLUMN byai.bykc_ec_sync_task.source_url IS '采集来源链接';


COMMENT ON COLUMN byai.bykc_ec_sync_task.scope_config IS '采集范围配置，JSON结构';


COMMENT ON COLUMN byai.bykc_ec_sync_task.target_type IS '入库目标类型，例如knowledgeBase、space';


COMMENT ON COLUMN byai.bykc_ec_sync_task.target_config IS '入库目标配置，JSON结构';


COMMENT ON COLUMN byai.bykc_ec_sync_task.signal_config IS '任务级信号配置，JSON数组';


COMMENT ON COLUMN byai.bykc_ec_sync_task.schedule_type IS '调度类型，例如manual手动、once单次、daily每天、weekly每周';


COMMENT ON COLUMN byai.bykc_ec_sync_task.schedule_config IS '调度配置，JSON结构';


COMMENT ON COLUMN byai.bykc_ec_sync_task.next_run_time IS '下一次计划运行时间';


COMMENT ON COLUMN byai.bykc_ec_sync_task.last_scheduled_run_time IS '最近一次计划调度运行时间';


COMMENT ON COLUMN byai.bykc_ec_sync_task.options IS '采集高级选项，JSON结构';


COMMENT ON COLUMN byai.bykc_ec_sync_task.status IS '任务状态，例如CREATED已创建、RUNNING运行中、SUCCESS成功、FAILED失败、DISABLED停用、ARCHIVED归档';


COMMENT ON COLUMN byai.bykc_ec_sync_task.created_by IS '创建用户ID';


COMMENT ON COLUMN byai.bykc_ec_sync_task.create_time IS '创建时间';


COMMENT ON COLUMN byai.bykc_ec_sync_task.update_time IS '更新时间';



COMMENT ON TABLE byai.bykc_ec_sync_run IS 'ByKC生态采集运行记录表';


COMMENT ON COLUMN byai.bykc_ec_sync_run.run_id IS '采集运行主键';


COMMENT ON COLUMN byai.bykc_ec_sync_run.task_id IS '所属采集任务ID';


COMMENT ON COLUMN byai.bykc_ec_sync_run.trigger_type IS '触发方式，例如MANUAL手动、SCHEDULED计划调度、RETRY重试、SKILL技能入口、CHAT聊天入口';


COMMENT ON COLUMN byai.bykc_ec_sync_run.status IS '运行状态，例如SUCCESS成功、FAILED失败、RUNNING运行中、SKIPPED已跳过';


COMMENT ON COLUMN byai.bykc_ec_sync_run.current_step IS '当前运行步骤编码';


COMMENT ON COLUMN byai.bykc_ec_sync_run.total_count IS '采集条目总数';


COMMENT ON COLUMN byai.bykc_ec_sync_run.markdown_count IS '生成Markdown文件数量';


COMMENT ON COLUMN byai.bykc_ec_sync_run.asset_count IS '归档附件数量';


COMMENT ON COLUMN byai.bykc_ec_sync_run.failed_count IS '失败条目数量';


COMMENT ON COLUMN byai.bykc_ec_sync_run.need_action_type IS '需要用户处理的动作类型，例如BROWSER_BRIDGE、USER_BROWSER_BRIDGE_WAITING';


COMMENT ON COLUMN byai.bykc_ec_sync_run.need_action_payload IS '需要用户处理的动作详情，JSON结构';


COMMENT ON COLUMN byai.bykc_ec_sync_run.storage_path IS '本次采集产物对象存储基础路径';


COMMENT ON COLUMN byai.bykc_ec_sync_run.started_at IS '运行开始时间';


COMMENT ON COLUMN byai.bykc_ec_sync_run.finished_at IS '运行结束时间';


COMMENT ON COLUMN byai.bykc_ec_sync_run.create_time IS '创建时间';



COMMENT ON TABLE byai.bykc_ec_sync_run_step IS 'ByKC生态采集运行步骤表';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_id IS '运行步骤主键';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.run_id IS '所属采集运行ID';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_code IS '步骤编码';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_name IS '步骤名称';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.status IS '步骤状态，例如SUCCESS、FAILED、SKIPPED、CREATED';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.message IS '步骤执行说明';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.step_order IS '步骤排序';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.started_at IS '步骤开始时间';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.finished_at IS '步骤结束时间';


COMMENT ON COLUMN byai.bykc_ec_sync_run_step.create_time IS '创建时间';



COMMENT ON TABLE byai.bykc_ec_artifact IS 'ByKC生态采集产物表';


COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_id IS '采集产物主键';


COMMENT ON COLUMN byai.bykc_ec_artifact.run_id IS '所属采集运行ID';


COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_type IS '产物类型，例如MARKDOWN、RAW、ASSET、MANIFEST';


COMMENT ON COLUMN byai.bykc_ec_artifact.artifact_name IS '产物名称';


COMMENT ON COLUMN byai.bykc_ec_artifact.source_url IS '来源站点链接';


COMMENT ON COLUMN byai.bykc_ec_artifact.title IS '来源内容标题';


COMMENT ON COLUMN byai.bykc_ec_artifact.markdown_path IS 'Markdown产物存储路径';


COMMENT ON COLUMN byai.bykc_ec_artifact.raw_path IS '原始数据产物存储路径';


COMMENT ON COLUMN byai.bykc_ec_artifact.asset_dir IS '附件资产存储路径';


COMMENT ON COLUMN byai.bykc_ec_artifact.manifest_path IS 'manifest清单存储路径';


COMMENT ON COLUMN byai.bykc_ec_artifact.item_count IS '产物包含的条目数量';


COMMENT ON COLUMN byai.bykc_ec_artifact.file_id IS '关联byai_files文件ID';


COMMENT ON COLUMN byai.bykc_ec_artifact.file_url IS '对象存储文件访问地址';


COMMENT ON COLUMN byai.bykc_ec_artifact.content_type IS '文件MIME类型';


COMMENT ON COLUMN byai.bykc_ec_artifact.file_system_type IS '文件存储系统类型，例如minio、local、sftp';


COMMENT ON COLUMN byai.bykc_ec_artifact.status IS '产物状态，例如CREATED、SUCCESS、FAILED';


COMMENT ON COLUMN byai.bykc_ec_artifact.create_time IS '创建时间';



COMMENT ON TABLE byai.bykc_ec_artifact_signal IS 'ByKC生态采集产物信号表';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_id IS '信号记录主键';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.artifact_id IS '关联采集产物ID';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.run_id IS '所属采集运行ID';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_type IS '信号类型编码，例如source、object、topic、privacy';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_type_name IS '信号类型名称';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_code IS '信号编码';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_name IS '信号名称';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.confidence IS '信号置信度，0到1';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.signal_source IS '信号来源，例如connector、user、rule、model';


COMMENT ON COLUMN byai.bykc_ec_artifact_signal.create_time IS '创建时间';



COMMENT ON TABLE byai.bykc_ec_import_record IS 'ByKC生态采集入库记录表';


COMMENT ON COLUMN byai.bykc_ec_import_record.import_id IS '入库记录主键';


COMMENT ON COLUMN byai.bykc_ec_import_record.run_id IS '所属采集运行ID';


COMMENT ON COLUMN byai.bykc_ec_import_record.artifact_id IS '关联采集产物ID';


COMMENT ON COLUMN byai.bykc_ec_import_record.target_type IS '入库目标类型，例如knowledgeBase、space';


COMMENT ON COLUMN byai.bykc_ec_import_record.target_id IS '入库目标ID或目标名称';


COMMENT ON COLUMN byai.bykc_ec_import_record.target_path IS '入库目标路径';


COMMENT ON COLUMN byai.bykc_ec_import_record.status IS '入库状态，例如SUCCESS、FAILED、SKIPPED';


COMMENT ON COLUMN byai.bykc_ec_import_record.create_time IS '创建时间';

-- ========== V0.1.1 (merged at 2026-07-06 10:27:58) ==========
CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_resize_record_id_seq;



CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;



SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'service_type', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'display_name', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'enabled', 'INTEGER DEFAULT 1');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'default_profile_key', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'autoscale_enabled', 'INTEGER DEFAULT 0');



CREATE TABLE IF NOT EXISTS byai.sandbox_service_profile (
    id BIGINT NOT NULL DEFAULT nextval('byai.seq_any_table'::regclass),
    service_type VARCHAR(128) NOT NULL,
    profile_key VARCHAR(64) NOT NULL,
    resource_requests JSONB,
    resource_limits JSONB,
    template_patch_json JSONB,
    resize_enabled INTEGER DEFAULT 0,
    resize_strategy VARCHAR(32) DEFAULT 'IN_PLACE',
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT pg_systimestamp(),
    CONSTRAINT pk_sandbox_service_profile PRIMARY KEY (id)
);



CREATE UNIQUE INDEX IF NOT EXISTS ux_sandbox_service_profile_type_key
    ON byai.sandbox_service_profile (service_type, profile_key);



SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'service_type', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'profile_key', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resource_requests', 'JSONB');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resource_limits', 'JSONB');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resize_status', 'VARCHAR(32)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_at', 'TIMESTAMP(6) WITHOUT TIME ZONE');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_reason', 'TEXT');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_duration_ms', 'BIGINT');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_success', 'INTEGER');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_from_profile', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_to_profile', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_error', 'TEXT');



CREATE TABLE IF NOT EXISTS byai.ss_sandbox_resize_record (
    id BIGINT NOT NULL DEFAULT nextval('byai.ss_sandbox_resize_record_id_seq'::regclass),
    sandbox_record_id BIGINT NOT NULL,
    sandbox_id VARCHAR(128),
    user_code VARCHAR(500) NOT NULL,
    service_type VARCHAR(128),
    from_profile_key VARCHAR(64),
    to_profile_key VARCHAR(64),
    from_resource_requests JSONB,
    from_resource_limits JSONB,
    to_resource_requests JSONB,
    to_resource_limits JSONB,
    trigger_source VARCHAR(64),
    reason_code VARCHAR(128),
    reason_detail TEXT,
    resize_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
    success INTEGER,
    started_at TIMESTAMP(6) WITHOUT TIME ZONE,
    finished_at TIMESTAMP(6) WITHOUT TIME ZONE,
    duration_ms BIGINT,
    opensandbox_request_id VARCHAR(128),
    opensandbox_response JSONB,
    error_message TEXT,
    create_time TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT pg_systimestamp(),
    update_time TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT pg_systimestamp(),
    CONSTRAINT pk_ss_sandbox_resize_record PRIMARY KEY (id)
);



CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_record
    ON byai.ss_sandbox_resize_record (sandbox_record_id, started_at DESC);


CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_user
    ON byai.ss_sandbox_resize_record (user_code, started_at DESC);


CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_sandbox
    ON byai.ss_sandbox_resize_record (sandbox_id);


CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_status
    ON byai.ss_sandbox_resize_record (status, started_at);



DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- ========== V0.2.0 (merged at 2026-07-06 10:27:58) ==========
-- 个人中心-个人邮箱账号表
-- 用于保存当前用户的多个邮箱账号配置；授权码只保存加密值，接口不返回明文。
CREATE TABLE IF NOT EXISTS byai.po_user_mail_account (
    account_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    account_name VARCHAR(64) NOT NULL,
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(128),
    default_flag CHAR(1) NOT NULL DEFAULT 'N',
    imap_host VARCHAR(255) NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_encryption VARCHAR(16) NOT NULL,
    smtp_host VARCHAR(255) NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_encryption VARCHAR(16) NOT NULL,
    auth_code_cipher TEXT,
    auth_code_last4 VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    last_check_time TIMESTAMP,
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
    );



COMMENT ON TABLE byai.po_user_mail_account IS '个人中心-个人邮箱账号表';


COMMENT ON COLUMN byai.po_user_mail_account.account_id IS '邮箱账号主键ID';


COMMENT ON COLUMN byai.po_user_mail_account.user_id IS '所属用户ID';


COMMENT ON COLUMN byai.po_user_mail_account.account_name IS '邮箱账号名称，如QQ邮箱、Gmail';


COMMENT ON COLUMN byai.po_user_mail_account.email IS '邮箱地址';


COMMENT ON COLUMN byai.po_user_mail_account.display_name IS '发件展示名称';


COMMENT ON COLUMN byai.po_user_mail_account.default_flag IS '是否默认邮箱账号，Y是，N否';


COMMENT ON COLUMN byai.po_user_mail_account.imap_host IS 'IMAP服务器地址';


COMMENT ON COLUMN byai.po_user_mail_account.imap_port IS 'IMAP服务器端口';


COMMENT ON COLUMN byai.po_user_mail_account.imap_encryption IS 'IMAP加密方式，如tls、ssl、starttls、none';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_host IS 'SMTP服务器地址';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_port IS 'SMTP服务器端口';


COMMENT ON COLUMN byai.po_user_mail_account.smtp_encryption IS 'SMTP加密方式，如tls、ssl、starttls、none';


COMMENT ON COLUMN byai.po_user_mail_account.auth_code_cipher IS '邮箱授权码密文';


COMMENT ON COLUMN byai.po_user_mail_account.auth_code_last4 IS '邮箱授权码后四位，用于前端提示';


COMMENT ON COLUMN byai.po_user_mail_account.status IS '账号状态，NORMAL正常';


COMMENT ON COLUMN byai.po_user_mail_account.last_check_time IS '最近一次连通性检查时间，当前阶段预留';


COMMENT ON COLUMN byai.po_user_mail_account.create_by IS '创建人ID';


COMMENT ON COLUMN byai.po_user_mail_account.create_time IS '创建时间';


COMMENT ON COLUMN byai.po_user_mail_account.update_by IS '更新人ID';


COMMENT ON COLUMN byai.po_user_mail_account.update_time IS '更新时间';


COMMENT ON COLUMN byai.po_user_mail_account.delete_flag IS '逻辑删除标识，0未删除，1已删除';



CREATE INDEX IF NOT EXISTS idx_po_user_mail_account_user
    ON byai.po_user_mail_account (user_id, delete_flag, update_time DESC);



CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_mail_account_default
    ON byai.po_user_mail_account (user_id)
    WHERE default_flag = 'Y' AND delete_flag = '0';



-- 删除生态采集不用的库表脚本（功能代码已经删掉）
DROP TABLE IF EXISTS byai.bykc_ec_import_record CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact_signal CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_artifact CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run_step CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_run CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_sync_task CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connection CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_collector_agent CASCADE;
DROP TABLE IF EXISTS byai.bykc_ec_connector CASCADE;

ALTER TABLE byai.byai_aimodel ADD COLUMN model_protocol VARCHAR(64) DEFAULT null;

-- 技能扩展表
CREATE TABLE byai.ss_res_ext_skill (
    resource_id int8 NOT NULL,
    skill_type varchar(32) NOT NULL DEFAULT 'hub',
    source_type varchar(64) NOT NULL,
    version varchar(50) NOT NULL DEFAULT 'v0.1',
    skill_url varchar(500) ,
    skill_package_format varchar(32) NOT NULL DEFAULT 'zip',
    skill_original_filename varchar(255),
    skill_package_size int8,
    skill_package_hash varchar(128),
    target_content text,
    sync_status varchar(32),
    sync_error text,
    last_sync_time timestamp,
    CONSTRAINT pk_ss_res_ext_skill PRIMARY KEY (resource_id)
);

COMMENT ON TABLE byai.ss_res_ext_skill IS '技能资源扩展表';
COMMENT ON COLUMN byai.ss_res_ext_skill.resource_id IS '资源ID，关联 byai.ss_resource.resource_id';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_type IS '技能类型：hub=来自个人技能/企业技能管理的技能，inner=系统内置技能';
COMMENT ON COLUMN byai.ss_res_ext_skill.source_type IS '技能来源类型：SYSTEM_BUILTIN=系统内置，SKILL_MANAGE_IMPORT=技能管理导入，CHAT_UPLOAD=对话框技能上传，FILE_MANAGE_UPLOAD=文件管理上传';
COMMENT ON COLUMN byai.ss_res_ext_skill.version IS '技能版本号，初始值v0.1，每次有效变更自动递增，如v0.2';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_url IS '技能压缩包在MinIO/对象存储中的内部路径(object key)，非外部下载URL';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_format IS '技能压缩包格式，当前固定为zip';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_original_filename IS '技能压缩包上传时的原始文件名';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_size IS '技能压缩包大小，单位字节';
COMMENT ON COLUMN byai.ss_res_ext_skill.skill_package_hash IS '技能压缩包内容哈希，用于重复上传、变更识别或审计';
COMMENT ON COLUMN byai.ss_res_ext_skill.target_content IS '技能资源JSON内容，包含ss_resource基础字段和ss_res_ext_skill扩展字段，用于同步给下游运行环境';
COMMENT ON COLUMN byai.ss_res_ext_skill.sync_status IS '同步状态：PENDING=待同步，SUCCESS=同步成功，FAILED=同步失败';
COMMENT ON COLUMN byai.ss_res_ext_skill.sync_error IS '最近一次同步失败原因';
COMMENT ON COLUMN byai.ss_res_ext_skill.last_sync_time IS '最近一次同步时间';

CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.add_column_if_missing('byai', 'ss_sandbox_resize_record', 'idempotency_key', 'VARCHAR(512)');
SELECT byai.add_column_if_missing('byai', 'ss_sandbox_resize_record', 'skip_reason', 'TEXT');

CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_idempotency
    ON byai.ss_sandbox_resize_record (idempotency_key, started_at DESC);

COMMENT ON COLUMN byai.ss_sandbox_resize_record.idempotency_key IS '扩缩容动作幂等键';
COMMENT ON COLUMN byai.ss_sandbox_resize_record.skip_reason IS '扩缩容动作跳过原因';

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 个人中心-个人参数配置表
-- 数据库保存密文，Redis 同步运行期明文缓存，供外部按用户 key 读取。
-- param_source/source_ref 区分用户自维护参数与系统托管连接器快照，来源类型允许后续扩展。
CREATE TABLE IF NOT EXISTS byai.po_user_private_param (
    param_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    param_key VARCHAR(128) NOT NULL,
    param_value_cipher TEXT NOT NULL,
    param_value_last4 VARCHAR(16),
    description VARCHAR(512),
    status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    param_source VARCHAR(32) NOT NULL DEFAULT 'USER',
    source_ref VARCHAR(128),
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
);

COMMENT ON TABLE byai.po_user_private_param IS '个人中心-个人参数配置表';
COMMENT ON COLUMN byai.po_user_private_param.param_id IS '个人参数主键ID';
COMMENT ON COLUMN byai.po_user_private_param.user_id IS '所属用户ID';
COMMENT ON COLUMN byai.po_user_private_param.param_key IS '参数名，环境变量格式';
COMMENT ON COLUMN byai.po_user_private_param.param_value_cipher IS '参数值密文';
COMMENT ON COLUMN byai.po_user_private_param.param_value_last4 IS '参数值后四位，用于前端提示';
COMMENT ON COLUMN byai.po_user_private_param.description IS '参数说明';
COMMENT ON COLUMN byai.po_user_private_param.status IS '参数状态，NORMAL正常，DISABLED停用';
COMMENT ON COLUMN byai.po_user_private_param.param_source IS '参数来源：USER用户维护，CONNECTOR系统托管连接器环境参数';
COMMENT ON COLUMN byai.po_user_private_param.source_ref IS '系统托管参数来源业务标识，连接器环境参数使用 connector_code';
COMMENT ON COLUMN byai.po_user_private_param.create_by IS '创建人ID';
COMMENT ON COLUMN byai.po_user_private_param.create_time IS '创建时间';
COMMENT ON COLUMN byai.po_user_private_param.update_by IS '更新人ID';
COMMENT ON COLUMN byai.po_user_private_param.update_time IS '更新时间';
COMMENT ON COLUMN byai.po_user_private_param.delete_flag IS '逻辑删除标识，0未删除，1已删除';

CREATE INDEX IF NOT EXISTS idx_po_user_private_param_user
    ON byai.po_user_private_param (user_id, delete_flag, update_time DESC);

CREATE INDEX IF NOT EXISTS idx_po_user_private_param_status
    ON byai.po_user_private_param (user_id, delete_flag, status, update_time DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_key
    ON byai.po_user_private_param (user_id, param_key)
    WHERE delete_flag = '0';

-- 同一用户、同一连接器可以保存多条环境参数，但同一参数名只能有一条未删除记录。
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector
    ON byai.po_user_private_param (user_id, param_source, source_ref, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector_null_ref
    ON byai.po_user_private_param (user_id, param_source, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NULL;

-- 沙箱健康检测-水位模型配置表
CREATE TABLE IF NOT EXISTS byai.sandbox_health_watermark_model (
    id BIGSERIAL PRIMARY KEY,
    model_name VARCHAR(128) NOT NULL,
    service_type VARCHAR(64) NOT NULL,
    profile_key VARCHAR(64),
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    idle_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    busy_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    critical_memory_limit_ratio NUMERIC(8,4) NOT NULL,
    busy_cpu_request_ratio NUMERIC(8,4) NOT NULL,
    critical_cpu_request_ratio NUMERIC(8,4) NOT NULL,
    consecutive_busy_samples INTEGER NOT NULL DEFAULT 2,
    recover_samples INTEGER NOT NULL DEFAULT 2,
    sample_interval_seconds INTEGER NOT NULL DEFAULT 30,
    snapshot_ttl_seconds INTEGER NOT NULL DEFAULT 120,
    watch_ttl_seconds INTEGER NOT NULL DEFAULT 90,
    remark VARCHAR(512),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE byai.sandbox_health_watermark_model IS '沙箱健康检测-水位模型配置表';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.id IS '主键ID';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.model_name IS '水位模型名称';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.service_type IS '沙箱服务类型，例如openclaw；default表示兜底模型';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.profile_key IS '沙箱规格Key，例如xs/s/m/l；为空表示服务类型默认模型';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.enabled IS '是否启用，1启用，0停用';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.priority IS '匹配优先级，同一匹配范围内数值越大优先级越高';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.idle_memory_limit_ratio IS '空闲内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.busy_memory_limit_ratio IS '繁忙内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.critical_memory_limit_ratio IS '阻断内存limit水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.busy_cpu_request_ratio IS '繁忙CPU request水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.critical_cpu_request_ratio IS '阻断CPU request水位阈值';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.consecutive_busy_samples IS '连续繁忙采样次数';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.recover_samples IS '连续恢复采样次数';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.sample_interval_seconds IS '采样周期，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.snapshot_ttl_seconds IS '健康快照Redis TTL，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.watch_ttl_seconds IS '健康检测watch Redis TTL，单位秒';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.remark IS '备注';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.created_at IS '创建时间';
COMMENT ON COLUMN byai.sandbox_health_watermark_model.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS uk_sandbox_health_watermark_enabled
    ON byai.sandbox_health_watermark_model (service_type, COALESCE(profile_key, ''))
    WHERE enabled = 1;

CREATE INDEX IF NOT EXISTS idx_sandbox_health_watermark_scope
    ON byai.sandbox_health_watermark_model (service_type, profile_key, enabled, priority DESC);

alter table byai.ss_res_ext_dig_employee alter column tag_name type varchar(255);


-- 模型表新增 owner_type 字段: 区分个人模型 (PERSONAL) 和公共模型 (PUBLIC)
ALTER TABLE byai.byai_aimodel ADD COLUMN owner_type VARCHAR(20) DEFAULT 'PUBLIC';
COMMENT ON COLUMN byai.byai_aimodel.owner_type IS '模型归属: PUBLIC(公共) / PERSONAL(个人)';

-- 模型表新增 source_type 字段: 区分模型来源
ALTER TABLE byai.byai_aimodel ADD COLUMN source_type VARCHAR(32) DEFAULT NULL;
COMMENT ON COLUMN byai.byai_aimodel.source_type IS '模型来源: null(用户创建) / TOKEN_SAVER(系统分配)';

-- 用户 Token 额度配置表（管理员可为每位用户分配独立额度）
CREATE TABLE IF NOT EXISTS byai.po_user_token_quota (
    quota_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    monthly_quota_limit BIGINT NOT NULL,
    remark VARCHAR(512),
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
);

COMMENT ON TABLE byai.po_user_token_quota IS '用户Token额度配置表';
COMMENT ON COLUMN byai.po_user_token_quota.quota_id IS '主键ID';
COMMENT ON COLUMN byai.po_user_token_quota.user_id IS '用户ID（关联po_users.user_id）';
COMMENT ON COLUMN byai.po_user_token_quota.monthly_quota_limit IS '月度Token限额';
COMMENT ON COLUMN byai.po_user_token_quota.remark IS '备注';
COMMENT ON COLUMN byai.po_user_token_quota.create_by IS '创建人ID';
COMMENT ON COLUMN byai.po_user_token_quota.create_time IS '创建时间';
COMMENT ON COLUMN byai.po_user_token_quota.update_by IS '更新人ID';
COMMENT ON COLUMN byai.po_user_token_quota.update_time IS '更新时间';
COMMENT ON COLUMN byai.po_user_token_quota.delete_flag IS '逻辑删除标识，0未删除，1已删除';

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_token_quota_user
    ON byai.po_user_token_quota (user_id) WHERE delete_flag = '0';

-- ========== V0.3.0 (merged at 2026-07-28 18:10:57) ==========
-- V0.3.0 需求收集模块
-- 项目表
CREATE TABLE IF NOT EXISTS byai.byai_project (
    project_id      BIGINT          NOT NULL,
    project_name    VARCHAR(100)    NOT NULL,
    description     VARCHAR(500),
    resource_id     BIGINT,
    project_type    VARCHAR(20)     NOT NULL DEFAULT 'normal',
    is_share        VARCHAR(10)     NOT NULL DEFAULT 'N',
    create_by       BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_project PRIMARY KEY (project_id)
);

COMMENT ON TABLE byai.byai_project IS '项目表';
COMMENT ON COLUMN byai.byai_project.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project.project_name IS '项目名称';
COMMENT ON COLUMN byai.byai_project.description IS '项目描述';
COMMENT ON COLUMN byai.byai_project.resource_id IS '关联Agent资源ID';
COMMENT ON COLUMN byai.byai_project.project_type IS '项目类型：normal普通项目，develop研发项目';
COMMENT ON COLUMN byai.byai_project.is_share IS '是否分享：N-不分享，Y-可分享';
COMMENT ON COLUMN byai.byai_project.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_project.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_project.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_project.delete_flag IS '删除标记 0正常 1删除';

-- 项目关联会话
ALTER TABLE byai_session ADD COLUMN project_id BIGINT NOT NULL DEFAULT -1;
COMMENT ON COLUMN byai_session.project_id IS '项目ID,-1代表无归属项目,即默认项目';

-- 项目关联成员
CREATE TABLE IF NOT EXISTS byai.byai_project_member
(
    member_id   BIGINT NOT NULL,
    project_id  BIGINT NOT NULL,
    user_id     BIGINT,
    role        VARCHAR(32) DEFAULT 'member',
    agent_id    BIGINT,
    create_time TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_member PRIMARY KEY (member_id)
);

COMMENT ON TABLE byai.byai_project_member IS '项目成员表';
COMMENT ON COLUMN byai.byai_project_member.member_id IS '记录ID';
COMMENT ON COLUMN byai.byai_project_member.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_member.user_id IS '用户ID';
COMMENT ON COLUMN byai.byai_project_member.role IS '角色: owner/member';
COMMENT ON COLUMN byai.byai_project_member.agent_id IS '关联的默认数字员工ID';
COMMENT ON COLUMN byai.byai_project_member.create_time IS '加入时间';

CREATE INDEX IF NOT EXISTS idx_project_member_project ON byai.byai_project_member (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_member_unique ON byai.byai_project_member (project_id, user_id);

-- 项目仓库关联表
CREATE TABLE IF NOT EXISTS byai.byai_project_repo (
    repo_id         BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    repo_full_name  VARCHAR(200)    NOT NULL,
    repo_url        VARCHAR(500),
    default_branch  VARCHAR(100)    DEFAULT 'main',
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_repo PRIMARY KEY (repo_id)
);

COMMENT ON TABLE byai.byai_project_repo IS '项目仓库关联表';
COMMENT ON COLUMN byai.byai_project_repo.repo_id IS '仓库记录ID';
COMMENT ON COLUMN byai.byai_project_repo.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_project_repo.repo_full_name IS '仓库全名 owner/repo';
COMMENT ON COLUMN byai.byai_project_repo.repo_url IS '仓库地址';
COMMENT ON COLUMN byai.byai_project_repo.default_branch IS '默认分支';

-- 项目空间共享文件表
CREATE TABLE IF NOT EXISTS byai.byai_project_share_file
(
    share_id    BIGINT PRIMARY KEY NOT NULL,
    project_id  BIGINT,
    file_id     BIGINT             NOT NULL,
    share_link  VARCHAR(1000),
    create_by   BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE byai.byai_project_share_file IS '项目空间共享文件表';
COMMENT ON COLUMN byai.byai_project_share_file.share_id IS '共享记录ID';
COMMENT ON COLUMN byai.byai_project_share_file.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_share_file.file_id IS '文件ID';
COMMENT ON COLUMN byai.byai_project_share_file.share_link IS '分享链接';
COMMENT ON COLUMN byai.byai_project_share_file.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project_share_file.create_time IS '创建时间';

-- 需求扫描源配置表
CREATE TABLE IF NOT EXISTS byai.byai_scan_source (
    source_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    source_name     VARCHAR(100)    NOT NULL,
    source_type     VARCHAR(30)     NOT NULL,
    config          TEXT,
    cron_expr       VARCHAR(100),
    enabled         CHAR(1)         DEFAULT '1',
    repo_id         BIGINT,
    confirm_mode    VARCHAR(16)     DEFAULT 'manual',
    score_threshold INT             DEFAULT 70,
    last_scan_time  TIMESTAMP,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       VARCHAR(64),
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_scan_source PRIMARY KEY (source_id)
);

COMMENT ON TABLE byai.byai_scan_source IS '需求扫描源配置表';
COMMENT ON COLUMN byai.byai_scan_source.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_source.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_scan_source.source_name IS '扫描源名称';
COMMENT ON COLUMN byai.byai_scan_source.source_type IS '扫描源类型 dingtalk/github_issue/ci_failure';
COMMENT ON COLUMN byai.byai_scan_source.config IS '配置JSON';
COMMENT ON COLUMN byai.byai_scan_source.cron_expr IS 'Cron表达式';
COMMENT ON COLUMN byai.byai_scan_source.enabled IS '是否启用 1启用 0停用';
COMMENT ON COLUMN byai.byai_scan_source.repo_id IS '关联目标仓库ID byai_project_repo.repo_id，扫来的需求据此确定开发仓库';
COMMENT ON COLUMN byai.byai_scan_source.confirm_mode IS '需求确认规则 manual人工确认/auto全自动派生/score按分数阈值派生';
COMMENT ON COLUMN byai.byai_scan_source.score_threshold IS 'score模式下自动派生的最低综合分，默认70';
COMMENT ON COLUMN byai.byai_scan_source.last_scan_time IS '最近扫描时间';
COMMENT ON COLUMN byai.byai_scan_source.delete_flag IS '删除标记 0正常 1删除';

-- 扫描执行日志表
CREATE TABLE IF NOT EXISTS byai.byai_scan_log (
    log_id          BIGINT          NOT NULL,
    source_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    scan_time       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    found_count     INT             DEFAULT 0,
    created_count   INT             DEFAULT 0,
    status          VARCHAR(20)     DEFAULT 'success',
    error_msg       VARCHAR(1000),
    CONSTRAINT pk_byai_scan_log PRIMARY KEY (log_id)
);

COMMENT ON TABLE byai.byai_scan_log IS '扫描执行日志表';
COMMENT ON COLUMN byai.byai_scan_log.log_id IS '日志ID';
COMMENT ON COLUMN byai.byai_scan_log.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_log.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_scan_log.scan_time IS '扫描时间';
COMMENT ON COLUMN byai.byai_scan_log.found_count IS '发现数量';
COMMENT ON COLUMN byai.byai_scan_log.created_count IS '创建数量';
COMMENT ON COLUMN byai.byai_scan_log.status IS '状态 success/failed';
COMMENT ON COLUMN byai.byai_scan_log.error_msg IS '错误信息';

-- 扫描结果明细表
CREATE TABLE IF NOT EXISTS byai.byai_scan_log_item (
    item_id         BIGINT          NOT NULL,
    log_id          BIGINT          NOT NULL,
    source_id       BIGINT          NOT NULL,
    title           VARCHAR(500)    NOT NULL,
    content         TEXT,
    origin_id       VARCHAR(200),
    origin_url      VARCHAR(500),
    action          VARCHAR(20)     NOT NULL,
    session_id      BIGINT,
    score           INT,
    priority        VARCHAR(8),
    score_detail    TEXT,
    parent_item_id  BIGINT,
    content_hash    VARCHAR(64),
    dedup_status    VARCHAR(20)     DEFAULT 'normal',
    duplicate_of_item_id BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_scan_log_item PRIMARY KEY (item_id)
);

COMMENT ON TABLE byai.byai_scan_log_item IS '扫描结果明细表';
COMMENT ON COLUMN byai.byai_scan_log_item.item_id IS '明细ID';
COMMENT ON COLUMN byai.byai_scan_log_item.log_id IS '所属日志ID';
COMMENT ON COLUMN byai.byai_scan_log_item.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_log_item.title IS '需求标题';
COMMENT ON COLUMN byai.byai_scan_log_item.content IS '需求内容';
COMMENT ON COLUMN byai.byai_scan_log_item.origin_id IS '来源原始ID(issue号/消息ID)';
COMMENT ON COLUMN byai.byai_scan_log_item.origin_url IS '来源链接';
COMMENT ON COLUMN byai.byai_scan_log_item.action IS '处理动作 created/duplicate/deferred/split(被拆分的原始条,不派发)';
COMMENT ON COLUMN byai.byai_scan_log_item.session_id IS '已启动会话ID(byai_session.session_id)，标记需求已启动';
COMMENT ON COLUMN byai.byai_scan_log_item.score IS 'AI综合评分 0-100';
COMMENT ON COLUMN byai.byai_scan_log_item.priority IS 'AI优先级 P0/P1/P2';
COMMENT ON COLUMN byai.byai_scan_log_item.score_detail IS 'AI评分明细JSON:各维度得分/风险/AI整理需求';
COMMENT ON COLUMN byai.byai_scan_log_item.parent_item_id IS '拆分溯源:子需求指向被拆分的原始item;未拆分为空';
COMMENT ON COLUMN byai.byai_scan_log_item.content_hash IS '归一化内容指纹,二期去重用';
COMMENT ON COLUMN byai.byai_scan_log_item.dedup_status IS '去重状态 normal/suspected_dup/confirmed_dup/not_dup';
COMMENT ON COLUMN byai.byai_scan_log_item.duplicate_of_item_id IS '疑似/确认重复时指向的原始item';

-- 索引
CREATE INDEX IF NOT EXISTS idx_scan_source_project ON byai.byai_scan_source(project_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_source ON byai.byai_scan_log(source_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_log ON byai.byai_scan_log_item(log_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_hash ON byai.byai_scan_log_item(content_hash);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_dedup ON byai.byai_scan_log_item(dedup_status);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_parent ON byai.byai_scan_log_item(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_project_repo_project ON byai.byai_project_repo(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_project ON byai.byai_project_share_file(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_file ON byai.byai_project_share_file(file_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_create_by ON byai.byai_project_share_file(create_by);

-- ========== V0.3.1 连接器授权（合并到全新初始化脚本） ==========
-- 全新部署直接创建连接器模板、用户授权表及约束；已有环境由 V0.3.1 增量 DDL 升级。

-- 连接器基础元信息：保存平台级连接器模板及不含真实凭证的 Runtime Manifest。
CREATE TABLE IF NOT EXISTS byai.byai_connector_info
(
    connector_id    BIGINT       NOT NULL PRIMARY KEY,
    connector_code  VARCHAR(64)  NOT NULL,
    connector_name  VARCHAR(128) NOT NULL,
    icon_url        VARCHAR(512),
    description     TEXT,
    connector_type  VARCHAR(32)  NOT NULL,
    provider_code   VARCHAR(64),
    skill_code      VARCHAR(64),
    auth_mode       VARCHAR(32),
    auth_config     VARCHAR(4096),
    request_config  VARCHAR(4096),
    runtime_manifest TEXT,
    sort            INT DEFAULT 0,
    status_cd       VARCHAR(3)   NOT NULL DEFAULT '00A',
    create_by       VARCHAR(64),
    create_time     TIMESTAMP    NOT NULL DEFAULT NOW(),
    update_time     TIMESTAMP
);

-- connector_code 保证平台连接器编码唯一；状态与排序联合索引服务连接器列表查询。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_info_code
    ON byai.byai_connector_info (connector_code);

CREATE INDEX IF NOT EXISTS idx_byai_connector_info_status_sort
    ON byai.byai_connector_info (status_cd, sort, create_time);

COMMENT ON TABLE byai.byai_connector_info IS '连接器基础元信息（平台连接器模板）';
COMMENT ON COLUMN byai.byai_connector_info.connector_id IS '主键，Long类型连接器ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_info.connector_code IS '连接器业务编码，全局唯一';
COMMENT ON COLUMN byai.byai_connector_info.connector_name IS '连接器展示名称';
COMMENT ON COLUMN byai.byai_connector_info.icon_url IS '连接器图标地址';
COMMENT ON COLUMN byai.byai_connector_info.description IS '连接器功能简介';
COMMENT ON COLUMN byai.byai_connector_info.connector_type IS '连接器类型：SYSTEM=系统内置，CUSTOM=自定义连接器';
COMMENT ON COLUMN byai.byai_connector_info.provider_code IS '授权 Provider 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.skill_code IS 'OpenClaw Skill 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.auth_mode IS '授权方式：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_info.auth_config IS '连接器通用授权模板配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.request_config IS '连接器公共请求配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.runtime_manifest IS '连接器最新 Runtime Manifest 模板，规范化完整 JSON';
COMMENT ON COLUMN byai.byai_connector_info.sort IS '前端页面排序权重';
COMMENT ON COLUMN byai.byai_connector_info.status_cd IS '状态编码：00A=有效，00X=无效';
COMMENT ON COLUMN byai.byai_connector_info.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_info.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_info.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';

-- 用户连接器授权绑定记录：保存连接开关与授权状态，CLI 真实凭证仍存放在用户 native-home。
CREATE TABLE IF NOT EXISTS byai.byai_connector_auth
(
    auth_id          BIGINT      NOT NULL PRIMARY KEY,
    user_id          VARCHAR(64) NOT NULL,
    connector_id     BIGINT      NOT NULL,
    auth_name        VARCHAR(128),
    auth_mode        VARCHAR(32),
    auth_credential  TEXT,
    expire_time      TIMESTAMP,
    enable_flag      CHAR(1)     NOT NULL DEFAULT 'N',
    status_cd        VARCHAR(3)  NOT NULL DEFAULT '00A',
    last_sync_time   TIMESTAMP,
    create_by        VARCHAR(64),
    create_time      TIMESTAMP   NOT NULL DEFAULT NOW(),
    update_time      TIMESTAMP
);

-- 外键使用幂等检查，允许初始化脚本在约束已存在时安全重放。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_byai_connector_auth_connector'
    ) THEN
        ALTER TABLE byai.byai_connector_auth
            ADD CONSTRAINT fk_byai_connector_auth_connector
                FOREIGN KEY (connector_id)
                    REFERENCES byai.byai_connector_info (connector_id);
    END IF;
END
$$;

-- 普通索引加速按用户、连接器、状态和有效期查询授权记录。
CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_connector
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, expire_time);

-- 部分唯一索引保证同一用户、同一连接器最多只有一条有效授权记录。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_auth_active_user_connector
    ON byai.byai_connector_auth (user_id, connector_id)
    WHERE status_cd = '00A';

COMMENT ON TABLE byai.byai_connector_auth IS '用户连接器授权绑定记录';
COMMENT ON COLUMN byai.byai_connector_auth.auth_id IS '主键，Long类型授权记录ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_auth.user_id IS '归属用户ID';
COMMENT ON COLUMN byai.byai_connector_auth.connector_id IS '关联byai_connector_info.connector_id';
COMMENT ON COLUMN byai.byai_connector_auth.auth_name IS '用户自定义授权账号别名';
COMMENT ON COLUMN byai.byai_connector_auth.auth_mode IS '授权方式（冗余，与连接器模板保持一致）：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_auth.auth_credential IS '加密后的授权凭证JSON，禁止明文存储密钥';
COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '凭证过期时间';
COMMENT ON COLUMN byai.byai_connector_auth.enable_flag IS '连接启用标识：Y=开启连接，N=关闭连接，新建默认关闭';
COMMENT ON COLUMN byai.byai_connector_auth.status_cd IS '状态编码：00A=有效，00X=无效（软删除）';
COMMENT ON COLUMN byai.byai_connector_auth.last_sync_time IS '凭证最后同步刷新时间';
COMMENT ON COLUMN byai.byai_connector_auth.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_auth.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_auth.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';

-- ========== V0.3.1 (merged at 2026-08-18 16:19:56) ==========
-- V0.3.1 增量 DDL：为已有环境增加连接器授权、Runtime Manifest 和系统托管参数快照结构。
-- 所有新增表、字段、约束和索引均采用幂等方式，支持升级脚本安全重放。
SET search_path TO byai;

-- 连接器基础元信息：保存平台级连接器模板；runtime_manifest 在后续兼容字段块中幂等补充。
CREATE TABLE IF NOT EXISTS byai.byai_connector_info
(
    connector_id   BIGINT       NOT NULL PRIMARY KEY,
    connector_code VARCHAR(64)  NOT NULL,
    connector_name VARCHAR(128) NOT NULL,
    icon_url       VARCHAR(512),
    description    TEXT,
    connector_type VARCHAR(32)  NOT NULL,
    provider_code  VARCHAR(64),
    skill_code     VARCHAR(64),
    auth_mode      VARCHAR(32),
    auth_config    VARCHAR(4096),
    request_config VARCHAR(4096),
    sort           INT                   DEFAULT 0,
    status_cd      VARCHAR(3)   NOT NULL DEFAULT '00A',
    create_by      VARCHAR(64),
    create_time    TIMESTAMP    NOT NULL DEFAULT NOW(),
    update_time    TIMESTAMP
);

-- connector_code 保证平台连接器编码唯一；状态与排序联合索引服务连接器列表查询。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_info_code
    ON byai.byai_connector_info (connector_code);

CREATE INDEX IF NOT EXISTS idx_byai_connector_info_status_sort
    ON byai.byai_connector_info (status_cd, sort, create_time);

COMMENT ON TABLE byai.byai_connector_info IS '连接器基础元信息（平台连接器模板）';
COMMENT ON COLUMN byai.byai_connector_info.connector_id IS '主键，Long类型连接器ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_info.connector_code IS '连接器业务编码，全局唯一';
COMMENT ON COLUMN byai.byai_connector_info.connector_name IS '连接器展示名称';
COMMENT ON COLUMN byai.byai_connector_info.icon_url IS '连接器图标地址';
COMMENT ON COLUMN byai.byai_connector_info.description IS '连接器功能简介';
COMMENT ON COLUMN byai.byai_connector_info.connector_type IS '连接器类型：SYSTEM=系统内置，CUSTOM=自定义连接器';
COMMENT ON COLUMN byai.byai_connector_info.provider_code IS '授权 Provider 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.skill_code IS 'OpenClaw Skill 路由编码';
COMMENT ON COLUMN byai.byai_connector_info.auth_mode IS '授权方式：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_info.auth_config IS '连接器通用授权模板配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.request_config IS '连接器公共请求配置，JSON字符串';
COMMENT ON COLUMN byai.byai_connector_info.sort IS '前端页面排序权重';
COMMENT ON COLUMN byai.byai_connector_info.status_cd IS '状态编码：00A=有效，00X=无效';
COMMENT ON COLUMN byai.byai_connector_info.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_info.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_info.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';


-- 用户连接器授权绑定记录：保存连接开关与授权状态，CLI 真实凭证仍存放在用户 native-home。
CREATE TABLE IF NOT EXISTS byai.byai_connector_auth
(
    auth_id         BIGINT      NOT NULL PRIMARY KEY,
    user_id         VARCHAR(64) NOT NULL,
    connector_id    BIGINT      NOT NULL,
    auth_name       VARCHAR(128),
    auth_mode       VARCHAR(32),
    auth_credential TEXT,
    expire_time     TIMESTAMP,
    enable_flag     CHAR(1)     NOT NULL DEFAULT 'N',
    status_cd       VARCHAR(3)  NOT NULL DEFAULT '00A',
    last_sync_time  TIMESTAMP,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP   NOT NULL DEFAULT NOW(),
    update_time     TIMESTAMP
);

-- 为兼容可能已存在的表，外键通过系统目录检查后再创建。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_byai_connector_auth_connector'
    ) THEN
        ALTER TABLE byai.byai_connector_auth
            ADD CONSTRAINT fk_byai_connector_auth_connector
                FOREIGN KEY (connector_id)
                    REFERENCES byai.byai_connector_info (connector_id);
    END IF;
END
$$;

-- 普通索引加速按用户、连接器、状态和有效期查询授权记录。
CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_connector
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, expire_time);

-- 创建有效授权唯一索引前，先按“可用优先、最近更新优先”保留一条记录并软删除其余历史重复项。
WITH ranked_active_authorizations AS (
    SELECT auth_id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, connector_id
                        ORDER BY CASE WHEN enable_flag = 'Y' THEN 0 ELSE 1 END ASC,
                        update_time DESC NULLS LAST,
                        create_time DESC NULLS LAST,
                        auth_id DESC NULLS LAST
           ) AS row_num
    FROM byai.byai_connector_auth
    WHERE status_cd = '00A'
)
UPDATE byai.byai_connector_auth AS duplicate_auth
SET status_cd = '00X',
    enable_flag = 'N',
    update_time = CURRENT_TIMESTAMP
FROM ranked_active_authorizations AS ranked
WHERE duplicate_auth.auth_id = ranked.auth_id
  AND ranked.row_num > 1;

-- 部分唯一索引保证升级后同一用户、同一连接器最多只有一条有效授权记录。
CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_auth_active_user_connector
    ON byai.byai_connector_auth (user_id, connector_id)
    WHERE status_cd = '00A';

COMMENT ON TABLE byai.byai_connector_auth IS '用户连接器授权绑定记录';
COMMENT ON COLUMN byai.byai_connector_auth.auth_id IS '主键，Long类型授权记录ID，业务层生成';
COMMENT ON COLUMN byai.byai_connector_auth.user_id IS '归属用户ID';
COMMENT ON COLUMN byai.byai_connector_auth.connector_id IS '关联byai.byai_connector_info.connector_id';
COMMENT ON COLUMN byai.byai_connector_auth.auth_name IS '用户自定义授权账号别名';
COMMENT ON COLUMN byai.byai_connector_auth.auth_mode IS '授权方式（冗余，与连接器模板保持一致）：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN、DEVICE_FLOW、CLI_INIT，允许为空';
COMMENT ON COLUMN byai.byai_connector_auth.auth_credential IS '加密后的授权凭证JSON，禁止明文存储密钥';
COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '凭证过期时间';
COMMENT ON COLUMN byai.byai_connector_auth.enable_flag IS '连接启用标识：Y=开启连接，N=关闭连接，新建默认关闭';
COMMENT ON COLUMN byai.byai_connector_auth.status_cd IS '状态编码：00A=有效，00X=无效（软删除）';
COMMENT ON COLUMN byai.byai_connector_auth.last_sync_time IS '凭证最后同步刷新时间';
COMMENT ON COLUMN byai.byai_connector_auth.create_by IS '创建人标识';
COMMENT ON COLUMN byai.byai_connector_auth.create_time IS '创建时间，新增自动填充';
COMMENT ON COLUMN byai.byai_connector_auth.update_time IS '更新时间，新增不赋值为NULL，更新时手动填充';


-- 连接器 Runtime Manifest 模板与用户系统托管快照字段。
-- 使用临时辅助函数兼容不同历史库结构：字段存在时跳过，不覆盖已有数据。
CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 平台连接器保存规范化 Runtime Manifest；用户参数增加来源类型与连接器业务标识。
SELECT byai.add_column_if_missing('byai', 'byai_connector_info', 'runtime_manifest', 'TEXT');
SELECT byai.add_column_if_missing('byai', 'byai_connector_info', 'skill_code', 'VARCHAR(64)');
SELECT byai.add_column_if_missing(
    'byai',
    'po_user_private_param',
    'param_source',
    'VARCHAR(32) NOT NULL DEFAULT ''USER'''
);
SELECT byai.add_column_if_missing('byai', 'po_user_private_param', 'source_ref', 'VARCHAR(128)');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 同一用户、同一连接器可以保存多条环境参数，但同一参数名只能有一条未删除记录。
DROP INDEX IF EXISTS byai.uk_po_user_private_param_connector;
DROP INDEX IF EXISTS byai.uk_po_user_private_param_connector_null_ref;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector
    ON byai.po_user_private_param (user_id, param_source, source_ref, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_private_param_connector_null_ref
    ON byai.po_user_private_param (user_id, param_source, param_key)
    WHERE delete_flag = '0' AND param_source = 'CONNECTOR' AND source_ref IS NULL;

COMMENT ON COLUMN byai.byai_connector_info.runtime_manifest IS '连接器最新 Runtime Manifest 模板，规范化完整 JSON';
COMMENT ON COLUMN byai.po_user_private_param.param_source IS '参数来源：USER用户维护，CONNECTOR系统托管连接器环境参数';
COMMENT ON COLUMN byai.po_user_private_param.source_ref IS '系统托管参数来源业务标识，连接器环境参数使用 connector_code';

-- ========== V0.3.2 (merged at 2026-08-18 16:19:56) ==========
-- V0.3.2 增量 DDL：增加 refresh-aware 连接器凭证生命周期元数据。
-- CLI 管理的 access token、refresh token 仍只保存在用户隔离 native-home，本迁移不保存任何 token 值。
SET search_path TO byai;

CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'access_expire_time', 'TIMESTAMP');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'refresh_expire_time', 'TIMESTAMP');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'credential_state', 'VARCHAR(32) DEFAULT ''UNKNOWN''');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'renewal_mode', 'VARCHAR(32) DEFAULT ''NONE''');
SELECT byai.add_column_if_missing('byai', 'byai_connector_auth', 'last_verified_at', 'TIMESTAMP');

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 说明：凭证状态回填（access_expire_time / credential_state / renewal_mode）已迁至 V0.3.2__dml.sql。
-- 新增列自带 DEFAULT，已有行在 ADD COLUMN 时即被填充，因此下方 SET NOT NULL 不依赖回填顺序。

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN credential_state SET DEFAULT 'UNKNOWN';

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN credential_state SET NOT NULL;

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN renewal_mode SET DEFAULT 'NONE';

ALTER TABLE byai.byai_connector_auth
    ALTER COLUMN renewal_mode SET NOT NULL;

-- V0.3.1 的唯一索引可能在旧环境中已经被标记执行但实际未落库；本版本再次以幂等方式修复历史重复有效绑定。
WITH ranked_active_authorizations AS (
    SELECT auth_id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, connector_id
               ORDER BY CASE WHEN enable_flag = 'Y' THEN 0 ELSE 1 END ASC,
                        update_time DESC NULLS LAST,
                        create_time DESC NULLS LAST,
                        auth_id DESC NULLS LAST
           ) AS row_num
    FROM byai.byai_connector_auth
    WHERE status_cd = '00A'
)
UPDATE byai.byai_connector_auth AS duplicate_auth
SET status_cd = '00X',
    enable_flag = 'N',
    update_time = CURRENT_TIMESTAMP
FROM ranked_active_authorizations AS ranked
WHERE duplicate_auth.auth_id = ranked.auth_id
  AND ranked.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_auth_active_user_connector
    ON byai.byai_connector_auth (user_id, connector_id)
    WHERE status_cd = '00A';

CREATE INDEX IF NOT EXISTS idx_byai_connector_auth_user_state
    ON byai.byai_connector_auth (user_id, connector_id, status_cd, enable_flag, credential_state);

COMMENT ON COLUMN byai.byai_connector_auth.expire_time IS '兼容字段：当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.access_expire_time IS '当前 access token 或等价短期凭证到期时间';
COMMENT ON COLUMN byai.byai_connector_auth.refresh_expire_time IS 'refresh token 或等价长期续期能力到期时间，不保存 token 值';
COMMENT ON COLUMN byai.byai_connector_auth.credential_state IS '凭证状态：READY、REFRESH_NEEDED、EXPIRING、REAUTH_REQUIRED、UNKNOWN';
COMMENT ON COLUMN byai.byai_connector_auth.renewal_mode IS '续期模式：REFRESH_TOKEN、CREDENTIAL_REISSUE、PROBE_ONLY、NONE';
COMMENT ON COLUMN byai.byai_connector_auth.last_verified_at IS 'Provider 最近一次权威凭证验证时间';

-- Artifact publication metadata. Object bytes remain in the configured storage backend.
SET search_path TO byai;

CREATE TABLE IF NOT EXISTS byai.byai_artifact (
    artifact_id        VARCHAR(36)    NOT NULL,
    owner_user_id      BIGINT         NOT NULL,
    owner_user_code    VARCHAR(100)   NOT NULL,
    status             VARCHAR(16)    NOT NULL,
    kind               VARCHAR(20),
    storage_type       VARCHAR(32)    NOT NULL,
    storage_root       VARCHAR(500)   NOT NULL,
    storage_prefix     VARCHAR(1000)  NOT NULL,
    original_key       VARCHAR(1200)  NOT NULL,
    content_prefix     VARCHAR(1200)  NOT NULL,
    original_name      VARCHAR(500)   NOT NULL,
    display_name       VARCHAR(500),
    entry_point        VARCHAR(1000),
    content_type       VARCHAR(200),
    file_size          BIGINT         NOT NULL DEFAULT 0,
    expanded_size      BIGINT         NOT NULL DEFAULT 0,
    sha256             VARCHAR(64),
    access_key_hash    VARCHAR(64)    NOT NULL,
    warnings_json      TEXT,
    expires_at         TIMESTAMP      NOT NULL,
    create_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_artifact PRIMARY KEY (artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_owner
    ON byai.byai_artifact (owner_user_id, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_cleanup
    ON byai.byai_artifact (status, expires_at);

COMMENT ON TABLE byai.byai_artifact IS '限时预览与下载Artifact元数据';
COMMENT ON COLUMN byai.byai_artifact.access_key_hash IS '不记名访问密钥的SHA-256，仅上传响应返回原始密钥';
COMMENT ON COLUMN byai.byai_artifact.storage_type IS '创建时实际使用的存储后端，切换默认后仍用于读取历史Artifact';
