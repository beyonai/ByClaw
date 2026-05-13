package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudLoginType;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScript;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptScenario;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptStep;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptTemplate;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudTargetScript;
import com.iwhalecloud.byai.manager.entity.datacloud.LoginTypeConfig;
import com.iwhalecloud.byai.manager.entity.datacloud.SyncAuthConfig;
import com.iwhalecloud.byai.manager.entity.datacloud.SyncDataCloudToolInfo;
import com.iwhalecloud.byai.manager.entity.datacloud.SyncToolInputSchema;
import com.iwhalecloud.byai.manager.entity.datacloud.SyncToolProperties;
import com.iwhalecloud.byai.manager.domain.datacloud.enums.DataCloudPublishStatusEnum;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudLoginTypeMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptScenarioMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptStepMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptTemplateMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudTargetScriptMapper;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.vo.datacloud.DatacloudScriptVo;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptQueryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioConfigDTO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.config.es.ElasticsearchOperations;
import com.iwhalecloud.byai.common.config.es.ElasticsearchOperationsFactory;
import com.iwhalecloud.byai.common.config.es.EsConfig;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

/**
 * 脚本采集管理服务
 * 
 * @author system
 * @date 2025-01-15
 */
@Slf4j
@Service
public class DatacloudScriptService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptService.class);


    @Autowired
    private DatacloudScriptMapper datacloudScriptMapper;

    @Autowired
    private DatacloudScriptScenarioMapper datacloudScenarioMapper;

    @Autowired
    private DatacloudLoginTypeMapper datacloudLoginTypeMapper;

    @Autowired
    private DatacloudScriptStepMapper datacloudScriptConfigMapper;

    @Autowired
    private DatacloudTargetScriptMapper datacloudTargetScriptMapper;

    @Autowired
    private DatacloudScriptStepMapper datacloudScriptStepMapper;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private DatacloudScriptTemplateMapper datacloudScriptTemplateMapper;

    @Autowired
    private DatacloudScriptScenarioMapper datacloudScriptScenarioMapper;

    private static final String DATA_CLOUD_TOOL_INDEX = "tools_registry_test";

    /**
     * 分页查询脚本列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryScriptList(DatacloudScriptQueryDTO query) {
        try {
            Page<DatacloudScript> page = new Page<>(query.getPageNum(), query.getPageSize());
            LambdaQueryWrapper<DatacloudScript> wrapper = new LambdaQueryWrapper<>();
            wrapper.eq(DatacloudScript::getEnterpriseId, CurrentUserHolder.getEnterpriseId());
            wrapper.eq(DatacloudScript::getCreatorId, CurrentUserHolder.getCurrentUserId());
            wrapper.eq(DatacloudScript::getScenarioId, query.getScenarioId());
            List<DatacloudScript> list = datacloudScriptMapper.selectList(wrapper);
            page.setRecords(list);
            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询脚本列表失败", e);
            return ResponseUtil.fail("查询脚本列表失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询脚本详情
     *
     * @return 脚本详情
     */
    public ResponseUtil queryScriptDesc(DatacloudScriptQueryDTO datacloudScriptQueryDTO) {
        try {
            DatacloudScript script = datacloudScriptMapper.selectById(datacloudScriptQueryDTO.getScriptId());
            if (script == null) {
                return ResponseUtil.fail("脚本不存在");
            }

            DatacloudScriptScenario scriptScenario = datacloudScenarioMapper.selectById(script.getScenarioId());
            HashMap<String, Object> resultMap = new HashMap<>(4);
            resultMap.put("script", script);
            resultMap.put("scenario", scriptScenario);
            resultMap.put("loginInfo", datacloudLoginTypeMapper.selectById(scriptScenario.getLoginTypeId()));

            return ResponseUtil.success(resultMap);
        }
        catch (Exception e) {
            logger.error("查询脚本详情失败", e);
            return ResponseUtil.fail("查询脚本详情失败：" + e.getMessage());
        }
    }

    /**
     * 新增脚本
     * 
     * @param dto 脚本信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addScript(DatacloudScriptDTO dto) {
        try {
            dto.setCreatorId(CurrentUserHolder.getCurrentUserId());
            dto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());

            DatacloudScript script = new DatacloudScript();
            BeanUtils.copyProperties(dto, script);

            // 设置主键ID和默认值
            script.setScriptId(IdUtil.getSnowflakeNextId());
            script.setCreateTime(new Date());
            script.setVersion(1);
            script.setStepCount(0);

            // 设置默认状态
            if (script.getScriptStatus() == null) {
                script.setScriptStatus("draft");
            }

            int result = datacloudScriptMapper.insert(script);
            if (result > 0) {
                logger.info("新增脚本成功，脚本ID：{}", script.getScriptId());
                DatacloudScriptVo datacloudScriptVo = DatacloudScriptVo.builder().scripId(script.getScriptId()).build();
                return ResponseUtil.success(datacloudScriptVo);
            }
            else {
                return ResponseUtil.fail("新增脚本失败");
            }
        }
        catch (Exception e) {
            logger.error("新增脚本失败", e);
            return ResponseUtil.fail("新增脚本失败：" + e.getMessage());
        }
    }

    /**
     * 更新脚本
     * 
     * @param dto 脚本信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateScript(DatacloudScriptDTO dto) {
        try {
            dto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
            dto.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            // 检查脚本是否存在
            DatacloudScript existingScript = datacloudScriptMapper.selectById(dto.getScriptId());
            if (existingScript == null) {
                return ResponseUtil.fail("脚本不存在");
            }

            DatacloudScript script = new DatacloudScript();
            BeanUtils.copyProperties(dto, script);
            script.setUpdateTime(new Date());

            int result = datacloudScriptMapper.updateById(script);
            if (result > 0) {
                logger.info("更新脚本成功，脚本ID：{}", script.getScriptId());
                return ResponseUtil.success("更新脚本成功");
            }
            else {
                return ResponseUtil.fail("更新脚本失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本失败", e);
            return ResponseUtil.fail("更新脚本失败：" + e.getMessage());
        }
    }

    /**
     * 删除脚本
     * 
     * @param scriptId 脚本ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteScript(Long scriptId) {
        try {
            // 检查脚本是否存在
            DatacloudScript script = datacloudScriptMapper.selectById(scriptId);
            if (script == null) {
                return ResponseUtil.fail("脚本不存在");
            }

            int result = datacloudScriptMapper.deleteById(scriptId);
            if (result > 0) {
                logger.info("删除脚本成功，脚本ID：{}", scriptId);
                return ResponseUtil.success("删除脚本成功");
            }
            else {
                return ResponseUtil.fail("删除脚本失败");
            }
        }
        catch (Exception e) {
            logger.error("删除脚本失败", e);
            return ResponseUtil.fail("删除脚本失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除脚本
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteScripts(DatacloudScriptBatchDeleteQO qo) {
        try {
            List<Long> scriptIds = qo.getScriptIds();
            Long enterpriseId = CurrentUserHolder.getEnterpriseId();

            if (scriptIds == null || scriptIds.isEmpty()) {
                return ResponseUtil.fail("请选择要删除的脚本");
            }

            // 使用批量删除方法
            int result = datacloudScriptMapper.batchDeleteScripts(scriptIds, enterpriseId);
            // 删除脚本配置
            LambdaQueryWrapper<DatacloudScriptStep> configQueryWrapper = new LambdaQueryWrapper<>();
            configQueryWrapper.in(DatacloudScriptStep::getScriptId, scriptIds);
            datacloudScriptConfigMapper.delete(configQueryWrapper);
            // 删除脚本目标
            LambdaQueryWrapper<DatacloudTargetScript> targetScriptQueryWrapper = new LambdaQueryWrapper<>();
            targetScriptQueryWrapper.in(DatacloudTargetScript::getScriptId, scriptIds);
            datacloudTargetScriptMapper.delete(targetScriptQueryWrapper);

            // 同步删除ES的工具信息

            ElasticsearchOperations elasticsearchOperations = null;
            try {
                EsConfig esConfig = getEsConfig();
                if (esConfig != null) {
                    // 同步删除es的文档信息（统一使用ES8版本）
                    elasticsearchOperations = ElasticsearchOperationsFactory.getOperations(
                        esConfig.getHosts(), esConfig.getUsername(), esConfig.getPassword());

                    String indexName = getDataCloudToolIndex();
                    if (!elasticsearchOperations.indexExists(indexName)) {
                        log.info("DATA_CLOUD_TOOL_INDEX 索引不存在，创建索引: {}", indexName);
                        elasticsearchOperations.createIndex(indexName, null);
                    }
                    for (Long scriptId : scriptIds) {
                        elasticsearchOperations.delete(indexName, scriptId.toString());
                    }
                }
            }
            catch (Exception e) {
                // 不抛出异常，避免影响主业务流程
                logger.error("批量删除脚本失败，删除ES文档失败", e);
            }
            finally {
                if (elasticsearchOperations != null) {
                    ElasticsearchOperationsFactory.closeAll();
                }
            }

            if (result > 0) {
                logger.info("批量删除脚本成功，共删除 {} 个脚本", result);
                return ResponseUtil.success("批量删除成功，共删除 " + result + " 个脚本");
            }
            else {
                return ResponseUtil.fail("批量删除脚本失败");
            }
        }
        catch (Exception e) {
            logger.error("批量删除脚本失败", e);
            return ResponseUtil.fail("批量删除脚本失败：" + e.getMessage());
        }
    }

    /**
     * 复制脚本
     * 
     * @param scriptId 原脚本ID
     * @param newScriptName 新脚本名称
     * @param creatorId 创建人ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil copyScript(Long scriptId, String newScriptName, Long creatorId) {
        try {
            // 查询原脚本
            DatacloudScript originalScript = datacloudScriptMapper.selectById(scriptId);
            if (originalScript == null) {
                return ResponseUtil.fail("原脚本不存在");
            }

            // 创建新脚本
            DatacloudScript newScript = new DatacloudScript();
            BeanUtils.copyProperties(originalScript, newScript);

            newScript.setScriptId(IdUtil.getSnowflakeNextId());
            newScript.setScriptName(newScriptName);
            newScript.setCreatorId(creatorId);
            newScript.setCreateTime(new Date());
            newScript.setUpdateBy(null);
            newScript.setUpdateTime(null);
            newScript.setVersion(1);
            newScript.setScriptStatus("draft");

            int result = datacloudScriptMapper.insert(newScript);
            if (result > 0) {
                logger.info("复制脚本成功，新脚本ID：{}", newScript.getScriptId());
                return ResponseUtil.success("复制脚本成功");
            }
            else {
                return ResponseUtil.fail("复制脚本失败");
            }
        }
        catch (Exception e) {
            logger.error("复制脚本失败", e);
            return ResponseUtil.fail("复制脚本失败：" + e.getMessage());
        }
    }

    /**
     * 查询热门脚本列表
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 热门脚本列表
     */
    public ResponseUtil queryPopularScripts(Long enterpriseId, Integer limit) {
        try {
            List<DatacloudScriptDTO> list = datacloudScriptMapper.selectPopularScripts(enterpriseId, limit);
            return ResponseUtil.success(list);
        }
        catch (Exception e) {
            logger.error("查询热门脚本列表失败", e);
            return ResponseUtil.fail("查询热门脚本列表失败：" + e.getMessage());
        }
    }

    /**
     * 查询最近创建的脚本列表
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近创建的脚本列表
     */
    public ResponseUtil queryRecentScripts(Long enterpriseId, Integer limit) {
        try {
            List<DatacloudScriptDTO> list = datacloudScriptMapper.selectRecentScripts(enterpriseId, limit);
            return ResponseUtil.success(list);
        }
        catch (Exception e) {
            logger.error("查询最近创建的脚本列表失败", e);
            return ResponseUtil.fail("查询最近创建的脚本列表失败：" + e.getMessage());
        }
    }

    /**
     * 查询脚本统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    public ResponseUtil queryScriptStatistics(Long enterpriseId) {
        try {
            Map<String, Object> statistics = datacloudScriptMapper.selectScriptStatistics(enterpriseId);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询脚本统计信息失败", e);
            return ResponseUtil.fail("查询脚本统计信息失败：" + e.getMessage());
        }
    }

    public ResponseUtil publishScript(DatacloudScriptQueryDTO datacloudScriptQueryDTO) {
        try {
            DatacloudScript datacloudScript = datacloudScriptMapper.selectById(datacloudScriptQueryDTO.getScriptId());
            if (datacloudScript != null) {
                datacloudScript.setPublishStatus(DataCloudPublishStatusEnum.PUBLISHED.getValue());
                datacloudScript.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                datacloudScript.setUpdateTime(new Date());
                datacloudScriptMapper.updateById(datacloudScript);

                // 先查询是否保存了脚本配置，有则同步ES
                syncDataCloudToolToEs(datacloudScript.getScriptId());
            }
            DatacloudScriptVo datacloudScriptVo = DatacloudScriptVo.builder().scripId(datacloudScript.getScriptId())
                .build();
            return ResponseUtil.success(datacloudScriptVo);
        }
        catch (Exception e) {
            logger.error("发布脚本场景失败", e);
            return ResponseUtil.fail("发布脚本场景失败：" + e.getMessage());
        }
    }

    public ResponseUtil unPublishScript(DatacloudScriptQueryDTO datacloudScriptQueryDTO) {
        try {
            DatacloudScript datacloudScript = datacloudScriptMapper.selectById(datacloudScriptQueryDTO.getScriptId());
            if (datacloudScript != null) {
                datacloudScript.setPublishStatus(DataCloudPublishStatusEnum.UNPUBLISHED.getValue());
                datacloudScript.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                datacloudScript.setUpdateTime(new Date());
                datacloudScriptMapper.updateById(datacloudScript);

                // 删除ES的文档
                deleteDataCloudToolFromEs(datacloudScript.getScriptId());
            }
            DatacloudScriptVo datacloudScriptVo = DatacloudScriptVo.builder().scripId(datacloudScript.getScriptId())
                .build();
            return ResponseUtil.success(datacloudScriptVo);
        }
        catch (Exception e) {
            logger.error("取消发布脚本场景失败", e);
            return ResponseUtil.fail("取消发布脚本场景失败：" + e.getMessage());
        }
    }

    private void deleteDataCloudToolFromEs(Long scriptId) {
        // 删除ES的文档
        ElasticsearchOperations elasticsearchOperations = null;
        EsConfig esConfig = getEsConfig();

        try {
            if (esConfig != null) {
                // 同步tool信息到ES（统一使用ES8版本）
                elasticsearchOperations = ElasticsearchOperationsFactory.getOperations(
                    esConfig.getHosts(), esConfig.getUsername(), esConfig.getPassword());

                String indexName = getDataCloudToolIndex();
                if (elasticsearchOperations.indexExists(indexName)) {
                    log.info("DATA_CLOUD_TOOL_INDEX 索引: {} 存在，删除工具ID: {} 的文档", indexName, scriptId);
                    elasticsearchOperations.delete(indexName, String.valueOf(scriptId));
                }
            }
        }
        catch (Exception e) {
            logger.error("DATA_CLOUD_TOOL_INDEX 从ES删除工具，工具ID: {}, 异常信息: {}", scriptId, e.getMessage(), e);
            // 不抛出异常，避免影响主业务流程
        }
        finally {
            if (elasticsearchOperations != null) {
                ElasticsearchOperationsFactory.closeAll();
            }
        }
    }

    private void syncDataCloudToolToEs(Long scriptId) {
        DatacloudScript script = datacloudScriptMapper.selectById(scriptId);
        Long scenarioId = script.getScenarioId();
        DatacloudScriptScenario scenario = datacloudScriptScenarioMapper.selectById(scenarioId);
        Long loginTypeId = scenario.getLoginTypeId();
        DatacloudLoginType loginType = datacloudLoginTypeMapper.selectById(loginTypeId);

        // 构建同步给datacloud mcp服务的工具信息
        SyncDataCloudToolInfo syncDataCloudToolInfo = new SyncDataCloudToolInfo();
        syncDataCloudToolInfo.setViewId(script.getViewId());
        syncDataCloudToolInfo.setTool_id(script.getScriptId());
        // 生成英文工具标识符，避免使用拼音转换
        syncDataCloudToolInfo.setName(generateToolName(script.getScriptName(), script.getScriptId()));
        syncDataCloudToolInfo.setUrl(scenario.getTargetUrl());
        syncDataCloudToolInfo.setDescription(script.getScriptDescription());
        if (loginType != null) {
            LoginTypeConfig loginTypeConfig = JSON.parseObject(loginType.getLoginTypeConfig(), LoginTypeConfig.class);
            SyncAuthConfig syncAuthConfig = new SyncAuthConfig();
            syncAuthConfig.setAuth_type(loginTypeConfig.getAuthType());
            syncAuthConfig.setLogin_url(loginTypeConfig.getLoginUrl());
            syncAuthConfig.setCall_back_url(loginTypeConfig.getCallBackUrl());
            syncAuthConfig.setParam_position(loginTypeConfig.getParamPosition());
            syncAuthConfig.setAuth_params(loginTypeConfig.getAuthParams());
            syncDataCloudToolInfo.setAuth_config(syncAuthConfig);
        }
        // 设置目标选择器
        List<DatacloudTargetScript> targetScriptList = datacloudTargetScriptMapper.selectList(
            new LambdaQueryWrapper<DatacloudTargetScript>().eq(DatacloudTargetScript::getScriptId, scriptId));
        if (CollectionUtils.isNotEmpty(targetScriptList)) {
            DatacloudTargetScript datacloudTargetScript = targetScriptList.get(0);
            String targetSelector = datacloudTargetScript.getTargetSelector();
            syncDataCloudToolInfo.setOutput_selector(targetSelector);
        }

        LambdaQueryWrapper<DatacloudScriptStep> queryWrapper = Wrappers.lambdaQuery(DatacloudScriptStep.class)
            .eq(DatacloudScriptStep::getScriptId, scriptId).orderByAsc(DatacloudScriptStep::getStepOrder);
        List<DatacloudScriptStep> datacloudScriptStepList = datacloudScriptStepMapper.selectList(queryWrapper);

        // 生成code属性
        String generatedCode = generateCodeFromScriptSteps(datacloudScriptStepList);
        syncDataCloudToolInfo.setCode(generatedCode);

        // 根据metaInfos生成input_schema属性
        SyncToolInputSchema inputSchema = generateInputSchemaFromMetaInfos(datacloudScriptStepList);
        syncDataCloudToolInfo.setInput_schema(inputSchema);
        String toolInfo = JSON.toJSONString(syncDataCloudToolInfo);

        ElasticsearchOperations elasticsearchOperations = null;
        EsConfig esConfig = getEsConfig();

        try {
            if (esConfig != null) {
                // 同步tool信息到ES（统一使用ES8版本）
                elasticsearchOperations = ElasticsearchOperationsFactory.getOperations(
                    esConfig.getHosts(), esConfig.getUsername(), esConfig.getPassword());
                Map<String, Object> toolInfoMap = JSON.parseObject(toolInfo, Map.class);
                String indexName = getDataCloudToolIndex();
                if (!elasticsearchOperations.indexExists(indexName)) {
                    log.info("DATA_CLOUD_TOOL_INDEX 索引不存在，创建索引: {}", indexName);
                    elasticsearchOperations.createIndex(indexName, null);
                }
                // 同步到ES的逻辑
                log.info("DATA_CLOUD_TOOL同步工具到ES index:{} 工具信息: {}", indexName, toolInfo);
                // 使用index方法替代update方法，实现upsert效果（存在则更新，不存在则插入）
                elasticsearchOperations.index(indexName, String.valueOf(syncDataCloudToolInfo.getTool_id()),
                    toolInfoMap);
            }
        }
        catch (Exception e) {
            logger.error("DATA_CLOUD_TOOL_INDEX 同步工具到ES异常，工具ID: {}, 异常信息: {}", syncDataCloudToolInfo.getTool_id(),
                e.getMessage(), e);
            // 不抛出异常，避免影响主业务流程
        }
        finally {
            if (elasticsearchOperations != null) {
                ElasticsearchOperationsFactory.closeAll();
            }
        }
    }

    /**
     * 根据脚本步骤的metaInfos生成input_schema
     *
     * @param scriptStepList 脚本步骤列表
     * @return 生成的input_schema对象
     */
    private SyncToolInputSchema generateInputSchemaFromMetaInfos(List<DatacloudScriptStep> scriptStepList) {
        SyncToolInputSchema inputSchema = new SyncToolInputSchema();
        inputSchema.setType("object");

        // 收集所有metaInfos
        List<DatacloudScriptScenarioConfigDTO.MetaInfoDTO> allMetaInfos = new ArrayList<>();
        HashSet<String> requiredFields = new HashSet<>();

        if (CollectionUtils.isNotEmpty(scriptStepList)) {
            for (DatacloudScriptStep step : scriptStepList) {
                String metaInfos = step.getMetaInfos();
                if (StringUtils.isNotBlank(metaInfos)) {
                    List<DatacloudScriptScenarioConfigDTO.MetaInfoDTO> metaInfoList = JSONArray.parseArray(metaInfos,
                        DatacloudScriptScenarioConfigDTO.MetaInfoDTO.class);
                    if (CollectionUtils.isNotEmpty(metaInfoList)) {
                        for (DatacloudScriptScenarioConfigDTO.MetaInfoDTO metaInfo : metaInfoList) {
                            allMetaInfos.add(metaInfo);
                            // 如果字段是必填的，添加到required列表
                            if (metaInfo.getRequired() != null && metaInfo.getRequired()) {
                                requiredFields.add(metaInfo.getFieldCode());
                            }
                        }
                    }
                }
            }
        }
        if (CollectionUtils.isNotEmpty(requiredFields)) {
            // 设置required字段
            inputSchema.setRequired(new ArrayList<>(requiredFields));
        }

        if (CollectionUtils.isNotEmpty(allMetaInfos)) {
            Map<String, SyncToolProperties> propertyMap = new HashMap<>();

            // 构建properties
            for (DatacloudScriptScenarioConfigDTO.MetaInfoDTO metaInfo : allMetaInfos) {

                SyncToolProperties properties = new SyncToolProperties();
                properties.setType(convertFieldTypeToSchemaType(metaInfo.getFieldType()));
                properties.setDescription(metaInfo.getDesc());
                properties.setExample(metaInfo.getExample());
                propertyMap.put(metaInfo.getFieldCode(), properties);
            }

            inputSchema.setProperties(propertyMap);
        }

        return inputSchema;
    }

    /**
     * 将字段类型转换为JSON Schema类型
     *
     * @param fieldType 字段类型
     * @return JSON Schema类型
     */
    private String convertFieldTypeToSchemaType(String fieldType) {
        if (StringUtils.isBlank(fieldType)) {
            return "string";
        }

        switch (fieldType.toLowerCase()) {
            case "string":
                return "string";
            case "integer":
            case "int":
                return "integer";
            case "number":
            case "double":
            case "float":
                return "number";
            case "boolean":
            case "bool":
                return "boolean";
            case "array":
                return "array";
            case "object":
                return "object";
            default:
                return "string";
        }
    }

    /**
     * 根据脚本步骤列表生成代码
     *
     * @param scriptStepList 脚本步骤列表
     * @return 生成的代码字符串
     */
    private String generateCodeFromScriptSteps(List<DatacloudScriptStep> scriptStepList) {
        if (CollectionUtils.isEmpty(scriptStepList)) {
            return "";
        }

        StringBuilder codeBuilder = new StringBuilder();

        for (DatacloudScriptStep step : scriptStepList) {
            // 处理每个步骤的metaInfos和scriptContent
            if (step.getScriptContent() != null || step.getTemplateId() != null) {
                // 获取不为空的脚本内容（优先使用python，其次nodejs）
                String scriptContent = getNonEmptyScriptContent(step);
                String metaInfos = step.getMetaInfos();

                if (StringUtils.isNotBlank(scriptContent)) {
                    List<DatacloudScriptScenarioConfigDTO.MetaInfoDTO> metaInfoList = new ArrayList<>();
                    if (StringUtils.isNotBlank(metaInfos)) {
                        metaInfoList = JSONArray.parseArray(metaInfos,
                            DatacloudScriptScenarioConfigDTO.MetaInfoDTO.class);
                    }
                    // 如果有metaInfos，为每个metaInfo生成if条件
                    if (CollectionUtils.isNotEmpty(metaInfoList)) {
                        for (DatacloudScriptScenarioConfigDTO.MetaInfoDTO metaInfo : metaInfoList) {
                            String fieldCode = metaInfo.getFieldCode();
                            String fieldName = metaInfo.getFieldName();
                            if (StringUtils.isNotBlank(fieldCode)) {
                                // 生成if条件
                                codeBuilder.append("if ").append(fieldCode).append(":\n");

                                // 处理脚本内容，将${fieldCode}替换为实际的变量名
                                scriptContent = scriptContent.replace("${fieldCode}", fieldCode);
                                scriptContent = scriptContent.replace("${fieldName}", fieldName);

                                String processedScript = scriptContent;

                                // 将脚本内容按行分割并添加缩进
                                String[] lines = processedScript.split("\n");
                                for (String line : lines) {
                                    if (StringUtils.isNotBlank(line)) {
                                        codeBuilder.append("    ").append(line).append("\n");
                                    }
                                }
                                codeBuilder.append("\n");
                            }
                        }
                    }
                    else {
                        // 没有metaInfos的步骤，直接添加脚本内容（如查询按钮）
                        String[] lines = scriptContent.split("\n");
                        for (String line : lines) {
                            if (StringUtils.isNotBlank(line)) {
                                codeBuilder.append(line).append("\n");
                            }
                        }
                        codeBuilder.append("\n");
                    }
                }
            }
        }

        return codeBuilder.toString();
    }

    /**
     * 获取不为空的脚本内容 优先使用python，其次nodejs
     * 
     * @param step 脚本内容DTO
     * @return 不为空的脚本内容
     */
    private String getNonEmptyScriptContent(DatacloudScriptStep step) {
        String scriptContentJson = step.getScriptContent();
        Long templateId = step.getTemplateId();
        if (StringUtils.isNotBlank(scriptContentJson)) {
            DatacloudScriptScenarioConfigDTO.ScriptContentDTO scriptContent = JSON.parseObject(scriptContentJson,
                DatacloudScriptScenarioConfigDTO.ScriptContentDTO.class);
            if (StringUtils.isBlank(scriptContent.getPython())) {
                // 如果用户没有自己写脚本，则获取默认脚本
                DatacloudScriptTemplate datacloudScriptTemplate = datacloudScriptTemplateMapper.selectById(templateId);
                if (datacloudScriptTemplate != null) {
                    return datacloudScriptTemplate.getPyTemplateContent();
                }
                return "";
            }

            // 优先使用python脚本
            if (StringUtils.isNotBlank(scriptContent.getPython())) {
                return scriptContent.getPython();
            }
        }
        return "";
    }

    /**
     * 处理脚本内容，将模板变量替换为实际变量名 并根据组件类型生成更符合示例的代码
     *
     * @param scriptContent 原始脚本内容
     * @param fieldCode 字段编码
     * @param metaInfo 元信息
     * @return 处理后的脚本内容
     */
    private String processScriptContent(String scriptContent, String fieldCode,
        DatacloudScriptScenarioConfigDTO.MetaInfoDTO metaInfo) {
        if (StringUtils.isBlank(scriptContent)) {
            return "";
        }

        StringBuilder processedScript = new StringBuilder();

        // 其他组件类型，使用原始脚本内容
        processedScript.append(scriptContent.replace("${" + fieldCode + "}", fieldCode));

        return processedScript.toString();
    }

    /**
     * 处理脚本内容，将模板变量替换为实际变量名（兼容旧方法）
     *
     * @param scriptContent 原始脚本内容
     * @param fieldCode 字段编码
     * @return 处理后的脚本内容
     */
    private String processScriptContent(String scriptContent, String fieldCode) {
        if (StringUtils.isBlank(scriptContent)) {
            return "";
        }

        // 将${fieldCode}替换为实际的变量名
        return scriptContent.replace("${" + fieldCode + "}", fieldCode);
    }

    /**
     * 生成工具名称 将中文脚本名称转换为符合MCP服务要求的英文标识符
     *
     * @param scriptName 脚本名称
     * @param scriptId 脚本ID
     * @return 英文工具标识符
     */
    private String generateToolName(String scriptName, Long scriptId) {
        if (scriptName == null || scriptName.trim().isEmpty()) {
            return "tool_" + scriptId;
        }

        // 移除特殊字符，只保留中文、英文字母、数字和下划线
        String cleanName = scriptName.replaceAll("[^\\u4e00-\\u9fa5a-zA-Z0-9_]", "_");

        // 如果包含中文字符，使用脚本ID作为标识符
        if (cleanName.matches(".*[\\u4e00-\\u9fa5].*")) {
            return "tool_" + scriptId;
        }

        // 如果已经是英文，转换为小写并确保以字母开头
        String result = cleanName.toLowerCase();
        if (!result.matches("^[a-z].*")) {
            result = "tool_" + result;
        }

        // 确保长度不超过50个字符
        if (result.length() > 50) {
            result = result.substring(0, 50);
        }

        return result;
    }

    private EsConfig getEsConfig() {
        String esConfig = systemConfigService.getStringParamValueByCode("ES_CONFIG");
        return StringUtil.isNotEmpty(esConfig) ? JSON.parseObject(esConfig, EsConfig.class) : null;
    }

    private String getDataCloudToolIndex() {
        String dataCloudToolIndex = systemConfigService.getStringParamValueByCode("DATA_CLOUD_TOOL_INDEX");
        return StringUtil.isNotEmpty(dataCloudToolIndex) ? dataCloudToolIndex : DATA_CLOUD_TOOL_INDEX;
    }
}
