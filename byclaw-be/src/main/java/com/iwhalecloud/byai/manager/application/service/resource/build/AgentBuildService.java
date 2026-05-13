package com.iwhalecloud.byai.manager.application.service.resource.build;

import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;
import com.iwhalecloud.byai.common.feign.request.manager.Agent;
import com.iwhalecloud.byai.common.feign.request.manager.Dataset;
import com.iwhalecloud.byai.common.feign.request.manager.McpServer;
import com.iwhalecloud.byai.common.feign.request.manager.OpenAiToolDto;
import com.iwhalecloud.byai.manager.dto.resource.*;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpServer;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.util.UrlParserUtils;
import com.iwhalecloud.byai.common.feign.request.python.CoreCompetency;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.servers.Server;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.MalformedURLException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 智能体构建服�?负责构建Python智能体所需的各类资源参数，包括MCP服务、智能体、知识库、工具集�?
 *
 * @author he.duming
 * @date 2025-10-30 13:33:05
 */
@Slf4j
@Service
public class AgentBuildService {

    private static Logger logger = LoggerFactory.getLogger(AgentBuildService.class);

    @Value("${feign.knowledge.url:}")
    private String knowUrl;

    @Autowired
    private SsResExtDocService ssResExtDocService;

    @Autowired
    private SsResExtAgentService ssResExtAgentService;

    @Autowired
    private SsResExtToolService ssResExtToolService;

    @Autowired
    private SsResExtToolKitService ssResExtToolKitService;

    @Autowired
    private SsResExtMcpServerService ssResExtMcpServerService;

    /**
     * 构建MCP服务器列�?
     *
     * @param resourceIds 资源标识集合
     * @return MCP服务器列表，若资源标识为空则返回空列�?
     */
    public List<McpServer> buildMcpServerList(List<Long> resourceIds) {

        if (ListUtil.isEmpty(resourceIds)) {
            return Lists.newArrayList();
        }

        List<ResourceExtMcpDto> resourceExtMcps = ssResExtMcpServerService.findResourceExtMcpByIds(resourceIds);

        List<McpServer> mcpServerList = new ArrayList<>(10);
        for (ResourceExtMcpDto resourceExtMcpDto : resourceExtMcps) {

            McpServer mcpServer = new McpServer();
            mcpServer.setMcpResourceId(resourceExtMcpDto.getResourceId());
            mcpServer.setMcpResourceName(resourceExtMcpDto.getResourceName());
            mcpServer.setMcpResourceDesc(resourceExtMcpDto.getResourceDesc());
            mcpServer.setMcpResourceSourcePkId(resourceExtMcpDto.getResourceSourcePkId());

            SsResExtMcpServer ssResExtMcpServer = resourceExtMcpDto.getSsResExtMcpServer();
            if (ssResExtMcpServer != null) {
                mcpServer.setUrl(ssResExtMcpServer.getMcpServerUrl());
                mcpServer.setTransferType(ssResExtMcpServer.getMcpTransferType());
                mcpServer.setHeader(ssResExtMcpServer.getMcpHeader());
                mcpServer.setCommand(ssResExtMcpServer.getMcpCommand());
                mcpServer.setArgs(ssResExtMcpServer.getMcpArgs());
                mcpServer.setEnv(ssResExtMcpServer.getMcpEnv());
                mcpServer.setTimeout(ssResExtMcpServer.getMcpTimeout());
            }
            mcpServerList.add(mcpServer);
        }

        return mcpServerList;
    }

    /**
     * 把视图、对象构造成mcp服务给python
     *
     * @param viewResourceIds 视图资源id列表
     * @param objectResourceIds 对象资源id列表
     * @return MCP服务器列表，若资源标识为空则返回空列�?
     */
    public List<McpServer> buildViewObjectMcpServerList(List<Long> viewResourceIds, List<Long> objectResourceIds,
        Map<Long, List<Long>> resourceRelResourceMap, Map<Long, SsResource> resourceIdMap) {
        // 分别构造视图、对象的mcp
        List<McpServer> mcpServerList = Lists.newArrayList();
        if (ListUtil.isEmpty(viewResourceIds) && ListUtil.isEmpty(objectResourceIds)) {
            return Lists.newArrayList();
        }
        if (ListUtil.isNotEmpty(viewResourceIds)) {
            for (Long resourceId : viewResourceIds) {
                SsResource viewResource = resourceIdMap.get(resourceId);
                List<Long> objectIds = resourceRelResourceMap.get(resourceId);
                if (viewResource == null || ListUtil.isEmpty(objectIds)) {
                    log.warn("viewResource is null or viewRelObject all not enable, resourceId = {}", resourceId);
                    continue;
                }
                // 封装视图的mcp返回
                Map<String, String> headers = Maps.newHashMap();
                headers.put("viewIdList", resourceId.toString());
                headers.put("objectIdList", objectIds.stream().map(String::valueOf).collect(Collectors.joining(",")));
                mcpServerList.add(generateDataCloudMcp(viewResource, headers));
            }
        }
        if (ListUtil.isNotEmpty(objectResourceIds)) {
            for (Long resourceId : objectResourceIds) {
                SsResource objectResource = resourceIdMap.get(resourceId);
                List<Long> actionIds = resourceRelResourceMap.get(resourceId);
                if (objectResource == null || ListUtil.isEmpty(actionIds)) {
                    log.warn("objectResource is null or objectRelAction, resourceId = {}", resourceId);
                    continue;
                }
                // 封装对象mcp返回
                Map<String, String> headers = Maps.newHashMap();
                headers.put("objectIdList", resourceId.toString());
                headers.put("actionIdList", actionIds.stream().map(String::valueOf).collect(Collectors.joining(",")));
                mcpServerList.add(generateDataCloudMcp(objectResource, headers));
            }
        }
        return mcpServerList;
    }

