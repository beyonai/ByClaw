-- V0.3.2 增量数据：回填连接器凭证生命周期、补齐历史配置，并修复内置 Skill 资源状态
--
-- 背景：V0.3.1 把「知识采集」资源从执行器 bycli 改名为编排 Skill knowledge-collection，
-- 并另建独立的 byCLI 执行器资源。部分环境只执行了该版本的配置段（OPENCLAW_BUNDLED_SKILLS），
-- 资源段未执行，且 .applied 已记录 V0.3.1，脚本不会再重放，导致：
--   * knowledge-collection 资源始终不存在；
--   * resource_code = 'bycli' 同时存在编排行（resource_name = '知识采集'）与执行器行
--     （resource_name = 'byCLI'），resource_code 语义重复。
--
-- V0.3.1 资源段的两个脆弱点，本版本一并规避：
--   1. bycli 执行器 INSERT 的守卫是 NOT EXISTS(resource_code = 'bycli')，与前面的改名语句
--      顺序相关——改名若未生效，编排行仍占用 'bycli'，执行器永远插不进来。
--      本版本改为按 resource_name 区分两种角色，任一语句单独重放都能收敛。
--   2. 改名仅按 resource_name 匹配。本版本额外加 knowledge-collection 不存在的前置判断，
--      避免已正确落库的环境被二次改名。
--
-- 终态与全新初始化脚本一致：编排 Skill = knowledge-collection / '知识采集'，
-- 执行器 Skill = bycli / 'byCLI'。全部语句带存在性判断，可重复重放。
-- 同时补齐缺失的 DevLoop 环节抽取提示词，并清理已下线的 doc-tagger Skill。
-- 本脚本不会删除 knowledge-collection 或 bycli 资源，仅改名、补齐与刷新快照。

SET search_path TO byai;

-- 1. 回填连接器授权生命周期数据。DDL 已为新增状态字段提供非空默认值。
UPDATE byai.byai_connector_auth
SET access_expire_time = expire_time
WHERE access_expire_time IS NULL
  AND expire_time IS NOT NULL;

UPDATE byai.byai_connector_auth AS auth
SET credential_state = COALESCE(auth.credential_state, 'UNKNOWN'),
    renewal_mode = CASE info.provider_code
        WHEN 'dws-dingtalk' THEN 'REFRESH_TOKEN'
        WHEN 'lark-cli' THEN 'REFRESH_TOKEN'
        WHEN 'wecom-cli' THEN 'PROBE_ONLY'
        ELSE COALESCE(auth.renewal_mode, 'NONE')
    END
FROM byai.byai_connector_info AS info
WHERE info.connector_id = auth.connector_id
  AND (
      auth.credential_state IS NULL
      OR auth.renewal_mode IS NULL
      OR (info.provider_code IN ('dws-dingtalk', 'lark-cli') AND auth.renewal_mode <> 'REFRESH_TOKEN')
      OR (info.provider_code = 'wecom-cli' AND auth.renewal_mode <> 'PROBE_ONLY')
  );

UPDATE byai.byai_connector_auth
SET credential_state = COALESCE(credential_state, 'UNKNOWN'),
    renewal_mode = COALESCE(renewal_mode, 'NONE')
WHERE credential_state IS NULL OR renewal_mode IS NULL;

-- 2. 补齐研发闭环环节抽取提示词。已有配置可能经过在线调整，因此仅在缺失时插入。
INSERT INTO byai.byai_system_config (
    param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc
)
SELECT nextval('byai.seq_any_table'),
       'txt',
       'DEVLOOP_PHASE_EXTRACT_PROMPT',
       '研发任务环节抽取提示词',
       'DEVLOOP_PHASE_EXTRACT_PROMPT',
       '你是研发流程分析助手。下面是一个开发任务的会话转录，请判断该任务在标准研发流水线上的进展。

## 研发环节（固定顺序）
issue（需求来源）→ req（需求分析）→ design（方案设计）→ coder（编码）→ reviewer（代码审查）→ tester（测试）→ pr（提交PR）

