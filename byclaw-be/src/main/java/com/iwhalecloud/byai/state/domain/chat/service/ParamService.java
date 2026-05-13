package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;
import com.google.common.collect.Sets;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.env.EnvConfigKey;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.feign.request.manager.Dataset;
import com.iwhalecloud.byai.common.feign.request.manager.McpServer;
import com.iwhalecloud.byai.common.feign.request.manager.OpenAiToolDto;
import com.iwhalecloud.byai.common.feign.request.manager.ResourceIdQo;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.ManagerRuntimeException;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.util.UrlUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.application.service.resource.AgentResourceService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.dto.AgentDto;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.agent.enums.MetaStatusEnum;
import com.iwhalecloud.byai.state.domain.agent.service.SsSuperassistSubAgentService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.men.service.MenResComService;
import com.iwhalecloud.byai.state.domain.monitor.mapper.service.MonitorTargetService;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.infrastructure.agentconnect.handle.CommonHandler;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import cn.hutool.core.map.MapUtil;
import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class ParamService {

    private Logger logger = LoggerFactory.getLogger(ParamService.class);

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private CommonHandler commonHandler;

    @Autowired
    private SsSuperassistSubAgentService ssSuperassistSubAgentService;

    @Autowired
    private ResourceAuthContextService resourceAuthContextService;

    @Autowired
    private AgentResourceService agentResourceService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private MenResComService menResComService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private MonitorTargetService monitorTargetService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /**
     * 请求python的参数拼接
     *
     * @param ctx
     * @return
     */
    public Map<String, Object> getParams(ChatProcessContext ctx) {

        AuthContextBo authContextBo = resourceAuthContextService.getAuthContextBo();

        AssistantChatDto assistantChatDto = ctx.getAssistantChatDto();
        Integer isDebug = assistantChatDto.getIsDebug();
        List<ResourceVo> resourceList = assistantChatDto.getResourceList();

        List<AgentResourceChatInfoDto> chatAgentResourceInfo = Lists.newArrayList();
        Map<String, Object> params = new HashMap<>();
        if (CollectionUtils.isNotEmpty(resourceList)) {
            params.put("resource_list", resourceList);
        }
        params.put("agent_id", assistantChatDto.getAgentId());
        params.put("ext_params", assistantChatDto.getExtParams());
        SsResource ssResource = ssResourceService.findById(assistantChatDto.getAgentId());
        if (ssResource == null) {
            params.put("worker_agent_type", WorkerAgentType.BYCLAW_EXE.getCode());
        } else {
            params.put("worker_agent_type", ssResource.getWorkerAgentType());
        }

        if (assistantChatDto.getAgentId() != null) {
            AgentResourceChatInfoDto resourceAgent = ssSuperassistSubAgentService.getResourceAgent(isDebug,
                assistantChatDto.getAgentId());
            if (resourceAgent == null) {
                throw new ManagerRuntimeException("数字员工不存在、未上架或配置不完整");
            }
            chatAgentResourceInfo.add(resourceAgent);
        }
        else {

            List<Long> resComDitEmployeeIds = new ArrayList<>();
            TaskOperateTypeEnum taskOperateType = assistantChatDto.getTaskOperateType();
            if (TaskOperateTypeEnum.EXECUTE.equals(taskOperateType)
                || TaskOperateTypeEnum.UPDATE.equals(taskOperateType)) {
                Map<String, Object> extParams = assistantChatDto.getExtParams();
                Long resComId = MapParamUtil.getLongValue(extParams, "resComId");
                resComDitEmployeeIds = this.getDigEmployeeByResComId(resComId);
            }

            List<Long> byResourceIds = this.getByResourceList(resourceList, ResourceBizType.DIG_EMPLOYEE.getCode());
            if (ListUtil.isNotEmpty(byResourceIds)) {
                chatAgentResourceInfo = this.getChatAgentResourceInfo(isDebug, byResourceIds);
            }
            else {

                // 授权数字员工;
                List<Long> authDigEmployeeIds = authContextBo
                    .getAuthResourceIds(ResourceBizType.DIG_EMPLOYEE.getCode());

                // 移除低评分的
                String threshold = byaiSystemConfigService
                    .getDcSystemConfigValueByCode(Constants.CHAT_DIGITAL_EMPLOYEE_THRESHOLD);
                List<Long> ltTargetQualityIds = monitorTargetService.digitalEmployeeLtTargetQuality(threshold);

                logger.info("评分等级低于:{},数字员工标识有:{}", threshold, JSON.toJSONString(ltTargetQualityIds));
                authDigEmployeeIds.removeIf(id -> ltTargetQualityIds != null && ltTargetQualityIds.contains(id));

                // 增加执行任务的数字员工
                authDigEmployeeIds.addAll(resComDitEmployeeIds);

                chatAgentResourceInfo = this.getChatAgentResourceInfo(isDebug, authDigEmployeeIds);
            }
        }

        // 过滤数字员工关联没有权限的资源
        this.filterUnAuthAgentResources(chatAgentResourceInfo, authContextBo);

        // 过滤chatAgentResourceInfo里面的数据
        filterUnChoosedResource(chatAgentResourceInfo, assistantChatDto);

        params.put("agent_list", chatAgentResourceInfo);

        Long agentId = assistantChatDto.getAgentId();
        if (agentId != null) {
            for (AgentResourceChatInfoDto resourceItem : chatAgentResourceInfo) {
                if (resourceItem.getId().equals(agentId)) {
                    params.put("agent_code", resourceItem.getCode());
                    params.put("agent_name", resourceItem.getName());
                    params.put("agent_type", resourceItem.getType());
                }
            }
        }

        List<MessageFileDto> files = ctx.assistantChatDto.getFiles();
        if (files != null) {
            params.put("files", files);
        }

        return params;
    }

    /**
     * 获取资源类型
     *
     * @param resourceList 资源列表
     * @param resourceBizType 资源类型
     * @return List
     */
    private List<Long> getByResourceList(List<ResourceVo> resourceList, String resourceBizType) {

        // 为空返回空集
        if (ListUtil.isEmpty(resourceList) || StringUtil.isEmpty(resourceBizType)) {
            return Collections.emptyList();
        }

        List<Long> resourceIds = new ArrayList<>();
        for (ResourceVo resourceVo : resourceList) {
            if (resourceBizType.equals(resourceVo.getResourceType().getCode())) {
                resourceIds.add(Long.valueOf(resourceVo.getResourceId()));
            }
        }

        return resourceIds;
    }

    private void filterUnChoosedResource(List<AgentResourceChatInfoDto> chatAgentResourceInfo,
        AssistantChatDto assistantChatDto) {
        // 1.首先解析assistantChatDto里面选择的关联数据
        String chatContent = assistantChatDto.getChatContent();

        // 2. 如果chatContent为空，不进行过滤
        if (chatContent == null || chatContent.trim().isEmpty()) {
            return;
        }

        // 3. 从chatContent中提取所有{{}}格式的数据并分组
        // Map<数字员工资源ID, Map<资源类型, List<资源ID>>>
        // 例如: {12345L: {"AGENT": [27388L, 456L], "TOOL": [123L]}, 67890L: {}}
        Map<Long, Map<String, List<Long>>> digEmployeeSkillMap = extractAndGroupResources(chatContent);

        // 4. 如果没有提取到任何数据，不进行过滤
        if (MapUtil.isEmpty(digEmployeeSkillMap)) {
            return;
        }

        // 5. 根据提取的数据过滤chatAgentResourceInfo
        // 只保留被选中的数字员工，并且只保留被选中的技能
        filterAgentResourceInfo(chatAgentResourceInfo, digEmployeeSkillMap);

    }

    /**
     * 从chatContent中提取{{}}格式的数据并分组 格式可能是： - {{DIG_EMPLOYEE_12345#AGENT_27388}} - 有#分隔符，前面是数字员工，后面是技能（类型_资源ID） -
     * {{DIG_EMPLOYEE_12345}} - 没有#，只有数字员工
     * <p>
     * 返回格式： { "12345": { "AGENT": [123, 456], "TOOL": [789] }, "67890": {} }
     *
     * @param chatContent 聊天内容
     * @return Map<数字员工资源ID, Map < 资源类型, List < 资源ID>>>
     */
    private Map<Long, Map<String, List<Long>>> extractAndGroupResources(String chatContent) {
        Map<Long, Map<String, List<Long>>> digEmployeeSkillMap = Maps.newHashMap();

        // 使用正则表达式匹配所有{{}}格式的数据
        // 匹配模式：{{任意内容}}
        Pattern pattern = Pattern.compile("\\{\\{([^}]+)\\}\\}");
        Matcher matcher = pattern.matcher(chatContent);

        while (matcher.find()) {
            String content = matcher.group(1); // 获取{{}}中间的内容
            if (content == null || content.trim().isEmpty()) {
                continue;
            }

            // 判断是否包含#分隔符
            if (content.contains("#")) {
                // 有#分隔符，按#分割
                String[] parts = content.split("#", 2);
                if (parts.length == 2) {
                    String digEmployeePart = parts[0].trim(); // 数字员工部分，如"DIG_EMPLOYEE_12345"
                    String skillPart = parts[1].trim(); // 技能部分，如"AGENT_27388"

                    // 从DIG_EMPLOYEE_12345中提取资源ID
                    Long digEmployeeResourceId = extractResourceIdFromFormat(digEmployeePart);
                    if (digEmployeeResourceId == null) {
                        continue;
                    }

                    // 从AGENT_27388或KG_DOC_123中提取资源类型和资源ID
                    // 从后往前找最后一个下划线，分割出资源类型和资源ID
                    int lastUnderscoreIndex = skillPart.lastIndexOf("_");
                    if (lastUnderscoreIndex > 0 && lastUnderscoreIndex < skillPart.length() - 1) {
                        String resourceType = skillPart.substring(0, lastUnderscoreIndex).trim(); // 资源类型，如"AGENT"或"KG_DOC"
                        Long skillResourceId = extractResourceIdFromSkillId(skillPart); // 资源ID，如27388或123

                        if (skillResourceId != null && StringUtils.isNotEmpty(resourceType)) {
                            // 将技能添加到对应数字员工的对应类型列表中
                            Map<String, List<Long>> skillTypeMap = digEmployeeSkillMap
                                .computeIfAbsent(digEmployeeResourceId, k -> Maps.newHashMap());
                            List<Long> skillIdList = skillTypeMap.computeIfAbsent(resourceType,
                                k -> Lists.newArrayList());
                            skillIdList.add(skillResourceId);
                        }
                    }
                }
            }
            else {
                // 没有#分隔符，整个是数字员工ID，如"DIG_EMPLOYEE_12345"
                Long digEmployeeResourceId = extractResourceIdFromFormat(content.trim());
                if (digEmployeeResourceId != null) {
                    // 只添加数字员工，不添加技能（技能Map为空）
                    digEmployeeSkillMap.putIfAbsent(digEmployeeResourceId, Maps.newHashMap());
                }
            }
        }

        return digEmployeeSkillMap;
    }

    /**
     * 根据提取的数据过滤chatAgentResourceInfo 只保留被选中的数字员工，并且只保留被选中的技能
     *
     * @param chatAgentResourceInfo 数字员工资源列表
     * @param digEmployeeSkillMap 数字员工和技能的映射关系，格式：Map<数字员工资源ID, Map<资源类型, List<资源ID>>>
     */
    private void filterAgentResourceInfo(List<AgentResourceChatInfoDto> chatAgentResourceInfo,
        Map<Long, Map<String, List<Long>>> digEmployeeSkillMap) {
        if (CollectionUtils.isEmpty(chatAgentResourceInfo)) {
            return;
        }

        // 过滤chatAgentResourceInfo，只保留被选中的数字员工
        Iterator<AgentResourceChatInfoDto> iterator = chatAgentResourceInfo.iterator();
        while (iterator.hasNext()) {
            AgentResourceChatInfoDto agentInfo = iterator.next();
            Long resourceId = agentInfo.getId();

            // 检查该数字员工是否被选中
            if (!digEmployeeSkillMap.containsKey(resourceId)) {
                // 未被选中，移除
                iterator.remove();
                continue;
            }

            // 如果该数字员工被选中，检查是否有选中的技能
            Map<String, List<Long>> selectedSkills = digEmployeeSkillMap.get(resourceId);
            if (MapUtil.isNotEmpty(selectedSkills)) {
                // 有选中的技能，需要过滤关联的技能资源
                filterSelectedSkills(agentInfo, selectedSkills);
            }
            // 如果没有选中的技能（selectedSkills为空），保留该数字员工的所有技能
        }
    }

    /**
     * 从格式化的ID中提取资源ID 例如：从"DIG_EMPLOYEE_12345"中提取12345
     *
     * @param formattedId 格式化的ID，如"DIG_EMPLOYEE_12345"
     * @return 资源ID，如果提取失败返回null
     */
    private Long extractResourceIdFromFormat(String formattedId) {
        if (formattedId == null || formattedId.trim().isEmpty()) {
            return null;
        }

        try {
            // 从DIG_EMPLOYEE_12345格式中提取数字部分
            // 支持格式：DIG_EMPLOYEE_12345 或 DIG_EMPLOYEE#12345 等
            String[] parts = formattedId.split("_");
            if (parts.length > 0) {
                String lastPart = parts[parts.length - 1];
                return Long.parseLong(lastPart);
            }
        }
        catch (NumberFormatException e) {
            log.warn("无法从格式化ID中提取资源ID: {}", formattedId, e);
        }

        return null;
    }

    /**
     * 从技能ID格式中提取资源ID 例如：从"AGENT_27388"中提取27388
     *
     * @param skillId 技能ID，如"AGENT_27388"
     * @return 资源ID，如果提取失败返回null
     */
    private Long extractResourceIdFromSkillId(String skillId) {
        if (skillId == null || skillId.trim().isEmpty()) {
            return null;
        }

        try {
            // 从AGENT_27388格式中提取数字部分
            String[] parts = skillId.split("_");
            if (parts.length > 0) {
                String lastPart = parts[parts.length - 1];
                return Long.parseLong(lastPart);
            }
        }
        catch (NumberFormatException e) {
            log.warn("无法从技能ID中提取资源ID: {}", skillId, e);
        }

        return null;
    }

    /**
     * 过滤数字员工关联的技能资源，只保留被选中的技能 字段类型映射： - agentList 对应 AGENT 类型 - databaseIdList 对应 KG_DB 类型 - datasetList 对应
     * KG_DOC、KG_QA、KG_TERM 这三个类型 - plugTools 对应 TOOLKIT 类型 - mcpServerList 对应 MCP 类型
     * <p>
     * 过滤规则： - 只要 selectedSkills 不为空，就需要进行过滤 - 对于每个类型： - 如果 selectedSkills 中有该类型且有资源ID列表，只保留这些资源ID - 如果 selectedSkills
     * 中没有该类型，将该类型的字段置为 null（清空）
     *
     * @param agentInfo 数字员工信息
     * @param selectedSkills 被选中的技能映射，格式如{"AGENT": [27388L, 456L], "KG_DOC": [123L]}
     */
    private void filterSelectedSkills(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        if (agentInfo == null || MapUtil.isEmpty(selectedSkills)) {
            return;
        }

        // 过滤各类型的资源
        filterAgentList(agentInfo, selectedSkills);
        filterDatabaseIdList(agentInfo, selectedSkills);
        filterDatasetList(agentInfo, selectedSkills);
        filterPlugTools(agentInfo, selectedSkills);
        filterMcpServerList(agentInfo, selectedSkills);
    }

    /**
     * 过滤关联的智能体列表（AGENT类型 -> agentList）
     */
    private void filterAgentList(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        List<Long> agentIds = selectedSkills.get("AGENT");
        if (CollectionUtils.isEmpty(agentIds)) {
            agentInfo.setAgentList(null);
            return;
        }

        Set<Long> agentIdSet = agentIds.stream().collect(Collectors.toSet());
        if (CollectionUtils.isNotEmpty(agentInfo.getAgentList())) {
            agentInfo.getAgentList()
                .removeIf(agent -> agent.getAgentId() != null && !agentIdSet.contains(agent.getAgentId()));
        }
    }

    /**
     * 过滤关联的数据库列表（KG_DB类型 -> databaseIdList）
     */
    private void filterDatabaseIdList(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        List<Long> kgDbIds = selectedSkills.get("KG_DB");
        if (CollectionUtils.isEmpty(kgDbIds)) {
            agentInfo.setDatabaseIdList(null);
            return;
        }

        Set<Long> kgDbIdSet = kgDbIds.stream().collect(Collectors.toSet());
        if (CollectionUtils.isNotEmpty(agentInfo.getDatabaseIdList())) {
            agentInfo.getDatabaseIdList().removeIf(dbId -> {
                try {
                    Long dbIdLong = Long.parseLong(dbId);
                    return !kgDbIdSet.contains(dbIdLong);
                }
                catch (NumberFormatException e) {
                    log.warn("数据库ID格式错误: {}", dbId);
                    return false;
                }
            });
        }
    }

    /**
     * 过滤关联的知识库列表（KG_DOC、KG_QA、KG_TERM类型 -> datasetList）
     */
    private void filterDatasetList(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        Set<Long> datasetIdSet = collectDatasetIds(selectedSkills);
        if (datasetIdSet.isEmpty()) {
            agentInfo.setDatasetList(null);
            return;
        }

        if (CollectionUtils.isNotEmpty(agentInfo.getDatasetList())) {
            agentInfo.getDatasetList().removeIf(
                dataset -> dataset.getResourceId() != null && !datasetIdSet.contains(dataset.getResourceId()));
        }
    }

    /**
     * 收集知识库类型的资源ID（KG_DOC、KG_QA、KG_TERM）
     */
    private Set<Long> collectDatasetIds(Map<String, List<Long>> selectedSkills) {
        Set<Long> datasetIdSet = Sets.newHashSet();
        addIfNotEmpty(datasetIdSet, selectedSkills.get("KG_DOC"));
        addIfNotEmpty(datasetIdSet, selectedSkills.get("KG_QA"));
        addIfNotEmpty(datasetIdSet, selectedSkills.get("KG_TERM"));
        return datasetIdSet;
    }

    /**
     * 如果列表不为空，添加到集合中
     */
    private void addIfNotEmpty(Set<Long> targetSet, List<Long> sourceList) {
        if (CollectionUtils.isNotEmpty(sourceList)) {
            targetSet.addAll(sourceList);
        }
    }

    /**
     * 过滤关联的工具集列表（TOOLKIT类型 -> plugTools）
     */
    private void filterPlugTools(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        List<Long> toolkitIds = selectedSkills.get("TOOLKIT");
        if (CollectionUtils.isEmpty(toolkitIds)) {
            agentInfo.setPlugTools(null);
            return;
        }
        Set<String> toolkitCodes = new HashSet<>();
        toolkitIds.forEach(toolkitId -> {
            String toolkitCode = "TOOLKIT_" + toolkitId;
            toolkitCodes.add(toolkitCode);
        });
        if (CollectionUtils.isNotEmpty(agentInfo.getPlugTools())) {
            agentInfo.getPlugTools()
                .removeIf(tool -> tool.getRelToolkitId() != null && !toolkitCodes.contains(tool.getRelToolkitId()));
        }
    }

    /**
     * 过滤关联的MCP服务列表（MCP类型 -> mcpServerList）
     */
    private void filterMcpServerList(AgentResourceChatInfoDto agentInfo, Map<String, List<Long>> selectedSkills) {
        List<Long> mcpIds = getAllMcpIds(selectedSkills);
        if (CollectionUtils.isEmpty(mcpIds)) {
            agentInfo.setMcpServerList(null);
            return;
        }

        Set<Long> mcpIdSet = mcpIds.stream().collect(Collectors.toSet());
        if (CollectionUtils.isNotEmpty(agentInfo.getMcpServerList())) {
            agentInfo.getMcpServerList()
                .removeIf(mcp -> mcp.getMcpResourceId() != null && !mcpIdSet.contains(mcp.getMcpResourceId()));
        }
    }

    private List<Long> getAllMcpIds(Map<String, List<Long>> selectedSkills) {
        List<Long> serverIds = new ArrayList<>();
        List<Long> mcpIds = selectedSkills.get("MCP");
        List<Long> objectIds = selectedSkills.get("OBJECT");
        List<Long> viewIds = selectedSkills.get("VIEW");
        if (mcpIds != null && !mcpIds.isEmpty()) {
            serverIds.addAll(mcpIds);
        }
        if (objectIds != null && !objectIds.isEmpty()) {
            serverIds.addAll(objectIds);
        }
        if (viewIds != null && !viewIds.isEmpty()) {
            serverIds.addAll(viewIds);
        }
        return serverIds;
    }

    /**
     * 过滤未授权的资源（知识库和数据库）
     *
     * @param chatAgentResourceInfos 数字员工信息
     * @param authContextBo 资源权限对象
     */
    private void filterUnAuthAgentResources(List<AgentResourceChatInfoDto> chatAgentResourceInfos,
        AuthContextBo authContextBo) {

        if (CollectionUtils.isEmpty(chatAgentResourceInfos)) {
            return;
        }

        List<Long> toolKitResourceIds = authContextBo.getAuthResourceIds(ResourceBizType.TOOLKIT.getCode());
        List<Long> toolResourceIds = authContextBo.getAuthResourceIds(ResourceBizType.TOOL.getCode());

        for (AgentResourceChatInfoDto agentResourceChatInfoDto : chatAgentResourceInfos) {
            if (agentResourceChatInfoDto == null) {
                continue;
            }

            // 过滤知识库资源
            List<Dataset> datasetList = agentResourceChatInfoDto.getDatasetList();
            if (CollectionUtils.isNotEmpty(datasetList)) {
                datasetList.removeIf(dataset -> !authContextBo.isAuthResourceId(dataset.getResourceId()));
            }

            // 过滤工具集和工具,工具集和工具只要有一个授权即可
            List<OpenAiToolDto> plugTools = agentResourceChatInfoDto.getPlugTools();
            if (CollectionUtils.isNotEmpty(plugTools)) {
                plugTools.removeIf(openAiToolDto -> {
                    boolean authToolKit = toolKitResourceIds.contains(openAiToolDto.getParentResourceId());
                    boolean authTool = toolResourceIds.contains(openAiToolDto.getResourceId());
                    return !(authToolKit || authTool);
                });
            }

            // 过滤mcp工具标识
            List<McpServer> mcpServerList = agentResourceChatInfoDto.getMcpServerList();
            if (CollectionUtils.isNotEmpty(mcpServerList)) {
                mcpServerList.removeIf(mcpServer -> !authContextBo.isAuthResourceId(mcpServer.getMcpResourceId()));
            }
        }

        // 如果是109的，并且dataCloud的mcp没权限的，过滤掉
        chatAgentResourceInfos.removeIf(chatAgentResourceInfo -> {
            if (chatAgentResourceInfo == null) {
                return true;
            }
            String type = chatAgentResourceInfo.getType();
            List<McpServer> mcpServerList = chatAgentResourceInfo.getMcpServerList();
            return ("109".equalsIgnoreCase(type) && ListUtil.isEmpty(mcpServerList));
        });
    }

    /**
     * 获取数字员工详情
     *
     * @param isDebug 是否调整试
     * @param resourceIds 资源标识
     * @return List<AgentResourceChatInfoDto>
     */
    private List<AgentResourceChatInfoDto> getChatAgentResourceInfo(Integer isDebug, List<Long> resourceIds) {
        try {
            // 参数封装
            ResourceIdQo resourceIdQo = new ResourceIdQo();
            resourceIdQo.setResourceIds(resourceIds);
            // 默认查询上架的
            if (isDebug == null || DebugModeEnum.DEBUG_0.getNum().equals(isDebug)) {
                resourceIdQo.setResourceStatus(MetaStatusEnum.UP.getCode());
            }
            List<AgentResourceChatInfoDto> list = agentResourceService.getAgentResourceInfo(resourceIdQo);
            return list;
        }
        catch (Exception e) {
            throw new ManagerRuntimeException(e);
        }
    }

    /**
     * 获取执行的数字员工
     *
     * @param resComId 数字员工
     * @return List
     */
    private List<Long> getDigEmployeeByResComId(Long resComId) {
        MenResCom menResCom = menResComService.findByResComId(resComId);
        String resPage = menResCom.getResPage();
        if (StringUtils.isEmpty(resPage)) {
            return Collections.emptyList();
        }

        List<Long> digEmployeeIds = new ArrayList<>(10);
        // 解析 JSON
        JSONObject root = JSONObject.parseObject(resPage);
        JSONArray jsonArray = root.getJSONArray("steps");
        // 遍历每个主对象
        for (int i = 0; jsonArray != null && i < jsonArray.size(); i++) {
            JSONObject mainObj = jsonArray.getJSONObject(i);
            JSONArray subSteps = mainObj.getJSONArray("sub_steps");
            // 遍历每个 sub_step
            for (int j = 0; subSteps != null && j < subSteps.size(); j++) {
                JSONObject step = subSteps.getJSONObject(j);
                // 获取当前 step 的 id

                JSONObject toolMetadata = step.getJSONObject("tool_metadata");
                if (toolMetadata == null) {
                    continue;
                }

                // 获取工具的类型
                String toolType = toolMetadata.getString("toolType");
                if (AgentMetaEnum.DIG_EMPLOYEE.getCode().equals(toolType)) {
                    digEmployeeIds.add(toolMetadata.getLong("toolId"));
                }
            }
        }
        return digEmployeeIds;
    }

    public Map<String, Object> getPythonEnv(Long modelAnswerMessageId) {
        // 得到当前数字员工的模型id
        ModelDto aiModel = aiModelService.getDefaultChatModel();
        Map<String, Object> envMap = Maps.newHashMap();
        // 如果找到了模型配置，则从中获取各字段值
        if (aiModel != null) {
            // 直接将模型配置映射到环境变量
            envMap.put("LLM_URL", aiModel.getUrl());
            envMap.put("LLM_TOKENS", aiModel.getAuthToken());
            envMap.put("LLM_MODE_NAME", aiModel.getModelCode());
            envMap.put("LLM_MODE_NAME_R", aiModel.getModelCode());
            // 为啥和上面的一致
            envMap.put("TOKEN", aiModel.getAuthToken());
        }
        else {
            // 模型配置不存在，记录日志或使用默认值
            log.error("Cannot find model configuration for model_id: -1000");
            throw new BdpRuntimeException(I18nUtil.get("param.model.config.not.found"));
        }

        envMap.put("DIGIT_NUM_LIMIT", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DIGIT_NUM_LIMIT));
        envMap.put("WHALEAGENT_API_BASE", UrlUtil.getCompletionKnowledgeUrl());
        envMap.put("SEARCH_SERVICE_BASE_URL",
            ApplicationContextUtil.getEnvProperty(EnvConfigKey.SEARCH_SERVICE_BASE_URL));
        envMap.put("RERANKER_API_KEY", ApplicationContextUtil.getEnvProperty(EnvConfigKey.RERANKER_API_KEY));
        envMap.put("RERANKER_BASE_URL", ApplicationContextUtil.getEnvProperty(EnvConfigKey.RERANKER_BASE_URL));
        envMap.put("RERANKER_MODEL", ApplicationContextUtil.getEnvProperty(EnvConfigKey.RERANKER_MODEL));
        envMap.put("LANGFUSE_SECRET_KEY", ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_SECRET_KEY));
        envMap.put("LANGFUSE_PUBLIC_KEY", ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_PUBLIC_KEY));
        envMap.put("LANGFUSE_HOST", ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_HOST));
        envMap.put("LANGFUSE_ENV", ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_ENV));
        envMap.put("LANGUAGE", ChatUtils.getLanguage());
        envMap.put("MODEL_ANSWER_MESSAGE_ID", modelAnswerMessageId);
        envMap.put("SEARCH_NETWORK_BASE_URL", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DOCCHAIN_URL));
        envMap.put("DOCCHAIN_TOPIC_ID", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DOCCHAIN_PARAMS_TOPIC));
        envMap.put("DOCCHAIN_API_KEY", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DOCCHAIN_HEADER_API_KEY));
        AgentDto agentDto = new AgentDto();
        commonHandler.handleHeader(agentDto);
        envMap.put("BYAI_HEADERS", this.filterHeader(agentDto.getHeaders()));
        envMap.put("BYAI_SERVER_BASE_URL", ApplicationContextUtil.getEnvProperty(EnvConfigKey.APP_BYAI_URL));
        // 增加域名字段
        envMap.put("BYAI_SERVER_BASE_DNS", ApplicationContextUtil.getEnvProperty(EnvConfigKey.APP_BYAI_FE_URL));
        return envMap;
    }

    /**
     * 过滤仅保留有用的header头
     *
     * @param headers 请求头
     * @return Map
     */
    private Map<String, Object> filterHeader(Map<String, Object> headers) {
        if (headers == null) {
            return Collections.emptyMap();
        }

        Map<String, Object> resultMap = new HashMap<>(10);
        // 仅保留这几个
        for (Map.Entry<String, Object> entry : headers.entrySet()) {
            String key = entry.getKey();
            if ("Cookie".equalsIgnoreCase(key) || "Beyond-Token".equalsIgnoreCase(key)
                || "Sso-Token".equalsIgnoreCase(key) || "System-Code".equalsIgnoreCase(key)
                || "Accept".equalsIgnoreCase(key)) {
                resultMap.put(key, entry.getValue());
            }
        }

        // 增加智能体授权认证
        String bearer = byaiSystemConfigService.getDcSystemConfigValueByCode("AUTHORIZATION_BEARER");
        if (StringUtil.isNotEmpty(bearer)) {
            resultMap.put("Authorization", "Bearer ".concat(bearer));
        }
        return resultMap;
    }

    /**
     * 调用外部智能体（INTERFACE / A2A）所需的认证头：
     * Cookie / Beyond-Token / Sso-Token / System-Code / Accept / Authorization
     */
    public Map<String, Object> getIntegrationHeaders() {
        AgentDto agentDto = new AgentDto();
        commonHandler.handleHeader(agentDto);
        return this.filterHeader(agentDto.getHeaders());
    }

    /**
     * 查询会话历史消息，按时间正序，转换为外部智能体期望的 [{role,content}] 格式。
     * 仅保留有 messageContent 的 user / assistant 消息。
     *
     * @param sessionId 会话ID
     * @param maxRounds 最多轮次（一轮 ≈ 一对 user+assistant），实际拉取 maxRounds*2 条
     * @return histories
     */
    public List<Map<String, String>> getChatHistories(Long sessionId, int maxRounds) {
        if (sessionId == null || maxRounds <= 0) {
            return Collections.emptyList();
        }
        MessageHotQo qo = new MessageHotQo();
        qo.setSessionId(sessionId);
        qo.setTopK(maxRounds * 2);
        List<ByaiMessageHotDto> messages = byaiMessageHotService.findByQo(qo);
        if (CollectionUtils.isEmpty(messages)) {
            return Collections.emptyList();
        }

        // findByQo 返回按时间倒序，外部智能体需要正序
        List<ByaiMessageHotDto> ordered = new ArrayList<>(messages);
        Collections.reverse(ordered);

        List<Map<String, String>> histories = new ArrayList<>();
        for (ByaiMessageHotDto msg : ordered) {
            String content = msg.getMessageContent();
            if (StringUtils.isBlank(content)) {
                continue;
            }
            String role;
            if (Integer.valueOf(1).equals(msg.getUsage())) {
                role = "user";
            }
            else if (Integer.valueOf(2).equals(msg.getUsage())) {
                role = "assistant";
            }
            else {
                continue;
            }
            // user 消息若关联文件，按 Python message_and_files 的形式前置 markdown 文件链接
            if ("user".equals(role)) {
                content = prependUserMessageFiles(msg.getRelatedResources(), content);
            }
            Map<String, String> entry = new HashMap<>(2);
            entry.put("role", role);
            entry.put("content", content);
            histories.add(entry);
        }
        return histories;
    }

    /**
     * 对齐 Python message_and_files：当历史 user 消息附带文件时，
     * 在 content 前拼接 "![fileName](fileUrl) ![...](...)\n\n" markdown 段。
     */
    private String prependUserMessageFiles(String relatedResourcesJson, String content) {
        if (StringUtils.isBlank(relatedResourcesJson)) {
            return content;
        }
        try {
            com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto resourceDto =
                    JSON.parseObject(relatedResourcesJson,
                            com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto.class);
            if (resourceDto == null
                    || CollectionUtils.isEmpty(resourceDto.getFiles())) {
                return content;
            }
            List<String> markdowns = new ArrayList<>();
            for (com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto f : resourceDto.getFiles()) {
                if (f == null || StringUtils.isBlank(f.getFileUrl())) {
                    continue;
                }
                String name = StringUtils.isNotBlank(f.getFileName()) ? f.getFileName() : f.getFileUrl();
                markdowns.add("![" + name + "](" + f.getFileUrl() + ")");
            }
            if (markdowns.isEmpty()) {
                return content;
            }
            return String.join(" ", markdowns) + "\n\n" + content;
        }
        catch (Exception e) {
            log.warn("解析历史消息 relatedResources 失败, 跳过文件拼接", e);
            return content;
        }
    }

}