    public McpServer generateDataCloudMcp(SsResource ssResource, Map<String, String> headers) {
        McpServer mcpServer = new McpServer();
        mcpServer.setMcpResourceId(ssResource.getResourceId());
        mcpServer.setSystemCode("DATACLOUD");
        mcpServer.setMcpResourceSourcePkId(ssResource.getResourceSourcePkId());
        mcpServer.setMcpResourceName(ssResource.getResourceName());
        mcpServer.setMcpResourceDesc(ssResource.getResourceDesc());
        mcpServer.setMcpResourceBizType(ssResource.getResourceBizType());
        mcpServer.setTransferType("streamable_http");
        // mcpServer.setUrl(this.getDataCloudMcpUrl());
        mcpServer.setHeader(JSON.toJSONString(headers));
        return mcpServer;
    }

    /**
     * 构建智能体列�?
     *
     * @param resourceIds 资源标识集合
     * @return 智能体列表，若资源标识为空则返回空列�?
     */
    public List<Agent> buildAgentList(List<Long> resourceIds) {

        if (ListUtil.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }

        List<ResourceExtAgentDto> resourceExtAgents = ssResExtAgentService.findResourceExtAgentByIds(resourceIds);

        List<Agent> agentList = new ArrayList<>(10);
        for (ResourceExtAgentDto resourceExtAgentDto : resourceExtAgents) {
            Agent agent = new Agent();
            agent.setAgentId(resourceExtAgentDto.getResourceId());
            agent.setAgentName(resourceExtAgentDto.getResourceName());
            agent.setAgentCode(resourceExtAgentDto.getResourceCode());
            agent.setAgentDesc(resourceExtAgentDto.getResourceDesc());
            SsResExtAgent ssResExtAgent = resourceExtAgentDto.getSsResExtAgent();
            if (ssResExtAgent != null) {
                agent.setAgentType(ssResExtAgent.getAgentType());
                agent.setAgentSseHead(ssResExtAgent.getAgentSseHead());
                agent.setAgentDevType(ssResExtAgent.getAgentDevType());
                agent.setAgentSseUrl(this.replaceKnowledgeUrl(ssResExtAgent.getAgentSseUrl()));
                agent.setIntegrationType(ssResExtAgent.getIntegrationType());
            }
            agentList.add(agent);
        }
        return agentList;
    }

    /**
     * 构建数据集（知识库）列表
     *
     * @param resourceIds 资源标识集合
     * @return 数据集列表，若资源标识为空则返回空列�?
     */
    public List<Dataset> buildDatasetList(List<Long> resourceIds) {

        if (ListUtil.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }
        List<ResourceExtDocDto> resourceExtDocs = ssResExtDocService.findResourceExtDocByIds(resourceIds);

        List<Dataset> datasetList = new ArrayList<>(10);

        for (ResourceExtDocDto resourceExtDocDto : resourceExtDocs) {
            Dataset dataset = new Dataset();
            dataset.setResourceId(resourceExtDocDto.getResourceId());
            dataset.setResourceBizType(resourceExtDocDto.getResourceBizType());
            // 注意这个是智能体的知识库id
            dataset.setDatasetId(resourceExtDocDto.getResourceSourcePkId());
            dataset.setDatasetName(resourceExtDocDto.getResourceName());
            dataset.setDatasetCode(resourceExtDocDto.getResourceCode());
            dataset.setDatasetDesc(resourceExtDocDto.getResourceDesc());
            datasetList.add(dataset);
        }

        return datasetList;
    }