## 会话转录
${transcript}

## 判定规则
- 为每个环节判定状态：pending（未开始）、running（进行中）、done（已完成/通过）、rejected（被打回）。
- 顺序流水线：若某后置环节已推进，其之前的环节通常视为 done。
- 若出现审查/测试不通过并要求返工，记为一次 kickback：from=被打回的环节，to=需返工的目标环节，round 从 1 递增，reason 简述原因。
- currentPhase 为当前最可能所处的环节 key；round 为当前轮次（无返工则为 1）。

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- phases 必须包含全部 7 个环节。key 只能取上述英文标识。
- 严格用如下结构：

{"currentPhase":"coder","round":1,"phases":[{"key":"issue","status":"done"},{"key":"req","status":"done"},{"key":"design","status":"done"},{"key":"coder","status":"running"},{"key":"reviewer","status":"pending"},{"key":"tester","status":"pending"},{"key":"pr","status":"pending"}],"kickbacks":[]}',
       '研发闭环环节抽取提示词，占位符 ${transcript}，要求模型返回环节状态JSON'
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.byai_system_config
    WHERE param_code = 'DEVLOOP_PHASE_EXTRACT_PROMPT'
);

-- 3. 按业务编码清理已下线的 doc-tagger Skill，先删除依赖记录再删除资源。
DELETE FROM byai.au_privilege_grant
WHERE grant_obj_id IN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'doc-tagger'
);

DELETE FROM byai.ss_res_ext_skill
WHERE resource_id IN (
    SELECT resource_id
    FROM byai.ss_resource
    WHERE resource_code = 'doc-tagger'
);

DELETE FROM byai.ss_resource
WHERE resource_code = 'doc-tagger';

-- 4. 把仍绑定执行器 code 的编排资源改名为 knowledge-collection。
--    仅命中 resource_name = '知识采集' 的那一行，不影响 resource_name = 'byCLI' 的执行器行。
UPDATE byai.ss_resource
SET resource_code = 'knowledge-collection',
    update_time = CURRENT_TIMESTAMP
WHERE resource_name = '知识采集'
  AND resource_code = 'bycli'
  AND NOT EXISTS (
      SELECT 1 FROM byai.ss_resource WHERE resource_code = 'knowledge-collection'
  );

-- 5. 改名后仍缺失时（环境从未播种过该编排资源），按内置 Skill 范式显式插入。
--    resource_id 由序列生成，避免与种子保留区固定 ID 冲突。
INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
SELECT nextval('byai.seq_any_table'),'BYAI','SKILL','ATOM','知识采集','网络内容采集技能。输入任意网站链接或应用名称，输出结构化的采集内容，支持网页信息抓取、应用数据提取和内容归档入库。适用于竞品信息收集、行业动态追踪、资料批量采集、内容聚合。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'knowledge-collection',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource WHERE resource_code = 'knowledge-collection'
);

-- 6. 补齐 byCLI 执行器资源。守卫按 resource_name 判断，不受编排行是否已改名影响。
INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
SELECT nextval('byai.seq_any_table'),'BYAI','SKILL','ATOM','byCLI','通过浏览器与 Adapter 执行网站操作、复用或维护适配器，并返回采集结果。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'bycli',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE'
WHERE NOT EXISTS (
    SELECT 1 FROM byai.ss_resource
    WHERE resource_code = 'bycli' AND resource_name = 'byCLI'
);

-- 7. 为两个资源补齐内置 Skill 扩展记录。
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time)
SELECT r.resource_id,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE r.resource_code IN ('knowledge-collection','bycli')
  AND NOT EXISTS (
      SELECT 1 FROM byai.ss_res_ext_skill e WHERE e.resource_id = r.resource_id
  );

-- 8. 刷新运行期技能快照，清除 target_content 里残留的旧 resourceCode。
--    字段构成与内置 Skill 批量 UPDATE 保持一致。
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
  AND r.resource_code IN ('knowledge-collection','bycli');
