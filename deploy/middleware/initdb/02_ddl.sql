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

-- ========== V0.0.1 (merged at 2026-05-21 09:56:18) ==========
ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN lock_version integer DEFAULT 0 NOT NULL;
COMMENT ON COLUMN byai.ss_sandbox_record.version IS '业务生命周期版本号';
COMMENT ON COLUMN byai.ss_sandbox_record.lock_version IS '乐观锁版本号';
ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN gateway_token character varying(128);
COMMENT ON COLUMN byai.ss_sandbox_record.gateway_token IS '绑定到沙箱实例的网关访问token';