    /**
     * 构建工具集列�?从记忆引擎查询工具集元数据，并转换为OpenAI工具格式
     *
     * @param resourceIds 资源标识集合
     * @return OpenAI工具列表，若资源标识为空则返回空列表
     * @throws BaseException 记忆引擎查询失败时抛�?
     */
    public List<OpenAiToolDto> buildToolKitList(List<Long> resourceIds) {

        if (CollectionUtils.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }

        List<ResourceExtToolKitDto> resourceExtToolKits = ssResExtToolKitService
            .findResourceExtToolKitByIds(resourceIds);

        // 从记忆引擎查
        List<String> metaIds = new ArrayList<>(10);
        for (ResourceExtToolKitDto resourceExtToolKitDto : resourceExtToolKits) {
            metaIds.add(ResourceBizType.TOOLKIT.getCode() + "_" + resourceExtToolKitDto.getResourceId());
        }
        //
        // logger.info("工具集查询记忆引擎:metaIds:{}", JSON.toJSONString(metaIds));
        // List<AuAgentMeta> auAgentMetas = auAgentMetaService.batchGet(metaIds);

        List<OpenAiToolDto> resultList = new ArrayList<>(10);
        // for (AuAgentMeta item : auAgentMetas) {
        // String metaContent = item.getMetaContent();
        //
        // if (StringUtil.isEmpty(metaContent)) {
        // continue;
        // }
        //
        // // 替换地址
        // metaContent = this.replaceKnowledgeUrl(metaContent);
        // ResourceResponseDto resourceResponseDto = JSON.parseObject(metaContent, ResourceResponseDto.class);
        //
        // // 添加过滤逻辑：跳过没有PluginMachineInfo的项�?
        // if (CollectionUtils.isEmpty(resourceResponseDto.getPluginMachineInfo())) {
        // continue;
        // }
        //
        // List<PluginMachineInfoDto> pluginMachineInfos = resourceResponseDto.getPluginMachineInfo();
        // for (PluginMachineInfoDto machineInfo : pluginMachineInfos) {
        // PluginMachineDto pluginMachine = machineInfo.getPluginMachine();
        // OpenAiToolDto pluginMachineOpenAPI = machineInfo.getPluginMachineOpenAPI();
        // pluginMachineOpenAPI.setResourceId(pluginMachine.getPluginMachineId());
        // // 父标识
        // String parentResourceIdStr = StringUtils.substringAfterLast(item.getMetaId(), "_");
        // pluginMachineOpenAPI.setParentResourceId(Long.valueOf(parentResourceIdStr));
        // pluginMachineOpenAPI.setRelToolkitId(item.getMetaId());
        // pluginMachineOpenAPI.setResourceName(pluginMachine.getMachineName());
        // pluginMachineOpenAPI.setResourceDesc(pluginMachine.getMachineDesc());
        // pluginMachineOpenAPI.setResourceSourcePkId(pluginMachineOpenAPI.getResourceId());
        // pluginMachineOpenAPI.setResourceType("ATOM");
        // pluginMachineOpenAPI.setIsAsync(pluginMachine.getIsAsync());
        // pluginMachineOpenAPI.setResourceBizType(ResourceBizType.TOOL.getCode());
        // pluginMachineOpenAPI.setSystemCode(resourceResponseDto.getSystemCode());
        // pluginMachineOpenAPI.getPaths().forEach((key, value) -> handlePathItem(value, pluginMachine));
        // resultList.add(pluginMachineOpenAPI);
        // }
        // }
        return resultList;
    }

    /**
     * 替换知识库请求地址占位�?将元数据内容中的 ${FEIGN_KNOWLEDGE_URL} 占位符替换为实际的知识库服务地址
     *
     * @param metaContent 元数据内�?
     * @return 替换后的内容，若输入为空则返回null
     */
    public String replaceKnowledgeUrl(String metaContent) {
        if (StringUtil.isEmpty(metaContent)) {
            return null;
        }
        return metaContent.replace("${FEIGN_KNOWLEDGE_URL}", this.knowUrl);
    }

    // /**
    // * 处理路径项的所有HTTP方法 遍历路径项中的所有HTTP方法（GET、POST、PUT、DELETE等），并设置操作参数
    // *
    // * @param pathItem 路径项对�?
    // * @param pluginMachine 插件机器信息
    // */
    // private void handlePathItem(PathItem pathItem, PluginMachineDto pluginMachine) {
    // Operation get = pathItem.getGet();
    // if (get != null) {
    // operateOperation(get, pluginMachine);
    // }
    // Operation put = pathItem.getPut();
    // if (put != null) {
    // operateOperation(put, pluginMachine);
    // }
    // Operation post = pathItem.getPost();
    // if (post != null) {
    // operateOperation(post, pluginMachine);
    // }
    // Operation delete = pathItem.getDelete();
    // if (delete != null) {
    // operateOperation(delete, pluginMachine);
    // }
    // Operation options = pathItem.getOptions();
    // if (options != null) {
    // operateOperation(options, pluginMachine);
    // }
    // Operation head = pathItem.getHead();
    // if (head != null) {
    // operateOperation(head, pluginMachine);
    // }
    // Operation patch = pathItem.getPatch();
    // if (patch != null) {
    // operateOperation(patch, pluginMachine);
    // }
    // Operation trace = pathItem.getTrace();
    // if (trace != null) {
    // operateOperation(trace, pluginMachine);
    // }
    // }

    // /**
    // * 设置操作的ID 将插件机器名称设置为操作ID
    // *
    // * @param operation 操作对象
    // * @param pluginMachine 插件机器信息
    // */
    // private void operateOperation(Operation operation, PluginMachineDto pluginMachine) {
    // operation.setOperationId(pluginMachine.getMachineName());
    // }

