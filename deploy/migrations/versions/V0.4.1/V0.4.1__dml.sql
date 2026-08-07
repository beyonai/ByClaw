-- V0.4.1 增量数据：新增「知识智采」内置 Skill（smart-collection）
-- 按 knowledge-collection 的内置 Skill 初始化范式显式播种，不从库内既有资源复制行。
-- resource_id 使用种子保留区固定值 26（seq_any_table 从 10000000 起，不会与运行期资源冲突）。
-- 所有语句带存在性判断，可重复重放。

SET search_path TO byai;

-- 1. 资源主表：与其他内置 Skill 一致的显式插入。
INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
SELECT 26,'BYAI','SKILL','ATOM','知识智采','网络内容采集技能。输入任意网站链接或应用名称，输出结构化的采集内容，支持网页信息抓取、应用数据提取和内容归档入库。适用于竞品信息收集、行业动态追踪、资料批量采集、内容聚合。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'smart-collection',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource WHERE resource_code = 'smart-collection'
);

-- 2. 内置 Skill 扩展记录：与 knowledge-collection 同为 inner / SYSTEM_BUILTIN。
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time)
SELECT r.resource_id,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE r.resource_code = 'smart-collection'
  AND NOT EXISTS (
      SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
  );

-- 3. 运行期技能快照，字段构成与内置 Skill 批量 UPDATE 保持一致。
UPDATE byai.ss_res_ext_skill e
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
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_code = 'smart-collection';

-- 4. 补充 smart-collection 到内置 Skill 清单，已存在同名 skillCode 时不重复追加。
UPDATE byai.byai_system_config c
SET param_value = left(rtrim(c.param_value), char_length(rtrim(c.param_value)) - 1)
    || ',{"skillName":"smart-collection","skillCode":"smart-collection","skillDescZh":"编排跨互联网与企业平台的知识采集，统一采集产物协议、后处理及知识库入库或知识整理。","skillDescEn":"Orchestrate knowledge collection across public internet and enterprise platforms, including canonical artifacts, post-processing, and knowledge-base ingestion or organization."}]'
WHERE c.param_code = 'OPENCLAW_BUNDLED_SKILLS'
  AND regexp_replace(c.param_value, '\s', '', 'g')
      NOT LIKE '%"skillCode":"smart-collection"%';
