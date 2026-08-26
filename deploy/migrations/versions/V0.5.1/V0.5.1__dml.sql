-- V0.5.1 增量数据：将 knowledge-collection 收敛为纯采集与规范化正文交付 Skill。

SET search_path TO byai;

UPDATE ss_resource
SET resource_desc = '跨互联网与企业平台采集、归档资料，并完成规范化正文交付。',
    update_time = CURRENT_TIMESTAMP
WHERE resource_code = 'knowledge-collection';

-- 同时兼容紧凑 JSON 与带缩进的 JSON；仅替换 knowledge-collection 目录项。
UPDATE byai_system_config
SET param_value = regexp_replace(
        param_value,
        '\{[[:space:]]*"skillName"[[:space:]]*:[[:space:]]*"knowledge-collection"[[:space:]]*,[[:space:]]*"skillCode"[[:space:]]*:[[:space:]]*"knowledge-collection"[[:space:]]*,[[:space:]]*"skillDescZh"[[:space:]]*:[[:space:]]*"[^"]*"[[:space:]]*,[[:space:]]*"skillDescEn"[[:space:]]*:[[:space:]]*"[^"]*"[[:space:]]*\}',
        '{"skillName":"knowledge-collection","skillCode":"knowledge-collection","skillDescZh":"跨互联网与企业平台采集、归档资料，并完成规范化正文交付；不执行任何下游动作。","skillDescEn":"Collect and archive materials across public internet and enterprise platforms, producing a validated sanitized-content handoff without downstream actions."}',
        'g'
    )
WHERE param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(param_value, '\s', '', 'g')
      LIKE '%"skillCode":"knowledge-collection"%';

-- 从资源表刷新运行期 Skill 快照，使已安装实例同步新的纯采集描述。
UPDATE ss_res_ext_skill e
SET target_content = json_build_object(
        'resourceId', r.resource_id,
        'resourceCode', r.resource_code,
        'resourceName', r.resource_name,
        'resourceDesc', r.resource_desc,
        'resourceBizType', r.resource_biz_type,
        'resourceType', r.resource_type,
        'ownerType', r.owner_type,
        'sourceType', e.source_type,
        'skillType', e.skill_type,
        'skillUrl', e.skill_url,
        'version', e.version,
        'skillPackageFormat', e.skill_package_format,
        'skillOriginalFilename', e.skill_original_filename,
        'skillPackageSize', e.skill_package_size,
        'skillPackageHash', e.skill_package_hash,
        'syncStatus', e.sync_status,
        'syncError', e.sync_error,
        'lastSyncTime', to_char(e.last_sync_time, 'YYYY-MM-DD HH24:MI:SS')
    )::text
FROM ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'knowledge-collection';