    /**
     * 构建工具列表 根据工具资源ID查询工具信息，如果工具属于工具集则从工具集获取，否则直接转换为OpenAPI格式
     *
     * @param resourceIds 资源标识集合
     * @return OpenAI工具列表，若资源标识为空则返回空列表
     */
    public List<OpenAiToolDto> buildToolList(List<Long> resourceIds) {

        if (CollectionUtils.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }

        List<OpenAiToolDto> openAiToolDtoList = new ArrayList<>(10);

        List<ResourceExtToolDto> resourceExtTools = ssResExtToolService.findResourceExtToolByIds(resourceIds);
        for (ResourceExtToolDto resourceExtToolDto : resourceExtTools) {
            Long resourceId = resourceExtToolDto.getResourceId();

            Long toolKitResourceId = ssResExtToolKitService.findToolKitIdByToolsId(resourceId);
            if (toolKitResourceId != null) {
                List<OpenAiToolDto> openAiToolDtos = this.getPluginFunctionInfo(Arrays.asList(toolKitResourceId));
                if (ListUtil.isEmpty(openAiToolDtos)) {
                    continue;
                }

                for (OpenAiToolDto openAiToolDto : openAiToolDtos) {
                    if (resourceId.equals(openAiToolDto.getResourceId())) {
                        openAiToolDtoList.add(openAiToolDto);
                    }
                }
            }
            else {
                OpenAiToolDto openAiToolDto = this.convertToolToOpenAPI(resourceExtToolDto);
                openAiToolDtoList.add(openAiToolDto);
            }
        }

        return openAiToolDtoList;
    }

    /**
     * 获取插件函数信息 从记忆引擎查询工具集的元数据信息，并解析为OpenAI工具格式
     *
     * @param resourceIds 资源标识集合
     * @return OpenAI工具列表
     * @throws BaseException 记忆引擎查询失败时抛�?
     */
    private List<OpenAiToolDto> getPluginFunctionInfo(List<Long> resourceIds) {
        if (CollectionUtils.isEmpty(resourceIds)) {
            return Lists.newArrayList();
        }

        // 从记忆引擎查�?
        List<String> metaIds = new ArrayList<>(10);
        for (Long resourceId : resourceIds) {
            metaIds.add(ResourceBizType.TOOLKIT.getCode() + "_" + resourceId);
        }

        logger.info("工具集查询记忆引擎：metaIds:{}", JSON.toJSONString(metaIds));
        // List<AuAgentMeta> auAgentMetas = auAgentMetaService.batchGet(metaIds);

        List<OpenAiToolDto> resultList = new ArrayList<>(10);
        // for (AuAgentMeta item : auAgentMetas) {
        // String metaContent = item.getMetaContent();
        // if (StringUtil.isEmpty(metaContent)) {
        // continue;
        // }
        //
        // // 替换地址
        // metaContent = this.replaceKnowledgeUrl(metaContent);
        // ResourceResponseDto resourceResponseDto = JSON.parseObject(metaContent, ResourceResponseDto.class);
        //
        // // 添加过滤逻辑：跳过没有PluginMachineInfo的项�?
        // if (CollectionUtils.isEmpty(resourceResponseDto.getPluginMachineInfo())) {
        // continue;
        // }
        //
        // List<PluginMachineInfoDto> pluginMachineInfos = resourceResponseDto.getPluginMachineInfo();
        // for (PluginMachineInfoDto machineInfo : pluginMachineInfos) {
        // PluginMachineDto pluginMachine = machineInfo.getPluginMachine();
        // OpenAiToolDto pluginMachineOpenAPI = machineInfo.getPluginMachineOpenAPI();
        // pluginMachineOpenAPI.setResourceId(pluginMachine.getPluginMachineId());
        // pluginMachineOpenAPI.setResourceName(pluginMachine.getMachineName());
        // pluginMachineOpenAPI.setResourceDesc(pluginMachine.getMachineDesc());
        // pluginMachineOpenAPI.setResourceSourcePkId(pluginMachineOpenAPI.getResourceId());
        // pluginMachineOpenAPI.setResourceType("ATOM");
        // pluginMachineOpenAPI.setIsAsync(pluginMachine.getIsAsync());
        // pluginMachineOpenAPI.setResourceBizType(ResourceBizType.TOOL.getCode());
        // pluginMachineOpenAPI.setSystemCode(resourceResponseDto.getSystemCode());
        // pluginMachineOpenAPI.getPaths().forEach((key, value) -> handlePathItem(value, pluginMachine));
        // resultList.add(pluginMachineOpenAPI);
        // }
        // }
        return resultList;
    }

