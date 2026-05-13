package com.iwhalecloud.byai.manager.application.service.resource;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.feign.request.manager.McpServer;
import com.iwhalecloud.byai.common.feign.request.manager.OpenAiToolDto;
import com.iwhalecloud.byai.common.feign.request.manager.ResourceIdQo;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.manager.application.service.resource.build.AgentBuildService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpServer;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpServerMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.feign.request.conversation.AgentPrologueDto;
import com.iwhalecloud.byai.common.feign.request.conversation.RunConfig;
import com.iwhalecloud.byai.common.feign.request.python.CoreCompetency;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/10
 */
@Service
@Slf4j
public class AgentResourceService {

    private static final Logger logger = LoggerFactory.getLogger(AgentResourceService.class);


    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtMcpServerMapper ssResExtMcpserverMapper;

    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private AgentBuildService agentBuildService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    /**
     * 获取数字员工信息（优化版本）
     *
     * @param resourceIdQo 数字员工gid
     * @return AgentResourceChatInfoDto
     */
    public List<AgentResourceChatInfoDto> getAgentResourceInfo(ResourceIdQo resourceIdQo) {
        List<Long> resourceIds = resourceIdQo.getResourceIds();
        if (CollectionUtils.isEmpty(resourceIds)) {
            return new ArrayList<>();
        }

        try {
            // 1. 批量查询资源信息，避免N+1查询问题
            List<SsResource> ssResources = this.batchQueryResources(resourceIds, resourceIdQo.getResourceStatus());
            if (CollectionUtils.isEmpty(ssResources)) {
                log.debug("未找到任何资源信息 resourceIds: {}", resourceIds);
                return new ArrayList<>();
            }

            // 2. 批量查询扩展信息
            Map<Long, SsResExtDigEmployee> extEmployeeMap = batchQueryExtEmployees(resourceIds);

            // 3. 预解析prologue配置和批量查询模型信息
            Map<Long, AgentPrologueDto> prologueMap = batchParsePrologue(extEmployeeMap);
            Map<Long, ModelDto> modelMap = batchQueryModels(prologueMap);

            // 4. 构建结果
            List<AgentResourceChatInfoDto> agentResourceChatInfoDtoList = new ArrayList<>(ssResources.size());
            for (SsResource ssResource : ssResources) {

                Long resourceId = ssResource.getResourceId();
                SsResExtDigEmployee extEmployee = extEmployeeMap.get(resourceId);

                if (extEmployee == null) {
                    logger.error("当前数据员工找不到对应的扩展表ssResExtDigEmployee,resourceId={}", resourceId);
                    continue;
                }

                AgentResourceChatInfoDto agentResourceChatInfoDto = buildAgentResourceDtoOptimized(ssResource,
                    extEmployee, prologueMap.get(resourceId), modelMap);

                this.setRelInfoOptimizedWithPreloadedData(ssResource, agentResourceChatInfoDto);

                agentResourceChatInfoDtoList.add(agentResourceChatInfoDto);
            }

            log.debug("成功获取数字员工信息, 数量: {}, resourceIds: {}", agentResourceChatInfoDtoList.size(), resourceIds);
            return agentResourceChatInfoDtoList;

        }
        catch (Exception e) {
            log.error("获取数字员工信息失败, resourceIds: {}", resourceIds, e);
            throw new BaseException(I18nUtil.get("agent.resource.get.dig.employee.failed", e.getMessage()), e);
        }
    }

    /**
     * 批量查询资源信息（带缓存）
     */