    /**
     * 将工具转换为OpenAPI格式 根据工具的扩展信息构建完整的OpenAPI规范对象，包括路径参数、查询参数、请求体和响应体
     *
     * @param resourceExtToolDto 资源扩展工具DTO
     * @return OpenAI工具对象
     * @throws BaseException 工具信息解析失败时抛�?
     */
    private OpenAiToolDto convertToolToOpenAPI(ResourceExtToolDto resourceExtToolDto) {

        OpenAiToolDto openAPI = new OpenAiToolDto();
        openAPI.setResourceId(resourceExtToolDto.getResourceId());
        openAPI.setResourceType(resourceExtToolDto.getResourceType());
        openAPI.setResourceBizType(resourceExtToolDto.getResourceBizType());
        openAPI.setResourceName(resourceExtToolDto.getResourceName());
        openAPI.setResourceDesc(resourceExtToolDto.getResourceDesc());
        openAPI.setResourceSourcePkId(resourceExtToolDto.getResourceSourcePkId());

        SsResExtTool ssResExtTool = resourceExtToolDto.getSsResExtTool();

        // 设置基本信息
        openAPI.info(this.createApiInfo(resourceExtToolDto));
        UrlParserUtils.UrlInfo urlInfo;
        try {
            String url = ssResExtTool.getUrl();
            if (StringUtil.isEmpty(url)) {
                logger.error("工具请求URL为空,resourceId: {}", resourceExtToolDto.getResourceId());
                // 使用默认URL
                url = "http://localhost:8080";
            }
            url = this.replaceKnowledgeUrl(ssResExtTool.getUrl());
            urlInfo = UrlParserUtils.parseUrl(url);
        }
        catch (MalformedURLException e) {
            logger.error("Invalid URL: {}, using fallback URL", ssResExtTool.getUrlOri(), e);
            // 使用备用URL
            String fallbackUrl = StringUtil.isNotEmpty(ssResExtTool.getUrlOri()) ? ssResExtTool.getUrlOri()
                : "http://localhost:8080";
            urlInfo = new UrlParserUtils.UrlInfo(fallbackUrl, "/");
        }

        // 设置服务器信�?
        openAPI.addServersItem(new Server().url(urlInfo.getServiceInfo()));

        // 构建路径
        Paths paths = new Paths();
        PathItem pathItem = new PathItem();
        Operation operation = this.createOperation(resourceExtToolDto);

        try {
            // 处理请求�?用了统一的请求头
            this.addHeaders(operation, null, null);

            // 处理路径参数
            this.addPathParameters(operation, ssResExtTool.getPathSchema());

            // 处理查询参数
            this.addQueryParameters(operation, ssResExtTool.getQuerySchema());

            // 处理请求�?
            this.addRequestBody(operation, ssResExtTool.getInputSchema());

            // 处理响应�?
            this.addResponseBody(operation, ssResExtTool.getOutputSchema());

            // 设置HTTP方法
            this.setHttpMethod(pathItem, operation, ssResExtTool.getMethod());

            paths.addPathItem(urlInfo.getUri(), pathItem);
            openAPI.paths(paths);

        }
        catch (JSONException | JsonProcessingException e) {
            logger.error("Failed to convert tool to OpenAPI format", e);
            throw new BaseException(I18nUtil.get("agent.build.tool.info.error", e.getMessage()), e);
        }

        return openAPI;
    }

    /**
     * 创建API基本信息
     *
     * @param resource 资源对象
     * @return API信息对象
     */
    private Info createApiInfo(SsResource resource) {
        return new Info().title(resource != null ? resource.getResourceName() : "")
            .description(resource != null ? resource.getResourceDesc() : "").version("1.0.0");
    }

    /**
     * 创建基本操作信息
     *
     * @param resourceExtToolDto 资源扩展工具DTO
     * @return 操作对象
     */
    private Operation createOperation(ResourceExtToolDto resourceExtToolDto) {
        Operation operation = new Operation();
        operation.operationId(resourceExtToolDto.getResourceName());
        operation.summary(resourceExtToolDto.getResourceName());
        operation.description(resourceExtToolDto.getResourceDesc());
        return operation;
    }

    /**
     * 添加请求头信�?合并工具请求头和系统请求头，并添加系统代�?
     *
     * @param operation 操作对象
     * @param toolHeaders 工具请求头JSON字符�?
     * @param systemHeaders 系统请求头映�?
     */
    private void addHeaders(Operation operation, String toolHeaders, Map<String, String> systemHeaders) {
        JSONObject headers = new JSONObject();
        if (StringUtils.isNotBlank(toolHeaders)) {
            headers.putAll(JSON.parseObject(toolHeaders));
        }
        if (systemHeaders != null) {
            headers.putAll(systemHeaders);
        }
        headers.put("system-code", SystemCode.BYAI.getCode());
        operation.addExtension("x-headers", removeHeadersKey(headers));

    }

    /**
     * 移除请求头中的特定键 移除content-length和host等不应该由客户端设置的请求头
     *
     * @param headers 请求头JSON对象
     * @return 清理后的请求头JSON对象
     */
    private JSONObject removeHeadersKey(JSONObject headers) {
        // 去掉content-length
        List<String> removeKeys = Lists.newArrayList();
        for (String key : headers.keySet()) {
            if ("content-length".equalsIgnoreCase(key)) {
                removeKeys.add(key);
            }
            if ("host".equalsIgnoreCase(key)) {
                removeKeys.add(key);
            }
        }
        if (CollectionUtils.isNotEmpty(removeKeys)) {
            for (String removeKey : removeKeys) {
                headers.remove(removeKey);
            }
        }
        return headers;
    }

    /**
     * 添加路径参数
     *
     * @param operation 操作对象
     * @param pathSchema 路径参数Schema的JSON字符�?
     * @throws JsonProcessingException JSON解析异常
     */
    private void addPathParameters(Operation operation, String pathSchema) throws JsonProcessingException {
        if (StringUtils.isNotBlank(pathSchema)) {
            Schema<?> schema = convertJsonSchemaToOpenApiSchema(pathSchema);
            addParametersFromSchema(operation, schema, "path");
        }
    }

    /**
     * 添加查询参数
     *
     * @param operation 操作对象
     * @param querySchema 查询参数Schema的JSON字符�?
     * @throws JsonProcessingException JSON解析异常
     */
    private void addQueryParameters(Operation operation, String querySchema) throws JsonProcessingException {
        if (StringUtils.isNotBlank(querySchema)) {
            Schema<?> schema = convertJsonSchemaToOpenApiSchema(querySchema);
            addParametersFromSchema(operation, schema, "query");
        }
    }

    /**
     * 从Schema中添加参�?遍历Schema的属性，为每个属性创建参数并添加到操作中
     *
     * @param operation 操作对象
     * @param schema Schema对象
     * @param paramType 参数类型（path或query�?
     */
    private void addParametersFromSchema(Operation operation, Schema<?> schema, String paramType) {
        if (schema != null && schema.getProperties() != null) {
            schema.getProperties().forEach((name, propSchema) -> {
                operation.addParametersItem(new io.swagger.v3.oas.models.parameters.Parameter().name(name).in(paramType)
                    .required(schema.getRequired() != null && schema.getRequired().contains(name)).schema(propSchema));
            });
        }
    }

    /**
     * 添加请求�?
     *
     * @param operation 操作对象
     * @param inputSchema 输入Schema的JSON字符�?
     * @throws JsonProcessingException JSON解析异常
     */
    private void addRequestBody(Operation operation, String inputSchema) throws JsonProcessingException {
        if (StringUtils.isNotBlank(inputSchema)) {
            Schema<?> schema = convertJsonSchemaToOpenApiSchema(inputSchema);
            if (schema != null) {
                RequestBody requestBody = new RequestBody();
                Content content = new Content();
                MediaType mediaType = new MediaType();
                mediaType.schema(schema);
                content.addMediaType("application/json", mediaType);
                requestBody.content(content);
                operation.requestBody(requestBody);
            }
        }
    }

    /**
     * 添加响应�?
     *
     * @param operation 操作对象
     * @param outputSchema 输出Schema的JSON字符�?
     * @throws JsonProcessingException JSON解析异常
     */
    private void addResponseBody(Operation operation, String outputSchema) throws JsonProcessingException {
        if (StringUtils.isNotBlank(outputSchema)) {
            Schema<?> schema = convertJsonSchemaToOpenApiSchema(outputSchema);
            if (schema != null) {
                ApiResponses responses = new ApiResponses();
                ApiResponse response = new ApiResponse().description("成功响应");
                Content content = new Content();
                MediaType mediaType = new MediaType();
                mediaType.schema(schema);
                content.addMediaType("application/json", mediaType);
                response.content(content);
                responses.addApiResponse("200", response);
                operation.responses(responses);
            }
        }
    }

    /**
     * 设置HTTP方法 根据方法名称将操作设置到路径项的对应方法中，默认为POST
     *
     * @param pathItem 路径项对�?
     * @param operation 操作对象
     * @param method HTTP方法名称（get/post/put/delete�?
     */
    private void setHttpMethod(PathItem pathItem, Operation operation, String method) {
        String httpMethod = StringUtils.isNotBlank(method) ? method.toLowerCase() : "post";
        switch (httpMethod) {
            case "get" -> pathItem.get(operation);
            case "post" -> pathItem.post(operation);
            case "put" -> pathItem.put(operation);
            case "delete" -> pathItem.delete(operation);
            default -> pathItem.post(operation);
        }
    }

    /**
     * 将JSON Schema字符串转换为OpenAPI Schema对象
     *
     * @param jsonSchemaNode JSON Schema字符�?
     * @return OpenAPI Schema对象，若输入为空则返回null
     * @throws JsonProcessingException JSON解析异常
     * @throws JsonMappingException JSON映射异常
     */
    private Schema<?> convertJsonSchemaToOpenApiSchema(String jsonSchemaNode)
        throws JsonProcessingException, JsonMappingException {
        if (StringUtils.isBlank(jsonSchemaNode)) {
            return null;
        }
        ObjectMapper objectMapper = new ObjectMapper();
        JsonNode inputNode = objectMapper.readTree(jsonSchemaNode);
        return convertJsonSchemaToOpenApiSchema(inputNode);
    }