    public List<SsResource> batchQueryResources(List<Long> resourceIds, Integer resourceStatus) {
        // 查询数字员工,只查询上架的
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        if (resourceStatus != null) {
            queryWrapper.in(SsResource::getResourceStatus, resourceStatus);
        }
        queryWrapper.in(SsResource::getResourceId, resourceIds);
        if (resourceStatus != null) {
            queryWrapper.eq(SsResource::getResourceStatus, resourceStatus);
        }
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 批量查询扩展信息（带缓存）
     */
    @Cacheable(value = "agentExtEmployees", key = "#resourceIds.size() + '_' + #resourceIds.toString()",
        unless = "#result.isEmpty()")
    public Map<Long, SsResExtDigEmployee> batchQueryExtEmployees(List<Long> resourceIds) {
        List<SsResExtDigEmployee> extEmployees = ssResExtDigEmployeeMapper.selectBatchIds(resourceIds);
        return extEmployees.stream().collect(Collectors.toMap(SsResExtDigEmployee::getResourceId, Function.identity()));
    }

    /**
     * 批量查询关联资源信息（带缓存）
     */
    private Map<String, List<Long>> buildRelResourceBizTypeMap(Long resourceId,
        Map<Long, List<Long>> resourceRelResourceMap, Map<Long, SsResource> resourceIdMap) {

        List<SsResourceRelDetail> ssResourceRelDetails = ssResourceRelDetailService.findByResourceId(resourceId);

        List<Long> allRelResourceIds = new ArrayList<>();
        for (SsResourceRelDetail ssResourceRelDetail : ssResourceRelDetails) {
            allRelResourceIds.add(ssResourceRelDetail.getRelResourceId());
            if (StringUtil.isEmpty(ssResourceRelDetail.getRelResourceInfo())) {
                continue;
            }
            RelResourceInfo relResourceInfo = JSON.parseObject(ssResourceRelDetail.getRelResourceInfo(),
                RelResourceInfo.class);
            List<String> activeResourceIds = relResourceInfo.getActiveResourceIds();
            if (CollectionUtils.isEmpty(activeResourceIds)) {
                continue;
            }
            resourceRelResourceMap.put(ssResourceRelDetail.getRelResourceId(),
                activeResourceIds.stream().map(Long::valueOf).collect(Collectors.toList()));
        }
        if (allRelResourceIds.isEmpty()) {
            return null;
        }

        // 批量查询关联资源；默认个人资源允许未上架状态，以便默认个人助理能使用默认个人知识库。
        LambdaQueryWrapper<SsResource> allRelQueryWrapper = new LambdaQueryWrapper<>();
        allRelQueryWrapper.and(wrapper -> wrapper.in(SsResource::getResourceStatus, ResourceStatus.LIST.getNum())
            .or().eq(SsResource::getOwnerType, OwnerType.PERSONAL_DEFAULT));
        allRelQueryWrapper.in(SsResource::getResourceId, allRelResourceIds);

        List<SsResource> relResources = ssResourceMapper.selectList(allRelQueryWrapper);

        // 遍历资源列表，按resourceBizType分组
        Map<String, List<Long>> relResourceMap = new HashMap<>();
        for (SsResource resource : relResources) {
            String resourceBizType = resource.getResourceBizType();
            // 若当前类型在Map中不存在，则初始化列表
            if (!relResourceMap.containsKey(resourceBizType)) {
                relResourceMap.put(resourceBizType, new ArrayList<>(10));
            }
            // 将资源ID添加到对应类型的列表中
            relResourceMap.get(resourceBizType).add(resource.getResourceId());
            resourceIdMap.put(resource.getResourceId(), resource);
        }

        return relResourceMap;
    }

    /**
     * 批量解析prologue配置（带缓存）
     */
    @Cacheable(value = "agentPrologue", key = "#extEmployeeMap.size() + '_' + #extEmployeeMap.keySet().toString()",
        unless = "#result.isEmpty()")
    public Map<Long, AgentPrologueDto> batchParsePrologue(Map<Long, SsResExtDigEmployee> extEmployeeMap) {
        Map<Long, AgentPrologueDto> prologueMap = new HashMap<>();

        for (Map.Entry<Long, SsResExtDigEmployee> entry : extEmployeeMap.entrySet()) {
            Long resourceId = entry.getKey();
            SsResExtDigEmployee extEmployee = entry.getValue();

            String prologue = extEmployee.getPrologue();
            if (StringUtil.isNotEmpty(prologue) && !"null".equalsIgnoreCase(prologue)) {
                try {
                    AgentPrologueDto agentPrologueDto = JSON.parseObject(prologue, AgentPrologueDto.class);
                    prologueMap.put(resourceId, agentPrologueDto);
                }
                catch (Exception e) {
                    logger.error("解析prologue配置失败, resourceId={}, prologue={}", resourceId, prologue, e);
                }
            }
        }

        return prologueMap;
    }

    /**
     * 批量查询模型信息（带缓存）
     */
    @Cacheable(value = "agentModels", key = "#prologueMap.size() + '_' + #prologueMap.keySet().toString()",
        unless = "#result.isEmpty()")
    public Map<Long, ModelDto> batchQueryModels(Map<Long, AgentPrologueDto> prologueMap) {
        Map<Long, ModelDto> modelMap = new HashMap<>();

        // 收集所有需要查询的模型ID
        Set<Long> modelIds = prologueMap.values().stream().map(AgentPrologueDto::getModelInfo).filter(Objects::nonNull)
            .map(AgentPrologueDto.ModelInfo::getModelId).filter(Objects::nonNull).collect(Collectors.toSet());

        if (modelIds.isEmpty()) {
            return modelMap;
        }

        // 批量查询模型信息
        for (Long modelId : modelIds) {
            try {
                ModelDto modelDto = aiModelService.getModel(modelId.toString());
                if (modelDto != null) {
                    modelMap.put(modelId, modelDto);
                }
            }
            catch (Exception e) {
                logger.error("查询模型信息失败, modelId={}", modelId, e);
            }
        }

        return modelMap;
    }

    /**
     * 构建AgentResourceChatInfoDto对象（优化版本）
     */
    private AgentResourceChatInfoDto buildAgentResourceDtoOptimized(SsResource ssResource,
        SsResExtDigEmployee extEmployee, AgentPrologueDto agentPrologueDto, Map<Long, ModelDto> modelMap) {
        AgentResourceChatInfoDto agentResourceChatInfoDto = new AgentResourceChatInfoDto();
        agentResourceChatInfoDto.setId(ssResource.getResourceId());
        agentResourceChatInfoDto.setCode(ssResource.getResourceCode());
        agentResourceChatInfoDto.setType(extEmployee.getAgentType());
        agentResourceChatInfoDto.setName(ssResource.getResourceName());
        agentResourceChatInfoDto.setAvatar(ssResource.getAvatar());
        agentResourceChatInfoDto.setSystemCode(ssResource.getSystemCode());
        agentResourceChatInfoDto.setAgentSseUrl(agentBuildService.replaceKnowledgeUrl(extEmployee.getAgentSseUrl()));
        agentResourceChatInfoDto.setCreateType(extEmployee.getCreateType());
        agentResourceChatInfoDto.setIntegrationType(extEmployee.getIntegrationType());
        agentResourceChatInfoDto.setAgentHomeUrl(extEmployee.getAgentHomeUrl());

        List<CoreCompetency> coreCompetencies = agentBuildService.parseCompetencies(extEmployee.getCoreCompetencies());
        agentResourceChatInfoDto.setCoreCompetencies(coreCompetencies);

        String resourceName = ssResource.getResourceName();
        String ability = extEmployee.getAbility();
        String constraints = extEmployee.getConstraints();
        String faqs = extEmployee.getFaqs();

        String formatCoreCompetencies = agentBuildService.formatCoreCompetencies(resourceName, coreCompetencies);
        String abilityMerge = agentBuildService.formatAbilityConstraintFaqs(resourceName, ability, constraints, faqs);
        if (StringUtil.isNotEmpty(formatCoreCompetencies)) {
            // 优先设置新版本
            agentResourceChatInfoDto.setIntro(formatCoreCompetencies);
        }
        else if (StringUtil.isNotEmpty(abilityMerge)) {
            // 兼容历史版本
            agentResourceChatInfoDto.setIntro(abilityMerge);
        }
        else {
            agentResourceChatInfoDto.setIntro(ssResource.getResourceDesc());
        }

        // 设置语气描述
        String roleAttributes = extEmployee.getRoleAttributes();
        String processingFlow = extEmployee.getProcessingFlow();
        String personalityDimensions = extEmployee.getPersonalityDimensions();
        String instructions = agentBuildService.formatInstructions(resourceName, roleAttributes, processingFlow,
            personalityDimensions);
        if (StringUtil.isNotEmpty(instructions)) {
            agentResourceChatInfoDto.setInstructions(instructions);
        }
        else {
            // 兼容历史版本
            agentResourceChatInfoDto.setInstructions(ssResource.getResourceDesc());
        }

        // 防止空指针
        if (agentPrologueDto != null) {
            agentResourceChatInfoDto.setBackground(agentPrologueDto.getBackground());
            agentResourceChatInfoDto.setDescText(agentPrologueDto.getDescText());
            agentResourceChatInfoDto.setOpeningQuestion(agentPrologueDto.getOpeningQuestion());
            agentResourceChatInfoDto.setRunConfig(generateRunConfigOptimized(agentPrologueDto, modelMap, resourceName));
            agentResourceChatInfoDto.setFileUpload(agentPrologueDto.getFileUpload());
        }
        return agentResourceChatInfoDto;
    }

    /**
     * 设置关联信息（使用预加载数据的优化版本）
     */
    private void setRelInfoOptimizedWithPreloadedData(SsResource ssResource,
        AgentResourceChatInfoDto agentResourceChatInfoDto) {

        Map<Long, List<Long>> resourceRelResourceMap = new HashMap<>(10);
        Map<Long, SsResource> resourceIdMap = new HashMap<>(10);
        Map<String, List<Long>> resourceBizTypeMap = this.buildRelResourceBizTypeMap(ssResource.getResourceId(),
            resourceRelResourceMap, resourceIdMap);

        if (resourceBizTypeMap == null) {
            return;
        }
        List<Long> resourceIds = resourceBizTypeMap.get(ResourceBizTypeEnum.AGENT.name());

        // 处理智能体
        agentResourceChatInfoDto.setAgentList(agentBuildService.buildAgentList(resourceIds));

        // 处理知识库和处理数据集
        resourceIds = new ArrayList<>(10);
        resourceIds.addAll(resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.KG_DOC.name(), Lists.newArrayList()));
        resourceIds.addAll(resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.KG_QA.name(), Lists.newArrayList()));
        resourceIds.addAll(resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.KG_DB.name(), Lists.newArrayList()));
        agentResourceChatInfoDto.setDatasetList(agentBuildService.buildDatasetList(resourceIds));

        // 处理mcp服务
        resourceIds = resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.MCP.name(), Lists.newArrayList());
        agentResourceChatInfoDto.setMcpServerList(agentBuildService.buildMcpServerList(resourceIds));

        // 处理视图和对象
        List<McpServer> mcpServers = agentBuildService.buildViewObjectMcpServerList(
            resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.VIEW.name(), Lists.newArrayList()),
            resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.OBJECT.name(), Lists.newArrayList()),
            resourceRelResourceMap, resourceIdMap);
        agentResourceChatInfoDto.getMcpServerList().addAll(mcpServers);

        List<OpenAiToolDto> plugTools = new ArrayList<>(10);
        // 处理插件
        resourceIds = resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.TOOLKIT.name(), Lists.newArrayList());
        plugTools.addAll(agentBuildService.buildToolKitList(resourceIds));

        // 处理工具
        resourceIds = resourceBizTypeMap.getOrDefault(ResourceBizTypeEnum.TOOL.name(), Lists.newArrayList());
        plugTools.addAll(agentBuildService.buildToolList(resourceIds));

        agentResourceChatInfoDto.setPlugTools(plugTools);
    }

    /**
     * 根据资源id列表查询工具信息
     *
     * @param resourceIds 资源id列表
     * @return List<OpenAiToolDto>
     */
    public List<OpenAiToolDto> getToolsInfo(List<Long> resourceIds) {
        if (CollectionUtils.isEmpty(resourceIds)) {
            return Lists.newArrayList();
        }
        List<OpenAiToolDto> openAiToolDtos = new ArrayList<>(10);
        openAiToolDtos.addAll(agentBuildService.buildToolKitList(resourceIds));
        openAiToolDtos.addAll(agentBuildService.buildToolList(resourceIds));
        return openAiToolDtos;

    }

    public List<McpServer> getMcpInfo(List<SsResource> mcpResources) {
        if (CollectionUtils.isEmpty(mcpResources)) {
            return Lists.newArrayList();
        }
        Map<Long, SsResource> resourceMap = mcpResources.stream()
            .collect(Collectors.toMap(SsResource::getResourceId, Function.identity(), (a, b) -> a));
        List<Long> resourceIdList = mcpResources.stream().map(SsResource::getResourceId).distinct().toList();
        List<SsResExtMcpServer> ssResExtMcpServers = ssResExtMcpserverMapper.selectBatchIds(resourceIdList);
        return ssResExtMcpServers.stream().map(mcp -> {
            McpServer server = new McpServer();
            server.setUrl(mcp.getMcpServerUrl());
            server.setTransferType(mcp.getMcpTransferType());
            server.setHeader(mcp.getMcpHeader());
            server.setCommand(mcp.getMcpCommand());
            server.setArgs(mcp.getMcpArgs());
            server.setEnv(mcp.getMcpEnv());
            server.setTimeout(mcp.getMcpTimeout());
            SsResource ssResource = resourceMap.getOrDefault(mcp.getResourceId(), new SsResource());
            server.setMcpResourceId(mcp.getResourceId());
            server.setMcpResourceName(ssResource.getResourceName());
            server.setMcpResourceDesc(ssResource.getResourceDesc());
            server.setMcpResourceSourcePkId(ssResource.getResourceSourcePkId());
            return server;
        }).collect(Collectors.toList());
    }

    public List<McpServer> getMcpInfoByIdList(List<Long> resourceIdList) {
        if (CollectionUtils.isEmpty(resourceIdList)) {
            return Lists.newArrayList();
        }
        List<SsResource> ssResources = ssResourceMapper.selectBatchIds(resourceIdList);
        return getMcpInfo(ssResources);
    }

    /**
     * 生成运行配置（优化版本）
     */
    private RunConfig generateRunConfigOptimized(AgentPrologueDto agentPrologueDto, Map<Long, ModelDto> modelMap,
        String resourceName) {
        RunConfig runConfig = new RunConfig();
        AgentPrologueDto.ModelInfo modelInfo = agentPrologueDto.getModelInfo();
        if (modelInfo == null) {
            return runConfig;
            // todo 不报错了
            // throw new BaseException(I18nUtil.get("agent.digital_employee.model.not.configured", resourceName));
        }

        Long modelId = modelInfo.getModelId();
        ModelDto modelDto = modelMap.get(modelId);
        if (modelDto == null) {
            // todo 不报错
            return runConfig;
            // throw new BaseException(I18nUtil.get("agent.digital_employee.model.not.found", resourceName));
        }

        // 获取模型信息
        runConfig.setModel(modelDto.getModelCode());
        runConfig.setBaseUrl(modelDto.getUrl());
        runConfig.setApiKey(modelDto.getAuthToken());
        runConfig.setTemperature(agentPrologueDto.getModelInfo().getTemperature());
        return runConfig;
    }

}