    /**
     * 将JSON Schema节点转换为OpenAPI Schema对象 增强的JSON Schema到OpenAPI Schema转换，支持array、object嵌套等复杂类型，包括描述、类型、必需字段、枚举值、默认值等属�?
     *
     * @param jsonSchemaNode JSON Schema节点
     * @return OpenAPI Schema对象，若输入为null则返回null
     */
    private Schema<?> convertJsonSchemaToOpenApiSchema(JsonNode jsonSchemaNode) {
        if (jsonSchemaNode == null || jsonSchemaNode.isNull()) {
            return null;
        }

        Schema<Object> schema = new Schema<>();

        // 处理描述信息
        if (jsonSchemaNode.has("description")) {
            schema.setDescription(jsonSchemaNode.get("description").asText());
        }

        // 处理类型信息
        if (jsonSchemaNode.has("type")) {
            String type = jsonSchemaNode.get("type").asText();
            schema.setType(type);

            // 根据不同类型进行特殊处理
            switch (type.toLowerCase()) {
                case "array":
                    handleArrayType(schema, jsonSchemaNode);
                    break;
                case "object":
                    handleObjectType(schema, jsonSchemaNode);
                    break;
                case "string":
                    handleStringType(schema, jsonSchemaNode);
                    break;
                case "number":
                case "integer":
                    handleNumberType(schema, jsonSchemaNode);
                    break;
                case "boolean":
                default:
                    // 对于其他类型，保持基本类型设�?
                    break;
            }
        }

        // 处理必需字段
        if (jsonSchemaNode.has("required")) {
            JsonNode required = jsonSchemaNode.get("required");
            if (required.isArray()) {
                for (JsonNode req : required) {
                    schema.addRequiredItem(req.asText());
                }
            }
        }

        // 处理枚举�?
        if (jsonSchemaNode.has("enum")) {
            JsonNode enumNode = jsonSchemaNode.get("enum");
            if (enumNode.isArray()) {
                List<Object> enumValues = new ArrayList<>();
                for (JsonNode enumValue : enumNode) {
                    if (enumValue.isTextual()) {
                        enumValues.add(enumValue.asText());
                    }
                    else if (enumValue.isNumber()) {
                        enumValues.add(enumValue.numberValue());
                    }
                    else if (enumValue.isBoolean()) {
                        enumValues.add(enumValue.asBoolean());
                    }
                }
                schema.setEnum(enumValues);
            }
        }

        // 处理默认�?
        if (jsonSchemaNode.has("default")) {
            JsonNode defaultNode = jsonSchemaNode.get("default");
            if (defaultNode.isTextual()) {
                schema.setDefault(defaultNode.asText());
            }
            else if (defaultNode.isNumber()) {
                schema.setDefault(defaultNode.numberValue());
            }
            else if (defaultNode.isBoolean()) {
                schema.setDefault(defaultNode.asBoolean());
            }
        }

        return schema;
    }

    /**
     * 处理数组类型Schema 设置数组的items、minItems、maxItems等属�?
     *
     * @param schema Schema对象
     * @param jsonSchemaNode JSON Schema节点
     */
    private void handleArrayType(Schema<?> schema, JsonNode jsonSchemaNode) {
        if (jsonSchemaNode.has("items")) {
            JsonNode itemsNode = jsonSchemaNode.get("items");
            Schema<?> itemsSchema = convertJsonSchemaToOpenApiSchema(itemsNode);
            schema.setItems(itemsSchema);
        }

        // 处理数组长度限制
        if (jsonSchemaNode.has("minItems")) {
            schema.setMinItems(jsonSchemaNode.get("minItems").asInt());
        }
        if (jsonSchemaNode.has("maxItems")) {
            schema.setMaxItems(jsonSchemaNode.get("maxItems").asInt());
        }
    }

    /**
     * 处理对象类型Schema 设置对象的properties、additionalProperties、minProperties、maxProperties等属�?
     *
     * @param schema Schema对象
     * @param jsonSchemaNode JSON Schema节点
     */
    private void handleObjectType(Schema<?> schema, JsonNode jsonSchemaNode) {
        if (jsonSchemaNode.has("properties")) {
            JsonNode properties = jsonSchemaNode.get("properties");
            properties.fieldNames().forEachRemaining(field -> {
                Schema<?> propertySchema = convertJsonSchemaToOpenApiSchema(properties.get(field));
                schema.addProperties(field, propertySchema);
            });
        }

        // 处理额外属�?
        if (jsonSchemaNode.has("additionalProperties")) {
            JsonNode additionalProps = jsonSchemaNode.get("additionalProperties");
            if (additionalProps.isBoolean()) {
                schema.setAdditionalProperties(additionalProps.asBoolean());
            }
            else {
                Schema<?> additionalSchema = convertJsonSchemaToOpenApiSchema(additionalProps);
                schema.setAdditionalProperties(additionalSchema);
            }
        }

        // 处理对象大小限制
        if (jsonSchemaNode.has("minProperties")) {
            schema.setMinProperties(jsonSchemaNode.get("minProperties").asInt());
        }
        if (jsonSchemaNode.has("maxProperties")) {
            schema.setMaxProperties(jsonSchemaNode.get("maxProperties").asInt());
        }
    }

    /**
     * 处理字符串类型Schema 设置字符串的minLength、maxLength、pattern、format等属�?
     *
     * @param schema Schema对象
     * @param jsonSchemaNode JSON Schema节点
     */
    private void handleStringType(Schema<?> schema, JsonNode jsonSchemaNode) {
        if (jsonSchemaNode.has("minLength")) {
            schema.setMinLength(jsonSchemaNode.get("minLength").asInt());
        }
        if (jsonSchemaNode.has("maxLength")) {
            schema.setMaxLength(jsonSchemaNode.get("maxLength").asInt());
        }
        if (jsonSchemaNode.has("pattern")) {
            schema.setPattern(jsonSchemaNode.get("pattern").asText());
        }
        if (jsonSchemaNode.has("format")) {
            schema.setFormat(jsonSchemaNode.get("format").asText());
        }
    }

    /**
     * 处理数字类型Schema 设置数字的minimum、maximum、exclusiveMinimum、exclusiveMaximum、multipleOf等属�?
     *
     * @param schema Schema对象
     * @param jsonSchemaNode JSON Schema节点
     */
    private void handleNumberType(Schema<?> schema, JsonNode jsonSchemaNode) {
        if (jsonSchemaNode.has("minimum")) {
            schema.setMinimum(jsonSchemaNode.get("minimum").decimalValue());
        }
        if (jsonSchemaNode.has("maximum")) {
            schema.setMaximum(jsonSchemaNode.get("maximum").decimalValue());
        }
        if (jsonSchemaNode.has("exclusiveMinimum")) {
            schema.setExclusiveMinimum(jsonSchemaNode.get("exclusiveMinimum").asBoolean());
        }
        if (jsonSchemaNode.has("exclusiveMaximum")) {
            schema.setExclusiveMaximum(jsonSchemaNode.get("exclusiveMaximum").asBoolean());
        }
        if (jsonSchemaNode.has("multipleOf")) {
            schema.setMultipleOf(jsonSchemaNode.get("multipleOf").decimalValue());
        }
    }

    /**
     * 将智能体核心能力解析成数组
     *
     * @param coreCompetencies 核心能力JSON
     * @return List<CoreCompetency>
     */
    public List<CoreCompetency> parseCompetencies(String coreCompetencies) {
        if (StringUtil.isEmpty(coreCompetencies)) {
            return Collections.emptyList();
        }
        return JSON.parseArray(coreCompetencies, CoreCompetency.class);
    }

    /**
     * 核心格式化方法：将核心能力列表转换成指定文本格式
     *
     * @param name 名称（如"智能助手"）
     * @param competencies 核心能力列表
     * @return 格式化后的文本
     */
    public String formatCoreCompetencies(String name, List<CoreCompetency> competencies) {

        if (ListUtil.isEmpty(competencies)) {
            return null;
        }

        // 构建字符串缓冲区（高效拼接字符串）
        StringBuilder stringBuilder = new StringBuilder();

        // 第一行：我是[name]。我的核心能力有：
        stringBuilder.append("我是").append(name).append("。我的核心能力有：\n");
        // 遍历每个核心能力，拼接内容
        for (CoreCompetency competency : competencies) {
            // 核心能力名称 + 描述
            stringBuilder.append(competency.getCoreCompetency()).append("：").append(competency.getDescription())
                .append("\n");

            // 接受边界（职责）
            stringBuilder.append("这项能力的职责是：");
            List<String> acceptBoundaries = competency.getAcceptBoundary();
            if (acceptBoundaries != null && !acceptBoundaries.isEmpty()) {
                // 用分号拼接所有接受边界
                stringBuilder.append(String.join("；", acceptBoundaries));
            }
            stringBuilder.append("。");

            // 拒绝边界（可选）：如果不为空则添加
            List<String> rejectBoundaries = competency.getRejectBoundary();
            if (rejectBoundaries != null && !rejectBoundaries.isEmpty()) {
                stringBuilder.append("它不能做：").append(String.join("；", rejectBoundaries)).append("。");
            }
            // 换行分隔不同核心能力
            stringBuilder.append("\n");
        }

        return stringBuilder.toString();
    }

    /**
     * 格式化核心能力，旧版本
     *
     * @param name 名称
     * @param ability 能力
     * @param constraints 能力边界
     * @param faqs faqs
     * @return 格式化后的结果
     */
    public String formatAbilityConstraintFaqs(String name, String ability, String constraints, String faqs) {
        if (StringUtil.isEmpty(ability) || StringUtil.isEmpty(constraints)) {
            return null;
        }
        return String.format("我是%s,我的核心能力是%s,我的能力边界是%s,当遇到类似下面的问题时可以找我解决%s", name, ability, constraints, faqs);
    }

    /**
     * 构建人设
     *
     * @param name 资源名称
     * @param roleAttributes 角色属性
     * @param processingFlow 处理流程
     * @param personalityDimensions 用词偏好
     * @return String
     */
    public String formatInstructions(String name, String roleAttributes, String processingFlow,
        String personalityDimensions) {
        if (StringUtil.isEmpty(roleAttributes) && StringUtil.isEmpty(processingFlow)
            && StringUtil.isEmpty(personalityDimensions)) {
            return null;
        }

        StringBuilder stringBuilder = new StringBuilder();

        // 基础说明
        stringBuilder.append("你是").append(name).append("，在处理用户的问题时必须严格遵循下面的行为规范\n");

        // 性格维度：值非空才添加标题+内容
        if (StringUtil.isNotEmpty(personalityDimensions)) {
            stringBuilder.append("### 性格维度\n").append(personalityDimensions).append("\n\n");
        }

        // 用词偏好：值非空才添加标题+内容
        if (StringUtil.isNotEmpty(processingFlow)) {
            stringBuilder.append("### 用词偏好\n").append(processingFlow).append("\n\n");
        }

        // 句式和语气：值非空才添加标题+内容
        if (StringUtil.isNotEmpty(roleAttributes)) {
            stringBuilder.append("### 句式和语气\n").append(roleAttributes);
        }

        // 去除末尾多余的换行
        return stringBuilder.toString().replaceAll("\\n+$", "");
    }

}
