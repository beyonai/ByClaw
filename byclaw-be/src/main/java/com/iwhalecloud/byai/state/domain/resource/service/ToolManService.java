package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.*;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtAgentService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtObjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtViewService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceTargetJsonBuilder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigEmployeeRedisSyncProperties;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.util.DigEmployeeRedisKeys;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetImportDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.CurlParser;
import com.iwhalecloud.byai.common.util.CurlParser.ParsedCurl;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlParseResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportItem;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedObjectOwl;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceImportDiffItem;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedViewField;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedViewOwl;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ToolSaveRequest;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.util.Objects;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.concurrent.TimeUnit;

@Service
public class ToolManService {

    public static final Logger LOGGER = LoggerFactory.getLogger(ToolManService.class);

    /**
     * 知识库/数字员工系统来源配置；配置为 WHALE_AGENT 时表示接入老智能体商业版本，
     * 知识/工具资源由外部智能体体系发布，本系统不允许编辑基础信息或注销。
     */
    @Value("${dataset.system:}")
    private String datasetSystem;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtToolService ssResExtToolService;

    @Autowired
    private SsResExtObjectService ssResExtObjectService;

    @Autowired
    private SsResExtViewService ssResExtViewService;

    @Autowired
    private SsResExtToolKitService ssResExtToolKitService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private SsResExtAgentService ssResExtAgentService;

    @Autowired
    private SsResExtDocService ssResExtDocService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;

    @Autowired
    private DigEmployeeRedisSyncProperties digEmployeeRedisSyncProperties;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private ResourceArtifactStorageService resourceArtifactStorageService;

    @Autowired
    private SsResourceArtifactService ssResourceArtifactService;

    @Autowired
    private ObjectOwlImportParser objectOwlImportParser;

    @Autowired
    private ViewOwlImportParser viewOwlImportParser;

    @Autowired
    private ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private ResourceRuntimeInfoResolver resourceRuntimeInfoResolver;

    @Autowired
    private ResourceTargetJsonBuilder resourceTargetJsonBuilder;

    @Autowired
    private AIService aiService;

    /** 新版工具资源 JSON 导入允许的 resourceBizType */
    private static final Set<String> IMPORT_TOOL_JSON_NEW_BIZ_TYPES = Set.of(
        ResourceBizType.TOOLKIT.getCode(),
        ResourceBizType.MCP.getCode(),
        ResourceBizType.AGENT.getCode()
    );

    private static final Set<String> DELETE_RESOURCE_BIZ_TYPES = Set.of(
            ResourceBizType.TOOL.getCode(),
            ResourceBizType.SKILL.getCode(),
            ResourceBizType.KG_DOC.getCode(),
            ResourceBizType.KG_DB.getCode(),
            ResourceBizType.KG_TERM.getCode(),
            ResourceBizType.KG_QA.getCode(),
            ResourceBizType.OBJECT.getCode(),
            ResourceBizType.VIEW.getCode(),
            ResourceBizType.DIG_EMPLOYEE.getCode(),
            ResourceBizType.TOOLKIT.getCode(),
            ResourceBizType.MCP.getCode(),
            ResourceBizType.AGENT.getCode());

    // 视图、对象owl文件存放在zip内的目录路径说明
    private static final String OBJECT_IMPORT_DIR_NAME = "objects";
    private static final String VIEW_IMPORT_DIR_NAME = "views";
    private static final int MAX_IMPORT_BUNDLE_RESOURCE_COUNT = 20;
    private static final String OBJECT_IMPORT_RESOURCE_SUBDIR = "object";
    private static final String VIEW_IMPORT_RESOURCE_SUBDIR = "view";
    private static final String CURL_GENERATE_SOURCE_RULE = "RULE";
    private static final String CURL_GENERATE_SOURCE_LLM = "LLM";
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);
    private static final Set<String> TOOL_CURL_BIZ_TYPES = Set.of(
            ResourceBizType.TOOL.getCode(),
            ResourceBizType.TOOLKIT.getCode(),
            ResourceBizType.MCP.getCode(),
            ResourceBizType.AGENT.getCode());
    private static final OkHttpClient RESOURCE_CURL_HTTP_CLIENT = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build();

    /**
     * 阶段一：解析 curl，返回结构化预览结果（不入库）
     */
    public CurlParseResult parseCurl(String curlCommand) {
        ParsedCurl parsed = CurlParser.parse(curlCommand);

        CurlParseResult result = new CurlParseResult();
        result.setResourceName(CurlParser.generateToolName(parsed.getPath()));
        result.setResourceDesc("");
        result.setMethod(parsed.getMethod().toLowerCase());
        result.setUrl(parsed.getBaseUrl() + parsed.getPath());
        result.setUrlOri(parsed.getFullUrl());
        result.setCurlRaw(curlCommand);
        result.setBodyParams(CurlParser.extractBodyParams(parsed.getBody()));
        result.setQueryParams(CurlParser.extractQueryParams(parsed.getQueryParams()));
        result.setPathParams(new ArrayList<>());
        result.setHeaderParams(CurlParser.extractHeaderParams(parsed.getHeaders()));


        return result;
    }

    /**
     * 根据资源扩展表 sourceContent 生成测试 curl，优先规则解析，失败后调用大模型兜底。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    public ResourceCurlGenerateResult generateResourceCurl(ResourceCurlGenerateRequest request) {
        Long resourceId = request == null ? null : request.getResourceId();
        ResourceCurlContent content = loadResourceCurlContent(resourceId);
        if (StringUtils.isBlank(content.getSourceContent())) {
            throw new IllegalArgumentException("资源sourceContent为空，无法生成curl脚本");
        }

        ResourceCurlGenerateResult result = new ResourceCurlGenerateResult();
        String curl = tryBuildCurlByRule(content.getSourceContent());
        if (StringUtils.isNotBlank(curl)) {
            result.setCurl(curl);
            result.setSource(CURL_GENERATE_SOURCE_RULE);
            result.setMessage("规则生成成功");
            return result;
        }

        curl = buildCurlByLargeModel(content.getSourceContent());
        validateSafeCurlCommand(curl);
        result.setCurl(curl);
        result.setSource(CURL_GENERATE_SOURCE_LLM);
        result.setMessage("大模型生成成功");
        return result;
    }

    /**
     * 运行资源测试 curl。该方法只解析 curl 并通过 HTTP client 调用，不执行系统 shell。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    public ResourceCurlRunResult runResourceCurl(ResourceCurlRunRequest request) {
        Long resourceId = request == null ? null : request.getResourceId();
        String curl = normalizeCurlLineContinuation(request == null ? null : request.getCurl());
        ResourceCurlContent content = loadResourceCurlContent(resourceId);
        validateSafeCurlCommand(curl);

        ParsedCurl parsed = CurlParser.parse(curl);
        validateCurlTargetHost(parsed.getFullUrl(), content);

        long start = System.currentTimeMillis();
        ResourceCurlRunResult result = new ResourceCurlRunResult();
        try (Response response = RESOURCE_CURL_HTTP_CLIENT.newCall(buildHttpRequest(parsed)).execute()) {
            result.setSuccess(response.isSuccessful());
            result.setStatusCode(response.code());
            result.setHeaders(flattenHeaders(response));
            ResponseBody responseBody = response.body();
            result.setBody(responseBody == null ? "" : responseBody.string());
        } catch (IOException e) {
            result.setSuccess(false);
            result.setErrorMessage(e.getMessage());
        } finally {
            result.setDurationMs(System.currentTimeMillis() - start);
        }
        return result;
    }

    /**
     * 加载工具类资源的 sourceContent 与 targetContent。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private ResourceCurlContent loadResourceCurlContent(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        String resourceBizType = StringUtils.trimToEmpty(resource.getResourceBizType());
        if (!TOOL_CURL_BIZ_TYPES.contains(resourceBizType)) {
            throw new IllegalArgumentException("仅工具类资源支持生成和运行curl脚本");
        }
        ResourceCurlContent content = new ResourceCurlContent();
        content.setResource(resource);

        /**
         *
        if (ResourceBizType.TOOL.getCode().equals(resourceBizType)) {
            SsResExtTool ext = ssResExtToolService.findById(resourceId);
            content.setSourceContent(ext == null ? null : ext.getSourceContent());
            content.setTargetContent(ext == null ? null : ext.getTargetContent());
            return content;
        }
         */
        if (ResourceBizType.TOOLKIT.getCode().equals(resourceBizType)) {
            SsResExtToolKit ext = ssResExtToolKitService.findById(resourceId);
            content.setSourceContent(ext == null ? null : ext.getSourceContent());
            content.setTargetContent(ext == null ? null : ext.getTargetContent());
            return content;
        }
        if (ResourceBizType.MCP.getCode().equals(resourceBizType)) {
            SsResExtMcp ext = ssResExtMcpService.findById(resourceId);
            content.setSourceContent(ext == null ? null : ext.getSourceContent());
            content.setTargetContent(ext == null ? null : ext.getTargetContent());
            return content;
        }
        SsResExtAgent ext = ssResExtAgentService.findById(resourceId);
        content.setSourceContent(ext == null ? null : ext.getSourceContent());
        content.setTargetContent(ext == null ? null : ext.getTargetContent());
        return content;
    }

    /**
     * 尝试通过规则从 sourceContent 生成 curl。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String tryBuildCurlByRule(String sourceContent) {
        String trimmed = StringUtils.trimToEmpty(sourceContent);
        if (StringUtils.startsWithIgnoreCase(trimmed, "curl ")) {
            String normalizedCurl = normalizeCurlLineContinuation(trimmed);
            validateSafeCurlCommand(normalizedCurl);
            return normalizedCurl;
        }
        try {
            JSONObject openApi = resolveOpenApiNode(JSON.parseObject(trimmed, Feature.OrderedField));
            if (openApi == null || openApi.isEmpty()) {
                return null;
            }
            String baseUrl = resolveOpenApiBaseUrl(openApi);
            JSONObject paths = openApi.getJSONObject("paths");
            if (paths == null || paths.isEmpty()) {
                return null;
            }
            String path = paths.keySet().iterator().next();
            JSONObject pathItem = paths.getJSONObject(path);
            String method = resolveFirstHttpMethod(pathItem);
            if (StringUtils.isBlank(baseUrl) || StringUtils.isBlank(path) || StringUtils.isBlank(method)) {
                return null;
            }
            JSONObject operation = pathItem.getJSONObject(method);
            String requestBody = buildCurlRequestBody(operation);
            return buildCurlScript(method, joinUrl(baseUrl, path), requestBody);
        } catch (Exception e) {
            LOGGER.info("规则生成curl失败，将尝试大模型兜底, reason={}", e.getMessage());
            return null;
        }
    }

    /**
     * 从资源 JSON 中解析 OpenAPI 节点。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private JSONObject resolveOpenApiNode(JSONObject root) {
        if (root == null) {
            return null;
        }
        if (root.containsKey("paths")) {
            return root;
        }
        JSONObject openApi = root.getJSONObject("openAPI");
        if (openApi != null) {
            return openApi;
        }
        JSONArray tools = root.getJSONArray("tools");
        if (tools != null && !tools.isEmpty()) {
            JSONObject firstTool = tools.getJSONObject(0);
            return firstTool == null ? null : firstTool.getJSONObject("openAPI");
        }
        return null;
    }

    /**
     * 解析 OpenAPI 基础地址。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String resolveOpenApiBaseUrl(JSONObject openApi) {
        JSONArray servers = openApi.getJSONArray("servers");
        if (servers != null && !servers.isEmpty()) {
            JSONObject server = servers.getJSONObject(0);
            String url = server == null ? null : server.getString("url");
            if (StringUtils.isNotBlank(url)) {
                return url;
            }
        }
        return StringUtils.defaultIfBlank(openApi.getString("domainURL"), openApi.getString("domainUrl"));
    }

    /**
     * 解析 paths 节点中的首个 HTTP 方法。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String resolveFirstHttpMethod(JSONObject pathItem) {
        if (pathItem == null) {
            return null;
        }
        for (String method : List.of("get", "post", "put", "patch", "delete")) {
            if (pathItem.containsKey(method)) {
                return method.toUpperCase(Locale.ROOT);
            }
        }
        return null;
    }

    /**
     * 根据 OpenAPI operation 生成请求体示例。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String buildCurlRequestBody(JSONObject operation) {
        if (operation == null) {
            return null;
        }
        JSONObject requestBody = operation.getJSONObject("requestBody");
        JSONObject content = requestBody == null ? null : requestBody.getJSONObject("content");
        if (content == null || content.isEmpty()) {
            return null;
        }
        JSONObject media = content.getJSONObject(content.keySet().iterator().next());
        if (media == null) {
            return null;
        }
        Object example = media.get("example");
        if (example != null) {
            return JSON.toJSONString(example);
        }
        JSONObject schema = media.getJSONObject("schema");
        JSONObject properties = schema == null ? null : schema.getJSONObject("properties");
        if (properties == null || properties.isEmpty()) {
            return "{}";
        }
        JSONObject body = new JSONObject(true);
        for (String key : properties.keySet()) {
            JSONObject field = properties.getJSONObject(key);
            body.put(key, sampleValueBySchema(field));
        }
        return body.toJSONString();
    }

    /**
     * 根据 JSON Schema 生成字段示例值。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private Object sampleValueBySchema(JSONObject schema) {
        if (schema == null) {
            return "";
        }
        Object example = schema.get("example");
        if (example != null) {
            return example;
        }
        String type = StringUtils.defaultIfBlank(schema.getString("type"), "string");
        return switch (type) {
            case "integer", "number" -> 0;
            case "boolean" -> false;
            case "array" -> new JSONArray();
            case "object" -> new JSONObject(true);
            default -> "";
        };
    }

    /**
     * 组装 shell 风格 curl 文本。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String buildCurlScript(String method, String url, String requestBody) {
        StringBuilder curl = new StringBuilder();
        curl.append("curl -X ").append(method).append(" ").append(shellQuote(url));
        curl.append(" \\\n  -H ").append(shellQuote("Content-Type: application/json"));
        if (StringUtils.isNotBlank(requestBody) && !"GET".equalsIgnoreCase(method)) {
            curl.append(" \\\n  -d ").append(shellQuote(requestBody));
        }
        return curl.toString();
    }

    /**
     * 使用大模型从 sourceContent 兜底生成 curl。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String buildCurlByLargeModel(String sourceContent) {
        String prompt = """
            你是一个严格的接口调试脚本生成器。请根据下面的 sourceContent 生成一条可以直接用于接口调试的 curl 命令。
            要求：
            1. 只输出一条 curl 命令，不要解释，不要思考过程，不要 Markdown 代码块，不要 <think> 标签。
            2. 不要输出分号、管道、重定向、&&、||、反引号、$() 等 shell 控制符。
            3. 优先使用 sourceContent 中的真实 domainURL、servers.url、paths、method、headers、requestBody 示例。
            4. 如果缺少请求体示例，请按 schema 生成最小 JSON 示例。
            5. 最终回答必须以 curl 开头，并且只能包含这一条命令。

            sourceContent:
            %s
            """.formatted(sourceContent);
        return normalizeCurlFromLargeModel(aiService.generateText(prompt, null));
    }

    /**
     * 规范化大模型输出，提取 curl 命令文本。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String normalizeCurlFromLargeModel(String modelOutput) {
        String curl = StringUtils.trimToEmpty(modelOutput);
        curl = curl.replaceAll("(?is)<think>.*?</think>", "");
        curl = curl.replace("```bash", "").replace("```shell", "").replace("```", "").trim();
        String[] lines = curl.split("\\R");
        int commandStartLine = -1;
        for (int i = 0; i < lines.length; i++) {
            if (StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(lines[i]), "curl ")) {
                commandStartLine = i;
            }
        }
        if (commandStartLine >= 0) {
            StringBuilder command = new StringBuilder(StringUtils.trimToEmpty(lines[commandStartLine]));
            for (int i = commandStartLine + 1; i < lines.length; i++) {
                String nextLine = StringUtils.trimToEmpty(lines[i]);
                if (StringUtils.isBlank(nextLine)) {
                    continue;
                }
                if (StringUtils.endsWith(command.toString(), "\\")
                        || StringUtils.startsWith(nextLine, "-")
                        || StringUtils.startsWith(nextLine, "--")) {
                    command.append('\n').append(nextLine);
                    continue;
                }
                break;
            }
            curl = command.toString();
        }
        return normalizeCurlLineContinuation(curl);
    }

    /**
     * 去掉 shell 换行续写符，便于后端解析 curl 参数。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String normalizeCurlLineContinuation(String curl) {
        return StringUtils.trimToEmpty(curl)
                .replace("\\\r\n", " ")
                .replace("\\\n", " ")
                .replace("\\\r", " ");
    }

    /**
     * 校验 curl 文本，避免 shell 控制符进入运行链路。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private void validateSafeCurlCommand(String curl) {
        String trimmed = StringUtils.trimToEmpty(curl);
        if (StringUtils.isBlank(trimmed)) {
            throw new IllegalArgumentException("curl脚本不能为空");
        }
        if (!StringUtils.startsWithIgnoreCase(trimmed, "curl ")) {
            throw new IllegalArgumentException("仅支持curl命令");
        }
        validateNoUnquotedShellControl(trimmed);
    }

    /**
     * 仅拦截未被引号包裹的 shell 控制符，避免 JSON 请求体中的普通字符被误判。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private void validateNoUnquotedShellControl(String curl) {
        boolean inSingleQuote = false;
        boolean inDoubleQuote = false;
        boolean escape = false;
        for (int i = 0; i < curl.length(); i++) {
            char current = curl.charAt(i);
            if (escape) {
                escape = false;
                continue;
            }
            if (current == '\\' && !inSingleQuote) {
                escape = true;
                continue;
            }
            if (current == '\'' && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (current == '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
            if (inSingleQuote || inDoubleQuote) {
                continue;
            }
            char next = i + 1 < curl.length() ? curl.charAt(i + 1) : '\0';
            if (current == '`' || (current == '$' && next == '(')) {
                throw new IllegalArgumentException("curl脚本包含不允许的shell控制符");
            }
        }
    }

    /**
     * 校验 curl 目标域名必须在当前资源定义范围内。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private void validateCurlTargetHost(String fullUrl, ResourceCurlContent content) {
        Set<String> allowedHosts = extractHosts(content.getSourceContent());
        allowedHosts.addAll(extractHosts(content.getTargetContent()));
        if (allowedHosts.isEmpty()) {
            return;
        }
        String host = parseHost(fullUrl);
        if (StringUtils.isBlank(host) || !allowedHosts.contains(host)) {
            throw new IllegalArgumentException("curl目标地址不在当前资源定义范围内");
        }
    }

    /**
     * 从文本中提取 URL host。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private Set<String> extractHosts(String content) {
        Set<String> hosts = new HashSet<>();
        if (StringUtils.isBlank(content)) {
            return hosts;
        }
        Matcher matcher = URL_PATTERN.matcher(content);
        while (matcher.find()) {
            String host = parseHost(matcher.group());
            if (StringUtils.isNotBlank(host)) {
                hosts.add(host);
            }
        }
        return hosts;
    }

    /**
     * 解析 URL host。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String parseHost(String url) {
        try {
            URI uri = URI.create(url);
            return StringUtils.lowerCase(uri.getHost());
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 将解析后的 curl 转成 OkHttp 请求。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private Request buildHttpRequest(ParsedCurl parsed) {
        Request.Builder builder = new Request.Builder().url(parsed.getFullUrl());
        parsed.getHeaders().forEach(builder::addHeader);
        RequestBody requestBody = null;
        if (StringUtils.isNotBlank(parsed.getBody())) {
            String contentType = parsed.getHeaders().getOrDefault("Content-Type",
                    parsed.getHeaders().getOrDefault("content-type", "application/json"));
            requestBody = RequestBody.create(parsed.getBody(), MediaType.parse(contentType));
        }
        String method = StringUtils.upperCase(parsed.getMethod());
        if (requestBody == null && Set.of("POST", "PUT", "PATCH").contains(method)) {
            requestBody = RequestBody.create("", MediaType.parse("application/octet-stream"));
        }
        builder.method(method, requestBody);
        return builder.build();
    }

    /**
     * 将响应头压平成前端容易展示的 Map。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private Map<String, String> flattenHeaders(Response response) {
        Map<String, String> headers = new LinkedHashMap<>();
        response.headers().names().forEach(name -> headers.put(name, response.header(name)));
        return headers;
    }

    /**
     * 拼接 baseUrl 与 path。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String joinUrl(String baseUrl, String path) {
        String safeBase = StringUtils.removeEnd(StringUtils.trimToEmpty(baseUrl), "/");
        String safePath = StringUtils.prependIfMissing(StringUtils.trimToEmpty(path), "/");
        return safeBase + safePath;
    }

    /**
     * 对 shell 参数做单引号包裹。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private String shellQuote(String value) {
        return "'" + StringUtils.defaultString(value).replace("'", "'\"'\"'") + "'";
    }

    /**
     * 阶段二：用户补全描述后保存入库
     */
    public void saveTool(ToolSaveRequest request) {
        // 1. 用带描述的参数重新生成 OpenAPI JSON
        String openApiJson = CurlParser.toOpenApiJsonWithDesc(
                request.getResourceName(),
                request.getResourceDesc(),
                request.getMethod(),
                request.getUrl(),
                request.getBodyParams(),
                request.getQueryParams(),
                request.getPathParams(),
                request.getHeaderParams()
        );

        // 2. 包装为带 tool 元信息的完整格式
        Long resourceId = sequenceService.nextVal();
        String wrappedJson = CurlParser.wrapOpenApiJson(
                request.getResourceName(),
                request.getResourceDesc(),
                resourceId,
                openApiJson
        );

        // 3. 写入 ss_resource
        SsResource ssResource = new SsResource();
        ssResource.setResourceId(resourceId);
        ssResource.setResourceName(request.getResourceName());
        ssResource.setResourceDesc(request.getResourceDesc());
        ssResource.setResourceBizType("TOOL");
        ssResource.setResourceType("ATOM");
        ssResource.setHostType("hosted");
        ssResource.setCatalogId(request.getCatalogId());
        ssResource.setAuthStatus("passed");
        ssResource.setPublishPortal(1);
        ssResource.setParentResourceId(-1L);
        ssResource.setPublishType("publish");
        ssResource.setResourceStatus(ResourceStatus.LIST.getNum());
        ssResource.setCreateTime(new Date());
        ssResource.setUpdateTime(new Date());
        ssResource.setPublishTime(new Date());
        ssResource.setSystemCode(SystemCode.BYAI.getCode());
        ssResource.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceService.save(ssResource);

        // 4. 写入 ss_res_ext_tool
        SsResExtTool ssResExtTool = new SsResExtTool();
        ssResExtTool.setResourceId(resourceId);
        ssResExtTool.setToolAddType(Constants.CURL);
        ssResExtTool.setSourceContent(request.getCurlRaw());
        ssResExtTool.setTargetContent(wrappedJson);
        ssResExtToolService.save(ssResExtTool);
        authApplicationService.ensureCreatorDefaultPrivileges(ssResource);
    }

    /**
     * 新版资源 JSON 导入：仅处理 TOOLKIT / MCP / AGENT 三类资源。
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> importToolJsonNewFromMultipart(MultipartFile file, Long catalogId, String ownerType) {
        // 1. 先把上传文件读成原始 JSON 字符串，并按保序模式解析，
        //    这样后面往 target_content 里补 resourceId 时，字段顺序可控。
        String jsonStr = validateAndReadFile(file);
        JSONObject root = JSON.parseObject(jsonStr, Feature.OrderedField);

        // 2. 新入口只支持 TOOLKIT / MCP / AGENT 三类资源，
        //    这里统一校验基础字段和 resourceBizType 的合法性。
        validateToolJsonNewFields(root);

        // 3. 这条链需要回填主表的创建人、更新人等登录态信息，
        //    因此在真正写库前先拦一下未登录场景。
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || Objects.equals(userId, (long) Integer.MIN_VALUE)) {
            throw new BdpRuntimeException(I18nUtil.get("user.session.invalid"));
        }

        // 4. 把主流程真正需要的核心字段先取出来，避免后面多次从 JSON 里散落读取。
        String resourceCode = StringUtils.trimToEmpty(root.getString("resourceCode"));
        String resourceBizType = StringUtils.trimToEmpty(root.getString("resourceBizType"));
        String resourceName = StringUtils.trimToEmpty(root.getString("resourceName"));
        String resourceDesc = StringUtils.trimToEmpty(root.getString("resourceDesc"));
        String systemCode = StringUtils.trimToEmpty(root.getString("systemCode"));
        String version = StringUtils.trimToEmpty(root.getString("version"));

        //如果前端没有传implType，则默认为API （目前智能体调，后续其他传要明确传implType），回头告诉伟斌必传过来
        String implType = StringUtils.defaultIfBlank(StringUtils.trimToEmpty(root.getString("implType")),
            ImplType.API.getCode());
        root.put("implType", implType);
        Long effectiveCatalogId = catalogId != null ? catalogId : 0L;

        // 这里是复用，前端界面导入是显式传了ownerType，但是智能体post过来是显式传的（都在json内容里面）
        if (StringUtils.isEmpty(ownerType)) {
            ownerType = root.getString("ownerType");
        }

        // 5. 以 resourceCode 作为幂等键：存在则更新，不存在则新增。
        SsResource existing = resolveUniqueResourceByCode(resourceCode, "对象");
        ResourceImportOwnerTypeValidator.validate(existing, ownerType, resourceCode, resourceName, resourceBizType);
        validateImportUpdatePermission(existing, resourceCode);
        boolean updated = existing != null;
        String oldTargetContent = updated ? findTargetContentByBizType(resourceBizType, existing.getResourceId()) : null;

        // 6. 主表统一复用 SsResourceService：
        //    新增走 createResource，更新走 update。
        SsResource resource = saveOrUpdateToolJsonNewMain(existing, resourceBizType, resourceCode, resourceName,
            resourceDesc, ownerType, systemCode, version, effectiveCatalogId, implType);

        // 7. 子表统一保留两份内容：
        //    source_content 存原始 JSON，
        //    target_content 存增加 resourceId 首节点后的新 JSON。
        String finalJsonStr = resourceTargetJsonBuilder.buildWithResourceIdFirst(root, resource, true);
        saveOrUpdateToolJsonNewExt(resourceBizType, resource.getResourceId(), jsonStr, finalJsonStr);

        // 8. 与其他资源导入链保持一致，清空草稿/正式版本号痕迹后，
        //    再把最终 JSON 同步到开放资源目录。
        ssResourceService.clearResourceDraftAndReleaseVerIds(resource.getResourceId());
        resourceArtifactStorageService.syncResourceJsonByBizType(finalJsonStr, resourceBizType, resource.getResourceId());
        ssResourceArtifactService.upsertStandardJsonArtifact(resource.getResourceId(), resourceBizType,
            "tool-json-import");

        if (updated) {
            LOGGER.info("工具JSON导入完成，准备重注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}", resourceBizType, resource.getResourceId(), resourceCode);
            resourceDiscoveryRegistrationService.reregisterAfterCommit(resourceBizType, resource.getResourceId(), resourceCode, oldTargetContent, finalJsonStr);
        } else {
            LOGGER.info("工具JSON导入完成，准备注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}", resourceBizType, resource.getResourceId(), resourceCode);
            resourceDiscoveryRegistrationService.registerAfterCommit(resourceBizType, resource.getResourceId(), resourceCode, finalJsonStr);
        }

        // 9. 返回 resourceId 和本次是否为更新，方便前端联调时判断导入结果。
        Map<String, Object> data = new HashMap<>(4);
        data.put("resourceId", String.valueOf(resource.getResourceId()));
        data.put("updated", updated);
        return data;
    }

    /**
     * 开放接口工具 JSON 导入。
     *
     * 调用方直接传入 JSON 字符串内容，这里统一包装成内存型 MultipartFile，
     * 然后根据 resourceBizType 分流到工具导入或知识库导入主流程，保证开放接口与页面导入规则完全一致。
     *
     * @author qin.guoquan
     * @date 2026-04-23 16:25:00
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> addToolFromThird(String jsonContent) {

        if (StringUtils.isBlank(jsonContent)) {
            throw new IllegalArgumentException(I18nUtil.get("file.notempty"));
        }

        JSONObject root = JSON.parseObject(jsonContent, Feature.OrderedField);
        if (root == null) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.request.body.parse.failed"));
        }

        String resourceBizType = StringUtils.trimToEmpty(root.getString("resourceBizType"));
        if (StringUtils.isBlank(resourceBizType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.biz.type.missing"));
        }
        Long effectiveCatalogId = resolveAddToolFromThirdCatalogId(root);

        byte[] content = jsonContent.getBytes(StandardCharsets.UTF_8);
        MultipartFile multipartFile = new MultipartFileUtil("file", "tool.json", "application/json", content);

        return executeWithOpenApiImportLoginContext(
            () -> addToolFromThirdByBizType(multipartFile, root, resourceBizType, effectiveCatalogId));
    }

    /**
     * 第三方导入目录从 JSON 顶层 catalogId 获取，缺省时默认 0。
     */
    private Long resolveAddToolFromThirdCatalogId(JSONObject root) {
        Long bodyCatalogId = root.getLong("catalogId");
        return bodyCatalogId != null ? bodyCatalogId : 0L;
    }

    /**
     * 开放接口导入分流。
     *
     * TOOLKIT、MCP、AGENT 复用工具 JSON 导入主流程；
     * KG_ 开头的资源复用知识库 JSON 导入主流程。
     *
     * @author qin.guoquan
     * @date 2026-04-23 16:58:00
     */
    private Map<String, Object> addToolFromThirdByBizType(MultipartFile multipartFile, JSONObject root,
        String resourceBizType, Long catalogId) {

        // 校验智能体post过来的文件内容
        String rawJson = parseAndValidateFile(multipartFile);
        DatasetImportDto dto = JSON.parseObject(rawJson, DatasetImportDto.class);
        if (dto == null) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.parse.failed"));
        }

        String ownerType = dto.getOwnerType();

        if (StringUtil.isEmpty(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.owner.type.notempty"));
        }

        Set<String> OWNER_TYPE = new HashSet<>(Arrays.asList(OwnerType.ENTERPRISE, OwnerType.PERSONAL));
        if (!OWNER_TYPE.contains(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.owner.type.invalid"));
        }


        if (StringUtils.equalsAny(resourceBizType,
            ResourceBizType.TOOLKIT.getCode(),
            ResourceBizType.MCP.getCode(),
            ResourceBizType.AGENT.getCode())) {
            return importToolJsonNewFromMultipart(multipartFile, catalogId, ownerType);
        }

        if (StringUtils.startsWithIgnoreCase(resourceBizType, "KG_")) {
            String resourceCode = StringUtils.trimToEmpty(root.getString("resourceCode"));
            SsResource existing = StringUtils.isBlank(resourceCode) ? null : ssResourceService.findByIdOrCode(null, resourceCode);
            Long resourceId = datasetApplicationService.importDatasetJson(ownerType, catalogId, multipartFile);
            Map<String, Object> data = new HashMap<>(4);
            data.put("resourceId", String.valueOf(resourceId));
            data.put("updated", existing != null);
            return data;
        }

        throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.biz.type.invalid.with.kg"));
    }


    private String parseAndValidateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.content.notempty"));
        }
        try {
            return new String(file.getBytes(), StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.content.read.failed"));
        }
    }

    /**
     * 对象超市：上传对象压缩包，批量解析 objects 目录下的一级对象目录并导入。
     */
    @Transactional(rollbackFor = Exception.class)
    public ObjectZipImportResult importObjectZipFromMultipart(MultipartFile file, Long catalogId, String ownerType) {
        // 1. 校验请求参数，并把前端上传的 zip 原样落盘。
        validateObjectZipRequest(file, ownerType);

        // 2. 在 zip 同级目录解压，后续解析 owl 与本地产物复用都基于这个目录。
        Path storedZipPath = saveUploadedZip(file);
        Path extractedRoot = unzipBesideZip(storedZipPath);
        Path objectsRoot = extractedRoot;

        // 3. 对象 bundle 与视图 bundle 保持一致：
        //    原始 zip 先放入同名 staging 目录 object/{zipNameWithoutExt}/，
        //    解压目录完整同步到 object/{zipNameWithoutExt}/，
        //    每个对象 JSON 直接发布到 object/ 根目录下，
        //    最后 staging 目录整体切换成 OBJECT_{id1&id2}/OBJECT_{id1&id2}.zip。
        String zipUploadSubDirectory = buildZipUploadSubDirectory(OBJECT_IMPORT_RESOURCE_SUBDIR);
        String bundleStagingDirectory = buildJsonUploadSubDirectory(OBJECT_IMPORT_RESOURCE_SUBDIR, extractedRoot);
        String jsonUploadSubDirectory = OBJECT_IMPORT_RESOURCE_SUBDIR;
        String originalZipFileName = storedZipPath.getFileName().toString();
        stageImportedBundleDirectory(storedZipPath, extractedRoot, bundleStagingDirectory,
            zipUploadSubDirectory + "/" + originalZipFileName);
        LOGGER.info("对象压缩包导入开始, localZipPath={}, extractedRoot={}, resourceZipDir={}, resourceJsonDir={}",
            storedZipPath, extractedRoot, zipUploadSubDirectory, jsonUploadSubDirectory);

        // 4. 导入链需要回填创建人、更新时间等主表字段，因此先校验登录态。
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || Objects.equals(userId, (long) Integer.MIN_VALUE)) {
            throw new BdpRuntimeException(I18nUtil.get("user.session.invalid"));
        }

        ObjectZipImportResult result = new ObjectZipImportResult();
        List<Long> importedResourceIds = new ArrayList<>();
        List<String> importedResourceCodes = new ArrayList<>();
        Date now = new Date();

        try (var objectDirs = Files.list(objectsRoot)) {
            // 5. 解压目录下每个一级子目录代表一个对象，
            //    优先扫描一级子目录第一层中的 *definition.owl；
            //    若 zip 直接把对象文件落在根目录，也补充扫描根目录第一层中的 *definition.owl。
            List<Path> objectDirList = objectDirs
                .filter(Files::isDirectory)
                .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                .collect(Collectors.toList());
            LOGGER.info("对象目录第一层扫描结果, objectsRoot={}, entries={}", objectsRoot,
                objectDirList.stream().map(path -> path.getFileName().toString()).collect(Collectors.toList()));
            List<Path> definitionOwls = findDefinitionOwlFilesInZipRootOrFirstLevelDirectories(objectsRoot,
                objectDirList);
            validateSingleDefinitionOwl(definitionOwls, "对象");
            Path objectDir = definitionOwls.get(0).getParent();
            result.setTotal(1);

            ObjectZipImportItem item = importSingleObjectDirectory(objectDir, catalogId, ownerType, userId, now,
                importedResourceIds, jsonUploadSubDirectory);
            result.getItems().add(item);
            if (item.isSuccess()) {
                result.setSuccess(1);
                importedResourceCodes.add(item.getResourceCode());
            } else {
                result.setFailed(1);
            }
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.directory.read.failed"));
        }

        fillImportResultSummary(result);

        validateImportedBundleResult(result, importedResourceIds, "对象");

        // 6. zip 保留原始文件名；解压目录仅在“目录名和对象编码不一致”时，才对齐成对象编码。
        String finalDirectoryName = resolveImportedBundleDirectoryName(extractedRoot.getFileName().toString(),
            importedResourceCodes, "对象");
        Path finalExtractedRoot = renameLocalImportedDirectoryIfNecessary(extractedRoot, finalDirectoryName, "对象");

        String finalDirRelativePath = zipUploadSubDirectory + "/" + finalExtractedRoot.getFileName();
        finalizeImportedBundleDirectory(bundleStagingDirectory, finalDirRelativePath, originalZipFileName,
            zipUploadSubDirectory);
        replaceImportedBundleArtifacts(importedResourceIds, ResourceBizType.OBJECT.getCode(), finalDirRelativePath,
            originalZipFileName);

        LOGGER.info("对象压缩包导入完成, zipFileName={}, resourceBundleDir={}, resourceZipPath={}, importedResourceIds={}",
            storedZipPath.getFileName(), finalDirRelativePath, finalDirRelativePath + "/" + storedZipPath.getFileName(),
            importedResourceIds);
        result.setZipFileName(storedZipPath.getFileName().toString());
        return result;
    }

    /**
     * 视图超市：上传视图压缩包，批量解析 views 目录下一级视图目录中的 *definition.owl 并导入。
     */
    @Transactional(rollbackFor = Exception.class)
    public ObjectZipImportResult importViewZipFromMultipart(MultipartFile file, Long catalogId, String ownerType) {
        // 1. 校验请求参数，并把前端上传的 zip 原样落盘。
        validateViewZipRequest(file, ownerType);

        // 2. 在 zip 同级目录解压，后续解析 owl、生成 targetContent JSON 都基于这个目录。
        Path storedZipPath = saveUploadedZip(file);
        Path extractedRoot = unzipBesideZip(storedZipPath);
        Path viewsRoot = extractedRoot;

        // 3. 约定：原始 zip 先放入同名 staging 目录 view/{zipNameWithoutExt}/，
        //    staging 目录里只保留 zip 与原始解压内容，
        //    每个视图 JSON 直接发布到 view/ 根目录下，
        //    全部视图处理完成后再统一把目录收口成 VIEW_{id1&id2}，并把 zip 改成最终 bundle 名放到目录内。
        String zipUploadSubDirectory = buildZipUploadSubDirectory(VIEW_IMPORT_RESOURCE_SUBDIR);
        String bundleStagingDirectory = buildJsonUploadSubDirectory(VIEW_IMPORT_RESOURCE_SUBDIR, extractedRoot);
        String jsonUploadSubDirectory = VIEW_IMPORT_RESOURCE_SUBDIR;
        String originalZipFileName = storedZipPath.getFileName().toString();
        // 重复导入同名压缩包时，先清理旧的 staging 目录，确保本次解压内容和后续 JSON 是一套全新的产物。
        stageImportedBundleDirectory(storedZipPath, extractedRoot, bundleStagingDirectory,
            zipUploadSubDirectory + "/" + originalZipFileName);
        LOGGER.info("视图压缩包导入开始, localZipPath={}, extractedRoot={}, resourceZipDir={}, resourceJsonDir={}",
            storedZipPath, extractedRoot, zipUploadSubDirectory, jsonUploadSubDirectory);

        // 4. 导入链需要回填创建人、更新时间等主表字段，因此先校验登录态。
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || Objects.equals(userId, (long) Integer.MIN_VALUE)) {
            throw new BdpRuntimeException(I18nUtil.get("user.session.invalid"));
        }

        ObjectZipImportResult result = new ObjectZipImportResult();
        List<Long> importedResourceIds = new ArrayList<>();
        List<String> importedResourceCodes = new ArrayList<>();
        Date now = new Date();

        try (var viewDirectories = Files.list(viewsRoot)) {
            // 5. 解压目录下每个一级子目录代表一个视图，
            //    优先扫描一级子目录第一层中的 *definition.owl；
            //    若 zip 直接把视图文件落在根目录，也补充扫描根目录第一层中的 *definition.owl。
            List<Path> viewDirList = viewDirectories
                .filter(Files::isDirectory)
                .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                .collect(Collectors.toList());
            LOGGER.info("视图目录第一层扫描结果, viewsRoot={}, entries={}", viewsRoot,
                viewDirList.stream().map(path -> path.getFileName().toString()).collect(Collectors.toList()));
            List<Path> definitionOwls = findDefinitionOwlFilesInZipRootOrFirstLevelDirectories(viewsRoot, viewDirList);
            validateSingleDefinitionOwl(definitionOwls, "视图");
            Path viewDir = definitionOwls.get(0).getParent();
            result.setTotal(1);

            ObjectZipImportItem item = importSingleViewDirectory(viewDir, catalogId, ownerType, userId, now,
                importedResourceIds, jsonUploadSubDirectory);
            result.getItems().add(item);
            if (item.isSuccess()) {
                result.setSuccess(1);
                importedResourceCodes.add(item.getResourceCode());
            } else {
                result.setFailed(1);
            }
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.view.directory.read.failed"));
        }

        fillImportResultSummary(result);

        validateImportedBundleResult(result, importedResourceIds, "视图");

        // 6. zip 保留原始文件名；解压目录仅在“目录名和视图编码不一致”时，才对齐成视图编码。
        String finalDirectoryName = resolveImportedBundleDirectoryName(extractedRoot.getFileName().toString(),
            importedResourceCodes, "视图");
        Path finalExtractedRoot = renameLocalImportedDirectoryIfNecessary(extractedRoot, finalDirectoryName, "视图");

        String finalDirRelativePath = zipUploadSubDirectory + "/" + finalExtractedRoot.getFileName();
        // 若历史上已经存在同名 bundle，则先清理旧 bundle，再把这次 staging 目录整体提升为最终目录。
        finalizeImportedBundleDirectory(bundleStagingDirectory, finalDirRelativePath, originalZipFileName,
            zipUploadSubDirectory);
        replaceImportedBundleArtifacts(importedResourceIds, ResourceBizType.VIEW.getCode(), finalDirRelativePath,
            originalZipFileName);

        LOGGER.info("视图压缩包导入完成, zipFileName={}, resourceBundleDir={}, resourceZipPath={}, importedResourceIds={}",
            storedZipPath.getFileName(), finalDirRelativePath, finalDirRelativePath + "/" + storedZipPath.getFileName(),
            importedResourceIds);
        result.setZipFileName(storedZipPath.getFileName().toString());
        return result;
    }

    /**
     * 删除资源。
     * 删除前先校验是否被数字员工关联；若已关联，则提示先去数字员工管理界面解除关系。
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteManagedResource(Long resourceId) {
        deleteManagedResource(resourceId, false);
    }

    /**
     * 删除资源。
     *
     * forceDelete=false 时会校验资源类型和资源引用关系；forceDelete=true 时跳过这些校验，直接清理主表、子表和资源关系。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:45:00
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteManagedResource(Long resourceId, boolean forceDelete) {
        // 1. 校验请求参数。
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }

        // 2. 查询主表资源，确认资源存在。
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        validateResourceManagePermission(resource);
        String resourceBizType = StringUtils.trimToEmpty(resource.getResourceBizType());
        // 商业版本（dataset.system=WHALE_AGENT）下，知识/工具由智能体门户发布，本系统不允许注销。
        validateCommercialEditionKnowledgeOrToolWritable(resource);
        String targetContent = findTargetContentByBizType(resourceBizType, resourceId);

        if (!forceDelete) {
            validateResourceCanDelete(resourceId, resource, resourceBizType);
        }

        // 5. 软删除：仅把 ss_resource.resource_status 置为 REMOVED(3)，保留主表、扩展表与资源关系，
        //    让前端"已注销"筛选项可以查询到这些记录；运行期副作用（产物/缓存/注册等）继续清理。
        resource.setResourceStatus(ResourceStatus.REMOVED.getNum());
        resource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        resource.setUpdateTime(new Date());
        ssResourceService.updateResourceEntity(resource);

        // 6. 删除资源发布到开放资源目录的标准 JSON 产物。
        resourceArtifactStorageService.deleteResourceJsonByBizType(resourceBizType, resourceId);

        // 7. 若是数字员工，删除后同步清理其技能 Redis 缓存。
        removeDigEmployeeFromRedisIfNecessary(resourceId, resourceBizType);
        if (StringUtils.equals(resourceBizType, ResourceBizType.DIG_EMPLOYEE.getCode())) {
            // 数字员工注销若曾被任意用户设为默认助理，回退到各自超级助手，避免“默认指向已注销资源”。
            digitalEmployeeApplicationService.resetDefaultForAffectedUsers(resourceId);
            digEmployeeChangeEventPublisher.publishNowQuietly(DigEmployeeChangeEventType.DIG_EMPLOYEE_DELETED,
                resourceId, "tool-man-service");
        }

        // 8. 删除资源后，同步反注册其对应的服务（前面新增时注册上来的）
        if (shouldRegisterDiscoveryService(resourceBizType)) {
            LOGGER.info("资源软删除完成，准备反注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}", resourceBizType, resourceId, resource.getResourceCode());
            resourceDiscoveryRegistrationService.unregisterAfterCommit(resourceBizType, resourceId, resource.getResourceCode(), targetContent);
        }

    }

    @Transactional(rollbackFor = Exception.class)
    public void deleteResourceAndAllRel(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }

        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        validateResourceManagePermission(resource);
        validateCommercialEditionKnowledgeOrToolWritable(resource);

        String resourceBizType = StringUtils.trimToEmpty(resource.getResourceBizType());
        String targetContent = findTargetContentByBizType(resourceBizType, resourceId);

        deleteRegisteredArtifacts(resourceId, resourceBizType);
        privilegeGrantService.removeAllByGrantObj(resourceBizType, resourceId);
        ssResourceRelDetailService.removeAllByResourceIdOrRelResourceId(resourceId);
        deleteResourceExtByBizType(resourceId, resourceBizType);
        ssResourceService.removeById(resourceId);
        removeDigEmployeeFromRedisIfNecessary(resourceId, resourceBizType);
        if (StringUtils.equals(resourceBizType, ResourceBizType.DIG_EMPLOYEE.getCode())) {
            // 硬删除也需要回退默认助理指向，避免遗留无效引用。
            digitalEmployeeApplicationService.resetDefaultForAffectedUsers(resourceId);
            digEmployeeChangeEventPublisher.publishNowQuietly(DigEmployeeChangeEventType.DIG_EMPLOYEE_DELETED,
                resourceId, "tool-man-service-hard-delete");
        }
        if (shouldRegisterDiscoveryService(resourceBizType)) {
            LOGGER.info("资源硬删除完成，准备反注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}", resourceBizType,
                resourceId, resource.getResourceCode());
            resourceDiscoveryRegistrationService.unregisterAfterCommit(resourceBizType, resourceId,
                resource.getResourceCode(), targetContent);
        }
        ssResourceArtifactService.removeArtifactsByResourceId(resourceId);
    }

    /**
     * 删除资源前的业务校验。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:45:00
     */
    private void validateResourceCanDelete(Long resourceId, SsResource resource, String resourceBizType) {
        // 校验当前资源类型是否在本接口支持删除的范围内。
        if (!DELETE_RESOURCE_BIZ_TYPES.contains(resourceBizType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.delete.type.unsupported"));
        }

        // 反查数字员工是否关联了当前资源。
        // 若存在关联，则直接阻断删除，并提示前端先去数字员工管理界面解除关系。
        validateNoDigEmployeeRelation(resourceId, resource);

        if (StringUtils.equals(resourceBizType, ResourceBizType.OBJECT.getCode())) {
            validateNoViewRelation(resourceId, resource);
        }
    }

    /**
     * 恢复资源。
     * 将已注销（状态3）的资源恢复为已上架（状态2），并重新生成产物、同步缓存和注册服务。
     *
     * @author liu.yafei
     * @date 2026-05-14
     */
    public void restoreManagedResource(Long resourceId) {
        restoreManagedResource(resourceId, false);
    }

    /**
     * 恢复资源。
     *
     * @author liu.yafei
     * @date 2026-05-14
     */
    @Transactional(rollbackFor = Exception.class)
    public void restoreManagedResource(Long resourceId, boolean forceRestore) {
        // 1. 校验请求参数。
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }

        // 2. 查询主表资源，确认资源存在。
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        validateResourceManagePermission(resource);
        String resourceBizType = StringUtils.trimToEmpty(resource.getResourceBizType());
        // 商业版本（dataset.system=WHALE_AGENT）下，知识/工具由智能体门户发布，本系统不允许恢复。
        validateCommercialEditionKnowledgeOrToolWritable(resource);
        String targetContent = findTargetContentByBizType(resourceBizType, resourceId);

        if (!forceRestore) {
            validateResourceCanRestore(resourceId, resource, resourceBizType);
        }

        // 5. 恢复：将资源状态从已注销（3）改为已上架（2）。
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        resource.setUpdateTime(new Date());
        ssResourceService.updateResourceEntity(resource);

        // 6. 重新保存资源发布到开放资源目录的标准 JSON 产物（参考更新接口）。
        updateExtTargetContentAndSync(resource);

        // 7. 若是数字员工，恢复后重新同步其技能到 Redis 缓存。
        if (StringUtils.equals(resourceBizType, ResourceBizType.DIG_EMPLOYEE.getCode())) {
            digEmployeeChangeEventPublisher.publishNowQuietly(DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED,
                resourceId, "tool-man-service");
        }

        // 8. 恢复资源后，同步重新注册其对应的服务。
        if (shouldRegisterDiscoveryService(resourceBizType)) {
            LOGGER.info("资源恢复完成，准备重新注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}", resourceBizType, resourceId, resource.getResourceCode());
            resourceDiscoveryRegistrationService.registerAfterCommit(resourceBizType, resourceId, resource.getResourceCode(), targetContent);
        }
    }

    /**
     * 恢复资源前的业务校验。
     *
     * @author liu.yafei
     * @date 2026-05-14
     */
    private void validateResourceCanRestore(Long resourceId, SsResource resource, String resourceBizType) {
        // 校验当前资源类型是否在本接口支持恢复的范围内（同删除类型）。
        if (!DELETE_RESOURCE_BIZ_TYPES.contains(resourceBizType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.restore.type.unsupported"));
        }
        // 校验资源状态必须是已注销（3），否则不能恢复。
        if (!Objects.equals(resource.getResourceStatus(), ResourceStatus.REMOVED.getNum())) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.restore.status.invalid"));
        }
    }

    /**
     * 通用更新资源基础信息。
     * 更新资源名称、资源描述、所属目录、更新人和更新时间；
     * 若资源存在 targetContent，则同步回写子表并刷新开放资源目录中的 JSON。
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateResourceBasicInfo(Long resourceId, String resourceName, String resourceDesc, Long catalogId) {
        // 1. 校验请求参数中的资源ID。
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }

        // 2. 根据资源ID查询资源主表，确保资源存在。
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        // 商业版本（dataset.system=WHALE_AGENT）下，知识/工具由智能体门户发布，本系统不允许编辑。
        validateCommercialEditionKnowledgeOrToolWritable(resource);
        validateResourceManagePermission(resource);

        // 3. 更新资源名称、资源描述，以及本次修改的操作人和修改时间。
        resource.setResourceName(resourceName);
        resource.setResourceDesc(resourceDesc);
        if (catalogId != null) {
            resource.setCatalogId(catalogId);
        }
        // 4. 持久化更新后的资源主表记录。
        ssResourceService.updateResourceEntity(resource);

        // 5. 回写子表 targetContent，并同步最新 JSON 到开放资源目录。
        updateExtTargetContentAndSync(resource);
    }

    /**
     * 商业版本（dataset.system=WHALE_AGENT）下，知识/工具的编辑/注销需走智能体门户，
     * 在本系统拦截并提示用户。对象、视图、数字员工和非商业版本不受限。
     *
     * @author qin.guoquan
     * @date 2026-05-11
     */
    void validateCommercialEditionKnowledgeOrToolWritable(SsResource resource) {
        if (resource == null) {
            return;
        }
        if (!SystemCode.WHAGE_AGENT.getCode().equalsIgnoreCase(StringUtils.trimToEmpty(datasetSystem))) {
            return;
        }
        if (!isKnowledgeBizType(resource.getResourceBizType()) && !isToolBizType(resource.getResourceBizType())) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("commercial.not.support.knowledge.operation"));
    }

    private boolean isKnowledgeBizType(String resourceBizType) {
        return StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(resourceBizType), "KG_");
    }

    private boolean isToolBizType(String resourceBizType) {
        return StringUtils.equalsAny(StringUtils.trimToEmpty(resourceBizType),
            ResourceBizType.AGENT.getCode(),
            ResourceBizType.MCP.getCode(),
            ResourceBizType.TOOLKIT.getCode(),
            ResourceBizType.TOOL.getCode(),
            ResourceBizType.MCP_TOOL.getCode());
    }

    private void validateResourceManagePermission(SsResource resource) {
        if (OwnerType.PERSONAL_DEFAULT.equals(resource.getOwnerType())) {
            throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
        }
        if (authApplicationService.hasResourceManagePermission(resource)) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
    }

    // ==================== 导入：参数校验 ====================

    private String validateAndReadFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.file.upload.required"));
        }

       // if (file.getSize() > IMPORT_TOOL_JSON_MAX_BYTES) {
       //     throw new IllegalArgumentException("工具JSON文件大小不能超过1M");
        // }

        try {
            byte[] fileBytes = file.getBytes();
            String jsonStr = new String(fileBytes, StandardCharsets.UTF_8);
            if (StringUtils.isBlank(jsonStr)) {
                throw new IllegalArgumentException(I18nUtil.get("tool.json.file.content.notempty"));
            }
            return jsonStr;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.file.read.failed"));
        }
    }

    private void validateToolJsonNewFields(JSONObject root) {
        if (StringUtils.isBlank(root.getString("resourceCode"))) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.code.missing"));
        }
        String resourceBizType = StringUtils.trimToEmpty(root.getString("resourceBizType"));
        if (StringUtils.isBlank(resourceBizType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.biz.type.missing"));
        }
        if (!IMPORT_TOOL_JSON_NEW_BIZ_TYPES.contains(resourceBizType)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.biz.type.invalid"));
        }
        if (StringUtils.isBlank(root.getString("resourceName"))) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.name.missing"));
        }
        if (StringUtils.isBlank(root.getString("domainName"))) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.domain.name.missing"));
        }
        if (StringUtils.isBlank(root.getString("domainURL"))) {
            throw new IllegalArgumentException(I18nUtil.get("tool.json.domain.url.missing"));
        }
    }

    private boolean shouldRegisterDiscoveryService(String resourceBizType) {
        return StringUtils.equalsAny(resourceBizType,
            ResourceBizType.TOOLKIT.getCode(),
            ResourceBizType.MCP.getCode(),
            ResourceBizType.AGENT.getCode(),
            ResourceBizType.KG_DOC.getCode(),
            ResourceBizType.KG_DB.getCode(),
            ResourceBizType.KG_TERM.getCode(),
            ResourceBizType.KG_QA.getCode());
    }

    private String findTargetContentByBizType(String resourceBizType, Long resourceId) {
        if (!shouldRegisterDiscoveryService(resourceBizType) || resourceId == null) {
            return null;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.TOOLKIT.getCode())) {
            SsResExtToolKit ext = ssResExtToolKitService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.MCP.getCode())) {
            SsResExtMcp ext = ssResExtMcpService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.AGENT.getCode())) {
            SsResExtAgent ext = ssResExtAgentService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (isKnowledgeResourceBizType(resourceBizType)) {
            var ext = ssResExtDocService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        return null;
    }

    private boolean isKnowledgeResourceBizType(String resourceBizType) {
        return StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(resourceBizType), "KG_");
    }

    /**
     * 资源基础信息更新后，把名称、描述同步回写到对应子表的 targetContent，
     * 并刷新开放资源目录中的 JSON 文件，保证下游读取到的是最新元数据。
     */
    private void updateExtTargetContentAndSync(SsResource resource) {
        String resourceBizType = StringUtils.trimToEmpty(resource.getResourceBizType());
        Long resourceId = resource.getResourceId();
        String resourceName = resource.getResourceName();
        String resourceDesc = resource.getResourceDesc();

        String targetContent = switch (resourceBizType) {
            case "VIEW" -> updateViewTargetContent(resourceId, resourceName, resourceDesc);
            case "OBJECT" -> updateObjectTargetContent(resourceId, resourceName, resourceDesc);
            case "TOOLKIT" -> updateToolKitTargetContent(resourceId, resourceName, resourceDesc);
            case "MCP" -> updateMcpTargetContent(resourceId, resourceName, resourceDesc);
            case "AGENT" -> updateAgentTargetContent(resourceId, resourceName, resourceDesc);
            default -> updateKnowledgeTargetContent(resource, resourceBizType);
        };

        if (StringUtils.isBlank(targetContent)) {
            LOGGER.info("资源基础信息更新后未命中可同步的targetContent，跳过资源JSON刷新, resourceId={}, resourceBizType={}",
                resourceId, resourceBizType);
            return;
        }

        resourceArtifactStorageService.syncResourceJsonByBizType(targetContent, resourceBizType, resourceId);
        ssResourceArtifactService.upsertStandardJsonArtifact(resourceId, resourceBizType, "resource-basic-info-sync");
        LOGGER.info("资源基础信息更新后已同步targetContent到开放资源目录, resourceId={}, resourceBizType={}",
            resourceId, resourceBizType);
    }

    private String updateKnowledgeTargetContent(SsResource resource, String resourceBizType) {
        if (!StringUtils.startsWith(resourceBizType, "KG_")) {
            return null;
        }
        SsResExtDoc extDoc = ssResExtDocService.updateSsResExtDocTargetContent(resource.getResourceId(), null,
            resource.getResourceName(), resource.getResourceDesc());
        return extDoc == null ? null : extDoc.getTargetContent();
    }

    private String updateViewTargetContent(Long resourceId, String resourceName, String resourceDesc) {
        SsResExtView extView = ssResExtViewService.findById(resourceId);
        if (extView == null) {
            return null;
        }
        extView.setTargetContent(buildUpdatedTargetContent(extView.getTargetContent(), resourceId, resourceName,
            resourceDesc));
        ssResExtViewService.update(extView);
        return extView.getTargetContent();
    }

    private String updateObjectTargetContent(Long resourceId, String resourceName, String resourceDesc) {
        SsResExtObject extObject = ssResExtObjectService.findById(resourceId);
        if (extObject == null) {
            return null;
        }
        extObject.setTargetContent(buildUpdatedTargetContent(extObject.getTargetContent(), resourceId, resourceName,
            resourceDesc));
        ssResExtObjectService.update(extObject);
        return extObject.getTargetContent();
    }

    private String updateToolKitTargetContent(Long resourceId, String resourceName, String resourceDesc) {
        SsResExtToolKit extToolKit = ssResExtToolKitService.findById(resourceId);
        if (extToolKit == null) {
            return null;
        }
        extToolKit.setTargetContent(buildUpdatedTargetContent(extToolKit.getTargetContent(), resourceId, resourceName,
            resourceDesc));
        ssResExtToolKitService.update(extToolKit);
        return extToolKit.getTargetContent();
    }

    private String updateMcpTargetContent(Long resourceId, String resourceName, String resourceDesc) {
        SsResExtMcp extMcp = ssResExtMcpService.findById(resourceId);
        if (extMcp == null) {
            return null;
        }
        extMcp.setTargetContent(buildUpdatedTargetContent(extMcp.getTargetContent(), resourceId, resourceName,
            resourceDesc));
        ssResExtMcpService.update(extMcp);
        return extMcp.getTargetContent();
    }

    private String updateAgentTargetContent(Long resourceId, String resourceName, String resourceDesc) {
        SsResExtAgent extAgent = ssResExtAgentService.findById(resourceId);
        if (extAgent == null) {
            return null;
        }
        extAgent.setTargetContent(buildUpdatedTargetContent(extAgent.getTargetContent(), resourceId, resourceName,
            resourceDesc));
        ssResExtAgentService.update(extAgent);
        return extAgent.getTargetContent();
    }

    /**
     * 在保留原有 targetContent 结构的前提下，仅刷新基础元数据。
     * 这里统一把 resourceId 放到首节点，避免不同来源内容顺序不一致。
     */
    private String buildUpdatedTargetContent(String originalTargetContent, Long resourceId, String resourceName,
        String resourceDesc) {
        JSONObject originalRoot = StringUtils.isBlank(originalTargetContent)
            ? new JSONObject(true)
            : JSON.parseObject(originalTargetContent, Feature.OrderedField);
        if (originalRoot == null) {
            originalRoot = new JSONObject(true);
        }

        JSONObject updatedRoot = new JSONObject(true);
        updatedRoot.put("resourceId", resourceId);
        originalRoot.forEach((key, value) -> {
            if (!StringUtils.equalsAny(key, "resourceId", "resourceName", "resourceDesc")) {
                updatedRoot.put(key, value);
            }
        });
        updatedRoot.put("resourceName", StringUtils.trimToEmpty(resourceName));
        updatedRoot.put("resourceDesc", StringUtils.trimToEmpty(resourceDesc));
        return JSON.toJSONString(updatedRoot);
    }

    private void validateNoDigEmployeeRelation(Long resourceId, SsResource resource) {
        // 1. 从关联明细表中反查：哪些资源把当前资源作为 rel_resource_id 关联进来了。
        List<SsResourceRelDetail> relations = ssResourceRelDetailService.list(
                new LambdaQueryWrapper<SsResourceRelDetail>().eq(SsResourceRelDetail::getRelResourceId, resourceId));
        if (CollectionUtils.isEmpty(relations)) {
            return;
        }

        // 2. 提取这些主资源的 resourceId，后续用于批量查询资源主表。
        List<Long> digEmployeeIds = relations.stream()
                .map(SsResourceRelDetail::getResourceId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(digEmployeeIds)) {
            return;
        }

        // 3. 批量查询主资源，并过滤出 resourceBizType = DIG_EMPLOYEE 且未删除的数字员工。
        List<SsResource> relResources = ssResourceService.findByIdList(digEmployeeIds);
        List<String> digEmployeeNames = relResources.stream()
                .filter(Objects::nonNull)
                .filter(item -> !Objects.equals(item.getResourceStatus(), ResourceStatus.REMOVED.getNum()))
                .filter(item -> StringUtils.equals(item.getResourceBizType(), ResourceBizType.DIG_EMPLOYEE.getCode()))
                .map(SsResource::getResourceName)
                .filter(StringUtils::isNotBlank)
                .distinct()
                .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(digEmployeeNames)) {
            return;
        }

        // 4. 若命中数字员工关联，则按约定文案抛出异常，阻止后续删除。
        String employeeNames = String.join("、", digEmployeeNames);
        String resourceName = StringUtils.defaultIfBlank(resource.getResourceName(), String.valueOf(resourceId));
        throw new BdpRuntimeException(I18nUtil.get("tool.resource.delete.digemployee.relation.exists", resourceName,
            employeeNames));
    }

    /**
     * 校验对象资源是否被视图绑定。
     *
     * @author qin.guoquan
     * @date 2026-04-26 14:20:00
     */
    private void validateNoViewRelation(Long resourceId, SsResource resource) {
        List<SsResourceRelDetail> relations = ssResourceRelDetailService.list(
            new LambdaQueryWrapper<SsResourceRelDetail>().eq(SsResourceRelDetail::getRelResourceId, resourceId));
        if (CollectionUtils.isEmpty(relations)) {
            return;
        }

        List<Long> viewResourceIds = relations.stream()
            .map(SsResourceRelDetail::getResourceId)
            .filter(Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(viewResourceIds)) {
            return;
        }

        List<SsResource> relResources = ssResourceService.findByIdList(viewResourceIds);
        List<String> viewNames = relResources.stream()
            .filter(Objects::nonNull)
            .filter(item -> StringUtils.equals(item.getResourceBizType(), ResourceBizType.VIEW.getCode()))
            .map(SsResource::getResourceName)
            .filter(StringUtils::isNotBlank)
            .distinct()
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(viewNames)) {
            return;
        }

        String objectName = StringUtils.defaultIfBlank(resource.getResourceName(), String.valueOf(resourceId));
        throw new BdpRuntimeException(I18nUtil.get("tool.resource.delete.view.relation.exists", objectName,
            String.join("、", viewNames)));
    }

    /**
     * 数字员工删除后清理其技能 Redis 缓存。
     *
     * @author qin.guoquan
     * @date 2026-04-26 14:20:00
     */
    private void removeDigEmployeeFromRedisIfNecessary(Long resourceId, String resourceBizType) {
        if (!StringUtils.equals(resourceBizType, ResourceBizType.DIG_EMPLOYEE.getCode()) || resourceId == null) {
            return;
        }
        RedisUtil.removeKey(DigEmployeeRedisKeys.skillCacheKey(resourceId));
        if (digEmployeeRedisSyncProperties != null && digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            RedisUtil.removeKey(DigEmployeeRedisKeys.configJsonKey(resourceId));
        }
    }

    private void deleteRegisteredArtifacts(Long resourceId, String resourceBizType) {
        List<SsResourceArtifact> artifacts = ssResourceArtifactService.listActiveArtifactsByResourceId(resourceId);
        if (CollectionUtils.isEmpty(artifacts)) {
            resourceArtifactStorageService.deleteResourceJsonByBizType(resourceBizType, resourceId);
            return;
        }
        for (SsResourceArtifact artifact : artifacts) {
            if (artifact == null || StringUtils.isBlank(artifact.getArtifactPath())) {
                continue;
            }
            resourceArtifactStorageService.deleteWithinResourceRoot(artifact.getArtifactPath());
        }
    }

    private void deleteResourceExtByBizType(Long resourceId, String resourceBizType) {
        // 根据资源类型删除各自的扩展表。
        // 当前删除接口只覆盖几类技能资源，因此这里按业务类型显式分流。
        if (StringUtils.equals(resourceBizType, ResourceBizType.TOOL.getCode())
                || StringUtils.equals(resourceBizType, ResourceBizType.SKILL.getCode())) {
            ssResExtToolService.removeById(resourceId);
            return;
        }
        if (isKnowledgeResourceBizType(resourceBizType)) {
            ssResExtDocService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.TOOLKIT.getCode())) {
            ssResExtToolKitService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.MCP.getCode())) {
            ssResExtMcpService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.AGENT.getCode())) {
            ssResExtAgentService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.OBJECT.getCode())) {
            ssResExtObjectService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.VIEW.getCode())) {
            ssResExtViewService.removeById(resourceId);
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.DIG_EMPLOYEE.getCode())) {
            ssResExtDigEmployeeService.removeById(resourceId);
        }
    }

    private void deleteResourceRelations(Long resourceId) {
        // 统一删除两类关系：
        // 1) 当前资源作为主资源(resource_id)的关系
        // 2) 当前资源作为被关联资源(rel_resource_id)的关系
        LambdaQueryWrapper<SsResourceRelDetail> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResourceRelDetail::getResourceId, resourceId)
                .or()
                .eq(SsResourceRelDetail::getRelResourceId, resourceId);
        ssResourceRelDetailService.remove(wrapper);
    }

    private void saveOrUpdateExtObject(SsResExtObject extObject, Long resourceId) {
        SsResExtObject oldExt = ssResExtObjectService.findById(resourceId);
        if (oldExt == null) {
            ssResExtObjectService.save(extObject);
        } else {
            ssResExtObjectService.update(extObject);
        }
    }

    private void saveOrUpdateExtView(SsResExtView extView, Long resourceId) {
        SsResExtView oldExt = ssResExtViewService.findById(resourceId);
        if (oldExt == null) {
            ssResExtViewService.save(extView);
        } else {
            ssResExtViewService.update(extView);
        }
    }

    /**
     * 当前线程如果已经有真实登录态，就直接复用；
     * 否则临时灌入一个开放接口专用上下文，让 createBy/updateBy/manUserId 等审计字段可正常落库。
     *
     * 临时免登录，后续再让智能体给token，再补全这块相关的用户信息
     */
    private <T> T executeWithOpenApiImportLoginContext(Supplier<T> supplier) {
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        if (hasEffectiveLogin(originalLoginInfo)) {
            return supplier.get();
        }
        LoginInfo openApiLoginInfo = new LoginInfo();
        openApiLoginInfo.setUserId(0L);
        openApiLoginInfo.setUserCode("openapi");
        openApiLoginInfo.setUserName("Open API");
        openApiLoginInfo.setEnterpriseId(0L);
        openApiLoginInfo.setComAcctId(0L);
        openApiLoginInfo.setUsersOrganizations(Collections.emptyList());
        CurrentUserHolder.setLoginInfo(openApiLoginInfo);
        try {
            return supplier.get();
        }
        finally {
            CurrentUserHolder.setLoginInfo(originalLoginInfo);
        }
    }

    private boolean hasEffectiveLogin(LoginInfo loginInfo) {
        return loginInfo != null
            && loginInfo.getUserId() != null
            && !Objects.equals(loginInfo.getUserId(), (long) Integer.MIN_VALUE);
    }

    /**
     * add by qin.guoquan 2026-03-31
     */
    private Long resolveDefaultManOrgIdFromLogin() {
        if (CollectionUtils.isEmpty(CurrentUserHolder.getUsersOrganizations())) {
            return null;
        }
        return CurrentUserHolder.getUsersOrganizations().get(0).getOrgId();
    }

    /**
     * 新版 TOOLKIT / MCP / AGENT 导入主表写入逻辑。
     *
     * 这里统一做两件事：
     * 1. 新增时复用 SsResourceService.createResource(...) 创建主表；
     * 2. 更新时复用 SsResourceService.update(...) 刷新已有主表。
     *
     * 之所以在 createResource 之后又补一轮字段，是为了把导入链要求的
     * resourceCode / catalogId / version / publishTime 等值收口成明确结果。
     */
    private SsResource saveOrUpdateToolJsonNewMain(SsResource existing, String resourceBizType, String resourceCode,
                                                   String resourceName, String resourceDesc, String ownerType,
                                                   String systemCode, String version, Long catalogId, String implType) {

        if (existing == null) {
            SsResource myResource = new SsResource();
            myResource.setResourceBizType(resourceBizType);
            myResource.setResourceCode(resourceCode);
            myResource.setResourceName(resourceName);
            myResource.setResourceDesc(resourceDesc);
            myResource.setResourceStatus(ResourceStatus.LIST.getNum());
            myResource.setOwnerType(ownerType);
            myResource.setSystemCode(systemCode);
            myResource.setResourceVersionId(version);
            myResource.setCatalogId(catalogId);

            resourceRuntimeInfoResolver.fillResource(myResource,
                resourceRuntimeInfoResolver.resolveToolJson(resourceBizType, implType));
            SsResource created = ssResourceService.createResource(myResource);
            authApplicationService.ensureCreatorDefaultPrivileges(created);
            return created;
        }

        Date now = new Date();
        Long userId = CurrentUserHolder.getCurrentUserId();
        String effectiveSystemCode = StringUtils.defaultIfBlank(systemCode, SystemCode.BYAI.getCode());
        String effectiveOwnerType = StringUtils.trimToEmpty(ownerType);
        Long effectiveCatalogId = catalogId != null ? catalogId : 0L;

        existing.setResourceBizType(resourceBizType);
        existing.setResourceCode(resourceCode);
        existing.setResourceName(resourceName);
        existing.setResourceDesc(resourceDesc);
        existing.setOwnerType(effectiveOwnerType);
        existing.setSystemCode(effectiveSystemCode);
        existing.setCatalogId(effectiveCatalogId);
        existing.setResourceVersionId(version);
        existing.setUpdateBy(userId);
        existing.setUpdateTime(now);
        existing.setPublishTime(now);
        resourceRuntimeInfoResolver.fillResource(existing,
            resourceRuntimeInfoResolver.resolveToolJson(resourceBizType, implType));
        return ssResourceService.updateResourceEntity(existing);
    }

    /**
     * 新版 TOOLKIT / MCP / AGENT 导入扩展表写入逻辑。
     *
     * 三类资源虽然对应不同子表，但写入规则是完全一致的：
     * 1. source_content = 上传的原始 JSON
     * 2. target_content = 增加 resourceId 首节点后的 JSON
     * 3. 仍按 resourceId 幂等，有则更新，无则新增
     */
    private void saveOrUpdateToolJsonNewExt(String resourceBizType, Long resourceId, String sourceContent,
                                            String targetContent) {
        if (StringUtils.equals(resourceBizType, ResourceBizType.TOOLKIT.getCode())) {
            SsResExtToolKit ext = new SsResExtToolKit();
            ext.setResourceId(resourceId);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetContent);
            SsResExtToolKit oldExt = ssResExtToolKitService.findById(resourceId);
            if (oldExt == null) {
                ssResExtToolKitService.save(ext);
            } else {
                ssResExtToolKitService.update(ext);
            }
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.MCP.getCode())) {
            SsResExtMcp ext = new SsResExtMcp();
            ext.setResourceId(resourceId);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetContent);
            SsResExtMcp oldExt = ssResExtMcpService.findById(resourceId);
            if (oldExt == null) {
                ssResExtMcpService.save(ext);
            } else {
                ssResExtMcpService.update(ext);
            }
            return;
        }
        if (StringUtils.equals(resourceBizType, ResourceBizType.AGENT.getCode())) {
            SsResExtAgent ext = new SsResExtAgent();
            ext.setResourceId(resourceId);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetContent);
            SsResExtAgent oldExt = ssResExtAgentService.findById(resourceId);
            if (oldExt == null) {
                ssResExtAgentService.save(ext);
            } else {
                ssResExtAgentService.update(ext);
            }
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("tool.json.resource.biz.type.invalid"));
    }

    private SsResExtView buildSsResExtView(JSONObject root, String sourceContent, String targetContent) {
        // 视图扩展表保留两份 JSON：
        // source_content 存前端原始文件内容，target_content 存补充 resourceId 后的新内容。
        SsResExtView ext = new SsResExtView();
        ext.setMcpServerUrl(StringUtils.trimToEmpty(root.getString("mcpServerUrl")));
        ext.setMcpTransferType(StringUtils.trimToEmpty(root.getString("mcpTransferType")));
        ext.setSourceContent(sourceContent);
        ext.setTargetContent(targetContent);
        return ext;
    }

    private void validateObjectZipRequest(MultipartFile file, String ownerType) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.zip.upload.required"));
        }
        //if (file.getSize() > 100L * 1024L * 1024L) {
        //    throw new IllegalArgumentException("对象zip文件大小不能超过20M");
        //}
        if (StringUtils.isBlank(file.getOriginalFilename())
            || !StringUtils.endsWithIgnoreCase(file.getOriginalFilename(), ".zip")) {
            throw new IllegalArgumentException(I18nUtil.get("tool.zip.file.only.supported"));
        }
        if (StringUtils.isBlank(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("owner.type.notempty"));
        }
    }

    private void validateViewZipRequest(MultipartFile file, String ownerType) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("tool.view.zip.upload.required"));
        }
        if (StringUtils.isBlank(file.getOriginalFilename())
            || !StringUtils.endsWithIgnoreCase(file.getOriginalFilename(), ".zip")) {
            throw new IllegalArgumentException(I18nUtil.get("tool.zip.file.only.supported"));
        }
        if (StringUtils.isBlank(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("owner.type.notempty"));
        }
    }

    /**
     * 上传文件先落到固定导入工作目录，再在 zip 同级目录解压。
     * 解压目录会保留，供后续模块继续使用。
     */
    private Path saveUploadedZip(MultipartFile file) {
        try {
            // 统一落到业务工作目录，避免直接依赖 multipart 临时文件的生命周期。
            Path baseDir = Files.createDirectories(Path.of(System.getProperty("java.io.tmpdir"), "byai-object-import",
                String.valueOf(System.currentTimeMillis())));
            String originalFilename = StringUtils.defaultIfBlank(file.getOriginalFilename(), "object-import.zip");
            Path zipPath = baseDir.resolve(originalFilename);
            Files.copy(file.getInputStream(), zipPath, StandardCopyOption.REPLACE_EXISTING);
            return zipPath;
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.zip.save.failed"));
        }
    }

    private Path unzipBesideZip(Path zipPath) {
        String zipFileName = zipPath.getFileName().toString();
        String dirName = zipFileName.substring(0, zipFileName.length() - 4);
        Path targetDir = zipPath.getParent().resolve(dirName);
        try {
            // 解压目录保留不删，后续模块还会复用同一批导入产物。
            Files.createDirectories(targetDir);
            try (ZipInputStream zipInputStream = new ZipInputStream(Files.newInputStream(zipPath))) {
                ZipEntry entry;
                while ((entry = zipInputStream.getNextEntry()) != null) {
                    // 防止 Zip Slip，把每个 entry 都限制在目标目录内。
                    Path normalizedTarget = targetDir.resolve(entry.getName()).normalize();
                    if (!normalizedTarget.startsWith(targetDir)) {
                        throw new IllegalArgumentException(I18nUtil.get("tool.zip.file.illegal.path"));
                    }
                    if (entry.isDirectory()) {
                        Files.createDirectories(normalizedTarget);
                    } else {
                        Files.createDirectories(normalizedTarget.getParent());
                        Files.copy(zipInputStream, normalizedTarget, StandardCopyOption.REPLACE_EXISTING);
                    }
                    zipInputStream.closeEntry();
                }
            }
            return targetDir;
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.zip.unzip.failed"));
        }
    }

    private String buildZipUploadSubDirectory(String baseDirectory) {
        return baseDirectory;
    }

    private String buildJsonUploadSubDirectory(String baseDirectory, Path extractedRoot) {
        return baseDirectory + "/" + extractedRoot.getFileName().toString();
    }

    private boolean isDefinitionOwlFile(Path path) {
        String fileName = StringUtils.trimToEmpty(path.getFileName().toString()).toLowerCase(Locale.ROOT);
        if (fileName.startsWith("._")) {
            return false;
        }
        return fileName.endsWith("definition.owl");
    }

    private boolean containsMacOsMetadata(Path path) {
        for (Path part : path) {
            if (StringUtils.equalsIgnoreCase(part.toString(), "__MACOSX")) {
                return true;
            }
        }
        return false;
    }

    private ObjectZipImportItem importSingleObjectDirectory(Path objectDir, Long catalogId, String ownerType, Long userId,
                                                            Date now, List<Long> importedResourceIds,
                                                            String uploadSubDirectory) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String objectDirName = objectDir.getFileName().toString();
        item.setResourceCode(objectDirName);
        item.setResourceBizType(ResourceBizType.OBJECT.getCode());
        Path owlFile = findDefinitionOwlInFirstLevelDirectory(objectDir);

        if (owlFile == null) {
            item.setSuccess(false);
            item.setMessage(I18nUtil.get("tool.object.definition.owl.missing"));
            return item;
        }

        try {
            // 1. 解析对象 owl，得到对象基础信息和字段定义；
            // 2. 按 resourceCode 幂等写主表与对象子表；
            // 3. 同步当前对象的 targetContent 为 OBJECT_{resourceId}.json。
            String owlContent = Files.readString(owlFile, StandardCharsets.UTF_8);
            ParsedObjectOwl parsed = objectOwlImportParser.parse(owlContent);
            item.setResourceCode(parsed.getResourceCode());
            item.setResourceName(parsed.getResourceName());
            item.setResourceDesc(parsed.getResourceDesc());
            item.setResourceBizType(parsed.getResourceBizType());

            ObjectImportSaveResult saveResult = saveOrUpdateImportedObjectFromOwl(parsed, catalogId, ownerType, userId, now);
            item.setResourceId(String.valueOf(saveResult.getResourceId()));
            item.setUpdated(saveResult.isUpdated());
            fillImportCatalogInfo(item, saveResult.getCatalogId());
            item.setDiffSummary(saveResult.getDiffSummary());
            item.setDiffDetails(new ArrayList<>(saveResult.getDiffDetails()));
            item.setSuccess(true);
            item.setMessage(I18nUtil.get(saveResult.isUpdated() ? "resource.update.success" : "resource.import.success"));
            importedResourceIds.add(saveResult.getResourceId());

            uploadTargetJson(saveResult.getTargetContent(), saveResult.getResourceId(), "OBJECT", uploadSubDirectory);
            LOGGER.info("对象导入成功, resourceId={}, resourceCode={}, resourceJsonPath={}/OBJECT_{}.json",
                saveResult.getResourceId(), parsed.getResourceCode(), uploadSubDirectory, saveResult.getResourceId());
            return item;
        } catch (Exception e) {
            item.setSuccess(false);
            item.setMessage(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.object.import.failed"));
            return item;
        }
    }

    private ObjectZipImportItem importSingleViewDirectory(Path viewDir, Long catalogId, String ownerType, Long userId,
                                                          Date now, List<Long> importedResourceIds,
                                                          String uploadSubDirectory) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String viewDirName = viewDir.getFileName().toString();
        item.setResourceBizType(ResourceBizType.VIEW.getCode());
        item.setResourceCode(viewDirName);
        Path viewFile = findDefinitionOwlInFirstLevelDirectory(viewDir);
        if (viewFile == null) {
            item.setSuccess(false);
            item.setMessage(I18nUtil.get("tool.view.definition.owl.missing"));
            return item;
        }

        try {
            // 1. 解析视图 owl，得到视图基础信息和 object_codes；
            // 2. 幂等写主表与视图子表；
            // 3. 根据 object_codes 写视图与对象关系；
            // 4. 同步当前视图的 targetContent 为 VIEW_{resourceId}.json。
            String owlContent = Files.readString(viewFile, StandardCharsets.UTF_8);
            ParsedViewOwl parsed = viewOwlImportParser.parse(owlContent);
            item.setResourceCode(parsed.getResourceCode());
            item.setResourceName(parsed.getResourceName());
            item.setResourceDesc(parsed.getResourceDesc());
            item.setResourceBizType(parsed.getResourceBizType());

            ViewImportSaveResult saveResult = saveOrUpdateImportedViewFromOwl(parsed, catalogId, ownerType, userId, now);
            item.setResourceId(String.valueOf(saveResult.getResourceId()));
            item.setUpdated(saveResult.isUpdated());
            fillImportCatalogInfo(item, saveResult.getCatalogId());
            item.setSuccess(true);
            item.setMessage(I18nUtil.get(saveResult.isUpdated() ? "resource.update.success" : "resource.import.success"));
            item.setMissingObjectCodes(saveResult.getMissingObjectCodes());
            importedResourceIds.add(saveResult.getResourceId());

            uploadTargetJson(saveResult.getTargetContent(), saveResult.getResourceId(), "VIEW", uploadSubDirectory);
            LOGGER.info("视图导入成功, resourceId={}, resourceCode={}, resourceJsonPath={}/VIEW_{}.json, missingObjectCodes={}",
                saveResult.getResourceId(), parsed.getResourceCode(), uploadSubDirectory, saveResult.getResourceId(),
                saveResult.getMissingObjectCodes());
            return item;
        } catch (Exception e) {
            item.setSuccess(false);
            item.setMessage(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.view.import.failed"));
            return item;
        }
    }

    /**
     * 只扫描一级目录中的 owl 文件，不递归处理子目录；
     * 当前对象/视图包都统一按 *definition.owl 作为定义入口。
     */
    private Path findDefinitionOwlInFirstLevelDirectory(Path directory) {
        List<Path> definitionOwls = findDefinitionOwlFilesInCurrentDirectory(directory);
        return definitionOwls.isEmpty() ? null : definitionOwls.get(0);
    }

    /**
     * 扫描指定目录第一层中的 *definition.owl 文件，不递归处理子目录。
     *
     * @author qin.guoquan
     * @date 2026-05-06 17:35:00
     */
    private List<Path> findDefinitionOwlFilesInCurrentDirectory(Path directory) {
        try (var children = Files.list(directory)) {
            List<Path> definitionOwls = children
                .filter(Files::isRegularFile)
                .filter(this::isDefinitionOwlFile)
                .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                .collect(Collectors.toList());
            LOGGER.info("目录第一层命中的definition.owl文件, directory={}, owlFiles={}", directory,
                definitionOwls.stream().map(path -> path.getFileName().toString()).collect(Collectors.toList()));
            return definitionOwls;
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.owl.file.scan.failed"));
        }
    }

    /**
     * 兼容两种对象/视图压缩包结构：
     * 1. zip 根目录下直接放资源 owl 文件；
     * 2. zip 根目录下先包一层资源目录，再在该目录第一层放资源 owl 文件。
     *
     * @author qin.guoquan
     * @date 2026-05-06 17:35:00
     */
    private List<Path> findDefinitionOwlFilesInZipRootOrFirstLevelDirectories(Path zipRoot,
                                                                              List<Path> firstLevelDirectories) {
        List<Path> definitionOwls = new ArrayList<>();
        for (Path directory : firstLevelDirectories) {
            definitionOwls.addAll(findDefinitionOwlFilesInCurrentDirectory(directory));
        }
        definitionOwls.addAll(findDefinitionOwlFilesInCurrentDirectory(zipRoot));
        List<Path> uniqueDefinitionOwls = definitionOwls.stream().distinct().collect(Collectors.toList());
        LOGGER.info("压缩包内命中的definition.owl文件汇总, zipRoot={}, owlFiles={}", zipRoot,
            uniqueDefinitionOwls.stream().map(Path::toString).collect(Collectors.toList()));
        return uniqueDefinitionOwls;
    }

    /**
     * 对象/视图 zip 当前只允许导入单个资源，因此整个压缩包内只能命中一个 definition.owl。
     */
    private void validateSingleDefinitionOwl(List<Path> definitionOwls, String resourceLabel) {
        String localizedResourceLabel = localizeResourceLabel(resourceLabel);
        if (CollectionUtils.isEmpty(definitionOwls)) {
            throw new IllegalArgumentException(I18nUtil.get("tool.zip.definition.owl.notfound", localizedResourceLabel));
        }
        if (definitionOwls.size() > 1) {
            throw new IllegalArgumentException(I18nUtil.get("tool.zip.definition.owl.multiple", localizedResourceLabel));
        }
    }

    private String localizeResourceLabel(String resourceLabel) {
        if ("对象".equals(resourceLabel)) {
            return I18nUtil.get("resource.label.object");
        }
        if ("视图".equals(resourceLabel)) {
            return I18nUtil.get("resource.label.view");
        }
        return resourceLabel;
    }

    /**
     * definition.owl 已经命中但导入仍失败时，应把真实失败原因返回给前端，
     * 不能再误报成“未找到有效的owl文件”。
     */
    private void validateImportedBundleResult(ObjectZipImportResult result, List<Long> importedResourceIds,
                                              String resourceLabel) {
        if (!importedResourceIds.isEmpty()) {
            return;
        }
        if (CollectionUtils.isNotEmpty(result.getItems())) {
            ObjectZipImportItem firstItem = result.getItems().get(0);
            if (StringUtils.isNotBlank(firstItem.getMessage())) {
                throw new IllegalArgumentException(firstItem.getMessage());
            }
        }
        throw new IllegalArgumentException(I18nUtil.get("tool.zip.owl.notfound", localizeResourceLabel(resourceLabel)));
    }

    /**
     * 按现有 importObjectJson 的对象主表规则写入主表，其核心差异仅在于对象基础信息来源于 OWL。
     */
    private ObjectImportSaveResult saveOrUpdateImportedObjectFromOwl(ParsedObjectOwl parsed, Long catalogId,
                                                                     String ownerType, Long userId, Date now) {
        if (StringUtils.isBlank(parsed.getResourceCode())) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.entity.code.notempty"));
        }
        if (StringUtils.isBlank(parsed.getResourceName())) {
            throw new IllegalArgumentException(I18nUtil.get("tool.object.entity.name.notempty"));
        }

        String resourceCode = StringUtils.trimToEmpty(parsed.getResourceCode());
        SsResource existing = resolveUniqueResourceByCode(resourceCode, "对象");
        ResourceImportOwnerTypeValidator.validate(existing, ownerType, resourceCode, parsed.getResourceName(),
            ResourceBizType.OBJECT.getCode());

        //校验用户是否有对该资源的管理权限（防止不同人导入同样编码的对象或视图）
        validateImportUpdatePermission(existing, resourceCode);

        Long resourceId = existing != null ? existing.getResourceId() : sequenceService.nextVal();
        Long comAcctId = CurrentUserHolder.getEnterpriseId();
        Long manOrgId = resolveDefaultManOrgIdFromLogin();
        String oldTargetContent = resolveExistingObjectTargetContent(existing);

        // 主表字段沿用 importObjectJson 的对象导入规则，只是字段来源换成了 owl 解析结果。
        SsResource resource = buildImportedObjectResource(parsed, resourceCode, catalogId, manOrgId, comAcctId, userId,
            now, ownerType);
        resource.setResourceId(resourceId);

        // sourceContent 保留原始 owl，targetContent 则转成统一资源 JSON 结构供下游使用。
        String targetContent = buildImportedObjectTargetContent(parsed, resourceId);
        SsResExtObject extObject = new SsResExtObject();
        extObject.setResourceId(resourceId);
        extObject.setMcpServerUrl("");
        extObject.setMcpTransferType("");
        extObject.setSourceContent(parsed.getSourceContent());
        extObject.setTargetContent(targetContent);

        if (existing != null) {
            resource.setCreateBy(existing.getCreateBy());
            // 对象包导入要求主表本次写入涉及的时间字段统一使用当前系统时间，
            // 因此更新已有对象时不再回填旧的 createTime。
            ssResourceService.updateResourceEntity(resource);
            saveOrUpdateExtObject(extObject, resourceId);
        } else {
            ssResourceService.saveResource(resource);
            ssResExtObjectService.save(extObject);
        }
        ssResourceService.clearResourceDraftAndReleaseVerIds(resourceId);
        if (existing == null) {
            authApplicationService.ensureCreatorDefaultPrivileges(resource);
        }
        ensureCreatorManagePrivilege(resourceId, ResourceBizType.OBJECT.getCode(), userId);

        ObjectImportSaveResult result = new ObjectImportSaveResult();
        result.setResourceId(resourceId);
        result.setUpdated(existing != null);
        result.setTargetContent(targetContent);
        result.setCatalogId(resource.getCatalogId());
        if (existing != null) {
            List<ResourceImportDiffItem> diffDetails = buildObjectImportDiff(oldTargetContent, targetContent);
            result.setDiffDetails(diffDetails);
            result.setDiffSummary(buildObjectImportDiffSummary(diffDetails));
        }
        return result;
    }

    private SsResource buildImportedObjectResource(ParsedObjectOwl parsed, String resourceCode, Long catalogId,
                                                   Long manOrgId, Long comAcctId, Long userId, Date now,
                                                   String ownerType) {
        SsResource r = new SsResource();
        r.setSystemCode(SystemCode.BYAI.getCode());
        r.setResourceSourcePkId(null);
        r.setResourceBizType(ResourceBizType.OBJECT.getCode());
        r.setResourceType("ATOM");
        r.setResourceName(StringUtils.trimToEmpty(parsed.getResourceName()));
        r.setResourceDesc(StringUtils.trimToEmpty(parsed.getResourceDesc()));
        r.setAvatar("");
        r.setSample("");
        r.setTags("");
        r.setResourceVersionId(StringUtils.trimToEmpty(parsed.getResourceVersionId()));
        r.setHostType("hosted");
        r.setCatalogId(catalogId);
        r.setManOrgId(manOrgId);
        r.setManUserId("");
        r.setIndexList("");
        r.setCreateBy(userId);
        r.setCreateTime(now);
        r.setUpdateBy(userId);
        r.setUpdateTime(now);
        r.setComAcctId(comAcctId);
        r.setResourceStatus(ResourceStatus.LIST.getNum());
        r.setResourceDVerid(null);
        r.setResourceRVerid(null);
        r.setResourceCode(resourceCode);
        r.setPublishTime(now);
        r.setShelfTime(null);
        r.setUnshelfTime(null);
        r.setAuthStatus("passed");
        r.setPublishPortal(1);
        r.setParentResourceId(-1L);
        r.setPublishType("publish");
        r.setOwnerType(StringUtils.trimToEmpty(ownerType));

        resourceRuntimeInfoResolver.fillResource(r, resourceRuntimeInfoResolver.resolveObjectView());

        return r;
    }

    private String buildImportedObjectTargetContent(ParsedObjectOwl parsed, Long resourceId) {
        JSONObject target = new JSONObject(true);
        target.put("resourceId", resourceId);
        target.put("resourceCode", StringUtils.trimToEmpty(parsed.getResourceCode()));
        target.put("resourceName", StringUtils.trimToEmpty(parsed.getResourceName()));
        target.put("resourceDesc", StringUtils.trimToEmpty(parsed.getResourceDesc()));
        target.put("resourceVersionId", StringUtils.trimToEmpty(parsed.getResourceVersionId()));
        target.put("entitySource", StringUtils.trimToEmpty(parsed.getEntitySource()));
        target.put("resourceBizType", ResourceBizType.OBJECT.getCode());
        resourceTargetJsonBuilder.enrichRoot(target, resourceRuntimeInfoResolver.resolveObjectView());

        JSONArray fields = new JSONArray();
        parsed.getFields().forEach(field -> {
            JSONObject fieldJson = new JSONObject(true);
            fieldJson.put("propertyCode", StringUtils.trimToEmpty(field.getPropertyCode()));
            fieldJson.put("propertyName", StringUtils.trimToEmpty(field.getPropertyName()));
            fieldJson.put("dataType", StringUtils.trimToEmpty(field.getDataType()));
            fieldJson.put("isRequired", StringUtils.trimToEmpty(field.getIsRequired()));
            fieldJson.put("defaultValue", StringUtils.trimToEmpty(field.getDefaultValue()));
            fieldJson.put("sourceColumn", StringUtils.trimToEmpty(field.getSourceColumn()));
            fieldJson.put("synonyms", StringUtils.trimToEmpty(field.getSynonyms()));
            fieldJson.put("dataFormat", StringUtils.trimToEmpty(field.getDataFormat()));
            fieldJson.put("measurementUnit", StringUtils.trimToEmpty(field.getMeasurementUnit()));
            fieldJson.put("propertyCategory", StringUtils.trimToEmpty(field.getPropertyCategory()));
            fieldJson.put("propertyGroup", StringUtils.trimToEmpty(field.getPropertyGroup()));
            fieldJson.put("extProperty", StringUtils.trimToEmpty(field.getExtProperty()));
            fieldJson.put("termTypeCodePath", StringUtils.trimToEmpty(field.getTermTypeCodePath()));
            fieldJson.put("libraryCode", StringUtils.trimToEmpty(field.getLibraryCode()));
            fieldJson.put("relAction", StringUtils.trimToEmpty(field.getRelAction()));
            fieldJson.put("relTermCodeOrName", StringUtils.trimToEmpty(field.getRelTermCodeOrName()));
            fieldJson.put("termDataType", StringUtils.trimToEmpty(field.getTermDataType()));
            fieldJson.put("sourceTableCode", StringUtils.trimToEmpty(field.getSourceTableCode()));
            fieldJson.put("sourceColumnCode", StringUtils.trimToEmpty(field.getSourceColumnCode()));
            fieldJson.put("sourceDatasourceCode", StringUtils.trimToEmpty(field.getSourceDatasourceCode()));
            fields.add(fieldJson);
        });
        target.put("fields", fields);
        return target.toJSONString();
    }

    private ViewImportSaveResult saveOrUpdateImportedViewFromOwl(ParsedViewOwl parsed, Long catalogId,
                                                                 String ownerType, Long userId, Date now) {
        if (StringUtils.isBlank(parsed.getResourceCode())) {
            throw new IllegalArgumentException(I18nUtil.get("tool.view.code.notempty"));
        }
        if (StringUtils.isBlank(parsed.getResourceName())) {
            throw new IllegalArgumentException(I18nUtil.get("tool.view.name.notempty"));
        }

        String resourceCode = StringUtils.trimToEmpty(parsed.getResourceCode());
        SsResource existing = ssResourceService.findByIdOrCode(null, resourceCode);
        ResourceImportOwnerTypeValidator.validate(existing, ownerType, resourceCode, parsed.getResourceName(),
            ResourceBizType.VIEW.getCode());
        validateImportUpdatePermission(existing, resourceCode);
        Long resourceId = existing != null ? existing.getResourceId() : sequenceService.nextVal();
        Long comAcctId = CurrentUserHolder.getEnterpriseId();
        Long manOrgId = resolveDefaultManOrgIdFromLogin();

        SsResource resource = buildImportedViewResource(parsed, resourceCode, catalogId, manOrgId, comAcctId, userId,
            now, ownerType);
        resource.setResourceId(resourceId);

        // 主表先落地，确保后续关系表与扩展表都能拿到稳定的视图 resourceId。
        if (existing != null) {
            resource.setCreateBy(existing.getCreateBy());
            ssResourceService.updateResourceEntity(resource);
        } else {
            ssResourceService.saveResource(resource);
        }

        // object_codes 会尽量解析并建立视图-对象关系；
        // 查不到的对象编码不会中断导入，而是回到 missingObjectCodes 给前端展示。
        ViewRelationResult relationResult = saveOrUpdateViewObjectRelations(resourceId, parsed.getObjectCodes(), userId, now);

        // 视图 targetContent 不只保留视图基础信息，还会补齐每个关联对象的基础信息与 fields。
        String targetContent = buildImportedViewTargetContent(parsed, resourceId, relationResult.getResolvedObjects());

        SsResExtView extView = new SsResExtView();
        extView.setResourceId(resourceId);
        extView.setMcpServerUrl("");
        extView.setMcpTransferType("");
        extView.setSourceContent(parsed.getSourceContent());
        extView.setTargetContent(targetContent);

        if (existing != null) {
            saveOrUpdateExtView(extView, resourceId);
        } else {
            ssResExtViewService.save(extView);
        }
        ssResourceService.clearResourceDraftAndReleaseVerIds(resourceId);
        if (existing == null) {
            authApplicationService.ensureCreatorDefaultPrivileges(resource);
        }
        ensureCreatorManagePrivilege(resourceId, ResourceBizType.VIEW.getCode(), userId);

        ViewImportSaveResult result = new ViewImportSaveResult();
        result.setResourceId(resourceId);
        result.setUpdated(existing != null);
        result.setTargetContent(targetContent);
        result.setMissingObjectCodes(relationResult.getMissingObjectCodes());
        result.setCatalogId(resource.getCatalogId());
        return result;
    }

    private SsResource buildImportedViewResource(ParsedViewOwl parsed, String resourceCode, Long catalogId,
                                                 Long manOrgId, Long comAcctId, Long userId, Date now,
                                                 String ownerType) {
        SsResource r = new SsResource();
        r.setSystemCode(SystemCode.BYAI.getCode());
        r.setResourceSourcePkId(null);
        r.setResourceBizType(ResourceBizType.VIEW.getCode());
        r.setResourceType("ATOM");
        r.setResourceName(StringUtils.trimToEmpty(parsed.getResourceName()));
        r.setResourceDesc(StringUtils.trimToEmpty(parsed.getResourceDesc()));
        r.setAvatar("");
        r.setSample("");
        r.setTags("");
        r.setResourceVersionId(StringUtils.trimToEmpty(parsed.getResourceVersionId()));
        r.setHostType("hosted");
        r.setCatalogId(catalogId);
        r.setManOrgId(manOrgId);
        r.setManUserId("");
        r.setIndexList("");
        r.setCreateBy(userId);
        r.setCreateTime(now);
        r.setUpdateBy(userId);
        r.setUpdateTime(now);
        r.setComAcctId(comAcctId);
        r.setResourceStatus(ResourceStatus.LIST.getNum());
        r.setResourceDVerid(null);
        r.setResourceRVerid(null);
        r.setResourceCode(resourceCode);
        r.setPublishTime(now);
        r.setShelfTime(null);
        r.setUnshelfTime(null);
        r.setAuthStatus("passed");
        r.setPublishPortal(1);
        r.setParentResourceId(-1L);
        r.setPublishType("publish");
        r.setOwnerType(StringUtils.trimToEmpty(ownerType));


        resourceRuntimeInfoResolver.fillResource(r, resourceRuntimeInfoResolver.resolveObjectView());
        return r;
    }

    private ViewRelationResult saveOrUpdateViewObjectRelations(Long viewResourceId, List<String> objectCodes, Long userId,
                                                               Date now) {
        // 视图导入采用“全量覆盖”语义：先删旧关系，再按当前 object_codes 重建。
        ssResourceRelDetailService.remove(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, viewResourceId));

        List<SsResource> resolvedObjects = new ArrayList<>();
        List<String> missingObjectCodes = new ArrayList<>();
        if (CollectionUtils.isEmpty(objectCodes)) {
            return new ViewRelationResult(resolvedObjects, missingObjectCodes);
        }

        List<SsResourceRelDetail> relationDetails = new ArrayList<>();
        Long comAcctId = CurrentUserHolder.getEnterpriseId();
        for (String objectCode : objectCodes) {
            String trimmedCode = StringUtils.trimToEmpty(objectCode);
            if (StringUtils.isBlank(trimmedCode)) {
                continue;
            }
            // 只接受已经存在且资源类型为 OBJECT 的资源编码；
            // 查不到时只记 missingObjectCodes，不打断整条视图导入。
            SsResource objectResource = resolveUniqueResourceByCode(trimmedCode, "对象");
            if (objectResource == null || !StringUtils.equals(objectResource.getResourceBizType(), ResourceBizType.OBJECT.getCode())) {
                missingObjectCodes.add(trimmedCode);
                continue;
            }
            resolvedObjects.add(objectResource);

            SsResourceRelDetail detail = new SsResourceRelDetail();
            detail.setResourceRelDetailId(sequenceService.nextVal());
            detail.setResourceId(viewResourceId);
            detail.setRelResourceId(objectResource.getResourceId());
            detail.setCreateBy(userId);
            detail.setCreateTime(now);
            detail.setUpdateBy(userId);
            detail.setUpdateTime(now);
            detail.setComAcctId(comAcctId);
            detail.setRelTypeName(null);
            detail.setRelStatus(1);
            relationDetails.add(detail);
        }

        if (!relationDetails.isEmpty()) {
            ssResourceRelDetailService.saveBatch(relationDetails);
        }
        return new ViewRelationResult(resolvedObjects, missingObjectCodes);
    }

    private String buildImportedViewTargetContent(ParsedViewOwl parsed, Long resourceId, List<SsResource> resolvedObjects) {
        JSONObject target = new JSONObject(true);
        target.put("resourceId", resourceId);
        target.put("resourceCode", StringUtils.trimToEmpty(parsed.getResourceCode()));
        target.put("resourceName", StringUtils.trimToEmpty(parsed.getResourceName()));
        target.put("resourceDesc", StringUtils.trimToEmpty(parsed.getResourceDesc()));
        target.put("resourceVersionId", StringUtils.trimToEmpty(parsed.getResourceVersionId()));
        target.put("resourceBizType", ResourceBizType.VIEW.getCode());
        resourceTargetJsonBuilder.enrichRoot(target, resourceRuntimeInfoResolver.resolveObjectView());

        JSONArray objects = new JSONArray();
        for (SsResource object : resolvedObjects) {
            JSONObject objectJson = new JSONObject(true);
            objectJson.put("resourceId", object.getResourceId());
            objectJson.put("resourceCode", StringUtils.trimToEmpty(object.getResourceCode()));
            objectJson.put("resourceName", StringUtils.trimToEmpty(object.getResourceName()));
            objectJson.put("resourceDesc", StringUtils.trimToEmpty(object.getResourceDesc()));
            // 视图里的对象节点继续向下补充对象 fields，
            // 数据来源是对象子表 ss_res_ext_object.target_content.fields。
            objectJson.put("fields", resolveObjectFields(object.getResourceId()));
            objects.add(objectJson);
        }
        target.put("objects", objects);
        target.put("fields", buildImportedViewFields(parsed.getFields()));
        return target.toJSONString();
    }

    /**
     * 对象/视图 zip 导入依赖 resourceCode 做幂等更新。
     * 若历史脏数据导致同编码出现多条，则直接给前端可读提示，避免把底层 selectOne 异常暴露出去。
     */
    private SsResource resolveUniqueResourceByCode(String resourceCode, String resourceLabel) {
        String trimmedCode = StringUtils.trimToEmpty(resourceCode);
        if (StringUtils.isBlank(trimmedCode)) {
            return null;
        }
        List<SsResource> resources = ssResourceService.getResourceListByCode(Collections.singletonList(trimmedCode));
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        if (resources.size() == 1) {
            return resources.get(0);
        }
        throw new IllegalArgumentException(I18nUtil.get("tool.resource.code.duplicate.too.many",
            localizeResourceLabel(resourceLabel)));
    }

    private JSONArray buildImportedViewFields(List<ParsedViewField> parsedFields) {
        JSONArray fields = new JSONArray();
        if (CollectionUtils.isEmpty(parsedFields)) {
            return fields;
        }
        for (ParsedViewField parsedField : parsedFields) {
            JSONObject fieldJson = new JSONObject(true);
            fieldJson.put("propertyCode", StringUtils.trimToEmpty(parsedField.getPropertyCode()));
            fieldJson.put("propertyName", StringUtils.trimToEmpty(parsedField.getPropertyName()));
            fieldJson.put("sourceObjectCode", StringUtils.trimToEmpty(parsedField.getSourceObjectCode()));
            fieldJson.put("sourceObjectColumnCode", StringUtils.trimToEmpty(parsedField.getSourceObjectColumnCode()));
            fields.add(fieldJson);
        }
        return fields;
    }

    private JSONArray resolveObjectFields(Long objectResourceId) {
        if (objectResourceId == null) {
            return new JSONArray();
        }
        SsResExtObject extObject = ssResExtObjectService.findById(objectResourceId);
        if (extObject == null || StringUtils.isBlank(extObject.getTargetContent())) {
            return new JSONArray();
        }
        try {
            // 对象 targetContent 已经是统一 JSON 结构，直接提取其中的 fields 节点即可复用。
            JSONObject objectTarget = JSON.parseObject(extObject.getTargetContent());
            JSONArray fields = objectTarget.getJSONArray("fields");
            return fields != null ? fields : new JSONArray();
        }
        catch (Exception e) {
            LOGGER.warn("解析对象字段失败, objectResourceId={}", objectResourceId, e);
            return new JSONArray();
        }
    }

    private void uploadTargetJson(String targetContent, Long resourceId, String filePrefix, String uploadSubDirectory) {
        // 每个资源都同步一份最终 targetContent，便于下游直接按资源ID消费。
        String fileName = filePrefix + "_" + resourceId + ".json";
        resourceArtifactStorageService.uploadToSubdirectory(
            targetContent.getBytes(StandardCharsets.UTF_8),
            uploadSubDirectory,
            fileName,
            "application/json");
    }

    private void replaceImportedBundleArtifacts(List<Long> importedResourceIds, String resourceBizType,
        String finalDirRelativePath, String originalZipFileName) {
        if (CollectionUtils.isEmpty(importedResourceIds)) {
            return;
        }
        for (Long importedResourceId : importedResourceIds) {
            if (importedResourceId == null) {
                continue;
            }
            List<SsResourceArtifact> artifacts = new ArrayList<>();
            artifacts.add(ssResourceArtifactService.buildArtifact(ResourceArtifactTypeEnum.STANDARD_JSON.name(),
                buildStandardJsonPath(resourceBizType, importedResourceId), "bundle-standard-json"));
            artifacts.add(ssResourceArtifactService.buildArtifact(ResourceArtifactTypeEnum.IMPORT_BUNDLE_DIR.name(),
                finalDirRelativePath, "bundle-directory"));
            artifacts.add(ssResourceArtifactService.buildArtifact(ResourceArtifactTypeEnum.IMPORT_ZIP.name(),
                finalDirRelativePath + "/" + originalZipFileName, "bundle-zip"));
            ssResourceArtifactService.replaceArtifacts(importedResourceId, resourceBizType, "minio", artifacts);
        }
    }

    private String buildStandardJsonPath(String resourceBizType, Long resourceId) {
        String directory = StringUtils.startsWithIgnoreCase(resourceBizType, "KG_")
            ? "doc"
            : StringUtils.trimToEmpty(resourceBizType).toLowerCase(Locale.ROOT);
        String fileName = StringUtils.trimToEmpty(resourceBizType).toUpperCase(Locale.ROOT) + "_" + resourceId
            + ".json";
        return directory + "/" + fileName;
    }

    /**
     * 对象/视图 zip 不再按历史的 TYPE_id1&id2 规则命名。
     * 若一个压缩包只导入出一个资源编码，则优先用该编码作为目录名；
     * 若导入出多个不同编码，则保留原目录名，避免误把多资源包改成单资源目录名。
     */
    private String resolveImportedBundleDirectoryName(String originalDirectoryName, List<String> importedResourceCodes,
                                                      String resourceLabel) {
        List<String> distinctCodes = importedResourceCodes.stream()
            .filter(StringUtils::isNotBlank)
            .map(StringUtils::trim)
            .distinct()
            .collect(Collectors.toList());
        if (distinctCodes.size() != 1) {
            LOGGER.info("{}压缩包包含多个资源编码或未解析到唯一编码，保留原目录名, originalDirectoryName={}, resourceCodes={}",
                resourceLabel, originalDirectoryName, distinctCodes);
            return originalDirectoryName;
        }
        return distinctCodes.get(0);
    }

    private Path renameLocalImportedDirectoryIfNecessary(Path extractedRoot, String finalDirectoryName,
                                                         String resourceLabel) {
        String currentDirectoryName = extractedRoot.getFileName().toString();
        if (StringUtils.equals(currentDirectoryName, finalDirectoryName)) {
            return extractedRoot;
        }
        Path renamedPath = extractedRoot.resolveSibling(finalDirectoryName);
        try {
            Files.move(extractedRoot, renamedPath, StandardCopyOption.REPLACE_EXISTING);
            LOGGER.info("{}解压目录名称与资源编码不一致，已按资源编码重命名, from={}, to={}",
                resourceLabel, currentDirectoryName, finalDirectoryName);
            return renamedPath;
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.unzip.directory.rename.failed"));
        }
    }

    private void deleteRemotePathIfDifferent(String targetRelativePath, String sourceRelativePath) {
        if (!StringUtils.equals(normalizeResourceRelativePath(targetRelativePath),
            normalizeResourceRelativePath(sourceRelativePath))) {
            resourceArtifactStorageService.deleteWithinResourceRoot(targetRelativePath);
        }
    }

    /**
     * 先把原始 zip 与本地解压内容同步到同名 staging 目录。
     * staging 目录后续会整体重命名成最终 bundle 目录，因此这里保留的就是最终要交付的原始解压内容。
     */
    private void stageImportedBundleDirectory(Path storedZipPath, Path extractedRoot, String stagingDirectory,
                                              String legacyRootZipPath) {
        Path bundleContentRoot = resolveBundleContentRoot(extractedRoot);
        resourceArtifactStorageService.deleteWithinResourceRoot(stagingDirectory);
        resourceArtifactStorageService.deleteWithinResourceRoot(legacyRootZipPath);
        uploadImportedZip(storedZipPath, storedZipPath.getFileName().toString(), stagingDirectory);
        resourceArtifactStorageService.uploadDirectoryToSubdirectory(bundleContentRoot, stagingDirectory);
    }

    /**
     * 将 staging 目录整体切换成最终目录。
     * 最终目录结构固定为：
     * bundleDir/
     *   原始zip文件
     *   ...原始解压内容...
     */
    private void finalizeImportedBundleDirectory(String stagingDirectory, String finalDirectory,
                                                 String originalZipFileName, String rootDirectory) {
        if (StringUtils.equals(normalizeResourceRelativePath(stagingDirectory),
            normalizeResourceRelativePath(finalDirectory))) {
            LOGGER.info("资源bundle目录无需重命名，跳过切换: directory={}", finalDirectory);
            // 根目录下不再保留额外 zip，最终只保留 bundle 目录这一份完整产物。
            resourceArtifactStorageService.deleteWithinResourceRoot(rootDirectory + "/" + originalZipFileName);
            return;
        }
        deleteRemotePathIfDifferent(finalDirectory, stagingDirectory);
        resourceArtifactStorageService.renameWithinResourceRoot(stagingDirectory, finalDirectory);
        // 根目录下不再保留额外 zip，最终只保留 bundle 目录这一份完整产物。
        resourceArtifactStorageService.deleteWithinResourceRoot(rootDirectory + "/" + originalZipFileName);
    }

    private String normalizeResourceRelativePath(String relativePath) {
        return StringUtils.trimToEmpty(relativePath).replace('\\', '/');
    }

    private void validateImportBundleResourceCount(int currentCount, String resourceLabel) {
        if (currentCount > MAX_IMPORT_BUNDLE_RESOURCE_COUNT) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.count.exceed",
                localizeResourceLabel(resourceLabel), currentCount, MAX_IMPORT_BUNDLE_RESOURCE_COUNT));
        }
    }

    /**
     * 某些 zip 会把真实内容再包一层同名目录。
     * 最终开放资源目录中的 bundle 不希望看到这层壳，所以这里优先把“唯一的业务根目录”提出来，
     * 让 bundle 目录下直接看到 ontology/... 这类真实内容。
     */
    private Path resolveBundleContentRoot(Path extractedRoot) {
        try (var children = Files.list(extractedRoot)) {
            List<Path> effectiveChildren = children
                .filter(path -> !containsMacOsMetadata(path))
                .filter(path -> {
                    String name = StringUtils.trimToEmpty(path.getFileName().toString());
                    return !name.startsWith("._");
                })
                .collect(Collectors.toList());
            if (effectiveChildren.size() == 1 && Files.isDirectory(effectiveChildren.get(0))) {
                Path nestedRoot = effectiveChildren.get(0);
                LOGGER.info("命中压缩包内容根目录, extractedRoot={}, bundleContentRoot={}", extractedRoot, nestedRoot);
                return nestedRoot;
            }
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.zip.content.root.parse.failed"));
        }
        return extractedRoot;
    }

    private void uploadImportedZip(Path storedZipPath, String zipFileName, String uploadSubDirectory) {
        try {
            // zip 当前统一进入 bundle 目录本身，做到“拿到一个目录就是完整产物”。
            byte[] zipBytes = Files.readAllBytes(storedZipPath.getParent().resolve(zipFileName));
            resourceArtifactStorageService.uploadToSubdirectory(
                zipBytes,
                uploadSubDirectory,
                zipFileName,
                "application/zip");
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("tool.resource.zip.upload.failed"));
        }
    }

    /**
     * add by qin.guoquan 2026-03-31
     */
    private static Long parseLongFlexible(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Number) {
            return ((Number) raw).longValue();
        }
        String s = String.valueOf(raw).trim();
        if (s.isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(s);
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 对象、视图导入成功后，自动补齐创建人的管理授权，避免导入人无法在授权侧继续维护资源。
     * 这里按资源 + 用户维度做幂等校验，已有有效授权时直接跳过。
     * @author qin.guoquan
     * @date 2026-04-24 17:45:00
     */
    private void ensureCreatorManagePrivilege(Long resourceId, String resourceBizType, Long userId) {
        if (resourceId == null || userId == null) {
            return;
        }
        List<PrivilegeGrant> privilegeGrants = privilegeGrantService.findPrivilegeGrant(
            GrantType.ALLOW_MANAGE, resourceBizType, resourceId, Color.RED);
        boolean exists = privilegeGrants.stream()
            .filter(Objects::nonNull)
            .anyMatch(privilegeGrant ->
                StringUtils.equals(privilegeGrant.getStatusCd(), "A")
                    && StringUtils.equals(privilegeGrant.getGrantToObjType(), GrantToObjType.USER)
                    && Objects.equals(privilegeGrant.getGrantToObjId(), userId));
        if (exists) {
            return;
        }
        PrivilegeGrant privilegeGrant = new PrivilegeGrant();
        privilegeGrant.setGrantType(GrantType.ALLOW_MANAGE);
        privilegeGrant.setGrantObjType(resourceBizType);
        privilegeGrant.setGrantObjId(resourceId);
        privilegeGrant.setGrantToObjType(GrantToObjType.USER);
        privilegeGrant.setGrantToObjId(userId);
        privilegeGrant.setGrantToType(Color.RED);
        privilegeGrant.setOperType(OperType.READ);
        privilegeGrant.setStatusCd("A");
        privilegeGrantService.save(privilegeGrant);
    }

    /**
     * 命中同编码资源并准备走更新时，校验当前操作用户是否具备该资源的管理权限。
     * 无权限时直接阻断导入更新，避免通过导入覆盖他人资源。
     * @author qin.guoquan
     * @date 2026-04-24 18:08:00
     */
    private void validateImportUpdatePermission(SsResource existing, String resourceCode) {
        if (existing == null) {
            return;
        }
        if (authApplicationService.hasResourceManagePermission(existing)) {
            return;
        }
        String resourceName = StringUtils.defaultIfBlank(existing.getResourceName(), resourceCode);
        throw new IllegalArgumentException(I18nUtil.get("tool.resource.import.update.no.permission", resourceCode,
            resourceName));
    }

    /**
     * 回填导入结果中的目录信息，便于前端直接展示资源所属目录。
     * @author qin.guoquan
     * @date 2026-04-24 10:24:00
     */
    private void fillImportCatalogInfo(ObjectZipImportItem item, Long catalogId) {
        item.setCatalogId(catalogId);
        if (catalogId == null) {
            item.setCatalogName("");
            return;
        }
        SsResourceCatalog catalog = ssResourceCatalogService.findById(catalogId);
        item.setCatalogName(catalog == null ? "" : StringUtils.defaultString(catalog.getCatalogName()));
    }

    /**
     * 基于导入明细聚合新增/更新统计和范围列表，方便前端直接展示摘要。
     * @author qin.guoquan
     * @date 2026-04-24 10:24:00
     */
    private void fillImportResultSummary(ObjectZipImportResult result) {
        List<ObjectZipImportItem> successItems = result.getItems().stream()
            .filter(ObjectZipImportItem::isSuccess)
            .collect(Collectors.toList());
        List<ObjectZipImportItem> createdItems = successItems.stream()
            .filter(item -> !item.isUpdated())
            .collect(Collectors.toList());
        List<ObjectZipImportItem> updatedItems = successItems.stream()
            .filter(ObjectZipImportItem::isUpdated)
            .collect(Collectors.toList());
        result.setCreatedCount(createdItems.size());
        result.setUpdatedCount(updatedItems.size());
        result.setCreatedItems(new ArrayList<>(createdItems));
        result.setUpdatedItems(new ArrayList<>(updatedItems));
    }

    /**
     * 读取对象更新前的 targetContent，供差异比较使用。
     * @author qin.guoquan
     * @date 2026-04-24 10:46:00
     */
    private String resolveExistingObjectTargetContent(SsResource existing) {
        if (existing == null || existing.getResourceId() == null) {
            return null;
        }
        SsResExtObject extObject = ssResExtObjectService.findById(existing.getResourceId());
        return extObject == null ? null : extObject.getTargetContent();
    }

    /**
     * 基于对象 targetContent 的前后 JSON 结构，提取基础信息和字段变更明细。
     * @author qin.guoquan
     * @date 2026-04-24 10:46:00
     */
    private List<ResourceImportDiffItem> buildObjectImportDiff(String oldTargetContent, String newTargetContent) {
        List<ResourceImportDiffItem> diffItems = new ArrayList<>();
        JSONObject oldJson = StringUtils.isBlank(oldTargetContent)
            ? new JSONObject(true) : JSON.parseObject(oldTargetContent, Feature.OrderedField);
        JSONObject newJson = StringUtils.isBlank(newTargetContent)
            ? new JSONObject(true) : JSON.parseObject(newTargetContent, Feature.OrderedField);

        String baseSection = I18nUtil.get("tool.import.diff.section.basic");
        String fieldSection = I18nUtil.get("tool.import.diff.section.field");
        compareSimpleJsonField(diffItems, baseSection, "resourceName", I18nUtil.get("tool.import.diff.field.resource.name"),
            oldJson, newJson);
        compareSimpleJsonField(diffItems, baseSection, "resourceDesc", I18nUtil.get("tool.import.diff.field.resource.desc"),
            oldJson, newJson);
        compareSimpleJsonField(diffItems, baseSection, "resourceVersionId",
            I18nUtil.get("tool.import.diff.field.resource.version"), oldJson, newJson);
        compareSimpleJsonField(diffItems, baseSection, "entitySource",
            I18nUtil.get("tool.import.diff.field.entity.source"), oldJson, newJson);

        Map<String, JSONObject> oldFields = indexFieldsByPropertyCode(oldJson.getJSONArray("fields"));
        Map<String, JSONObject> newFields = indexFieldsByPropertyCode(newJson.getJSONArray("fields"));
        Set<String> allFieldCodes = new LinkedHashSet<>();
        allFieldCodes.addAll(oldFields.keySet());
        allFieldCodes.addAll(newFields.keySet());

        for (String fieldCode : allFieldCodes) {
            JSONObject oldField = oldFields.get(fieldCode);
            JSONObject newField = newFields.get(fieldCode);
            if (oldField == null && newField != null) {
                diffItems.add(buildDiffItem(fieldSection, "ADDED", fieldCode,
                    newField.getString("propertyName"), "", normalizeJsonText(newField),
                    I18nUtil.get("tool.import.diff.field.added")));
                continue;
            }
            if (oldField != null && newField == null) {
                diffItems.add(buildDiffItem(fieldSection, "REMOVED", fieldCode,
                    oldField.getString("propertyName"), normalizeJsonText(oldField), "",
                    I18nUtil.get("tool.import.diff.field.removed")));
                continue;
            }
            compareObjectFieldDetail(diffItems, fieldCode, "propertyName",
                I18nUtil.get("tool.import.diff.field.property.name"), oldField, newField, fieldSection);
            compareObjectFieldDetail(diffItems, fieldCode, "dataType",
                I18nUtil.get("tool.import.diff.field.data.type"), oldField, newField, fieldSection);
            compareObjectFieldDetail(diffItems, fieldCode, "isRequired",
                I18nUtil.get("tool.import.diff.field.required"), oldField, newField, fieldSection);
            compareObjectFieldDetail(diffItems, fieldCode, "defaultValue",
                I18nUtil.get("tool.import.diff.field.default.value"), oldField, newField, fieldSection);
            compareObjectFieldDetail(diffItems, fieldCode, "sourceColumn",
                I18nUtil.get("tool.import.diff.field.source.column"), oldField, newField, fieldSection);
            compareObjectFieldDetail(diffItems, fieldCode, "synonyms",
                I18nUtil.get("tool.import.diff.field.synonyms"), oldField, newField, fieldSection);
        }
        return diffItems;
    }

    /**
     * 生成对象更新摘要，供前端列表直接展示。
     * @author qin.guoquan
     * @date 2026-04-24 10:46:00
     */
    private String buildObjectImportDiffSummary(List<ResourceImportDiffItem> diffItems) {
        if (CollectionUtils.isEmpty(diffItems)) {
            return I18nUtil.get("tool.import.diff.no.change");
        }
        String baseSection = I18nUtil.get("tool.import.diff.section.basic");
        String fieldSection = I18nUtil.get("tool.import.diff.section.field");
        long baseModifiedCount = diffItems.stream()
            .filter(item -> StringUtils.equals(item.getSection(), baseSection))
            .count();
        long addedFieldCount = diffItems.stream()
            .filter(item -> StringUtils.equals(item.getSection(), fieldSection))
            .filter(item -> StringUtils.equals(item.getChangeType(), "ADDED"))
            .count();
        long removedFieldCount = diffItems.stream()
            .filter(item -> StringUtils.equals(item.getSection(), fieldSection))
            .filter(item -> StringUtils.equals(item.getChangeType(), "REMOVED"))
            .count();
        long modifiedFieldCount = diffItems.stream()
            .filter(item -> StringUtils.equals(item.getSection(), fieldSection))
            .filter(item -> StringUtils.equals(item.getChangeType(), "MODIFIED"))
            .map(ResourceImportDiffItem::getFieldCode)
            .filter(StringUtils::isNotBlank)
            .distinct()
            .count();
        List<String> parts = new ArrayList<>();
        if (baseModifiedCount > 0) {
            parts.add(I18nUtil.get("tool.import.diff.summary.basic.modified", baseModifiedCount));
        }
        parts.add(I18nUtil.get("tool.import.diff.summary.field.added", addedFieldCount));
        parts.add(I18nUtil.get("tool.import.diff.summary.field.modified", modifiedFieldCount));
        parts.add(I18nUtil.get("tool.import.diff.summary.field.removed", removedFieldCount));
        return StringUtils.join(parts, I18nUtil.get("punctuation.comma"));
    }

    private void compareSimpleJsonField(List<ResourceImportDiffItem> diffItems, String section, String fieldCode,
                                        String fieldName, JSONObject oldJson, JSONObject newJson) {
        String beforeValue = normalizeValue(oldJson.get(fieldCode));
        String afterValue = normalizeValue(newJson.get(fieldCode));
        if (StringUtils.equals(beforeValue, afterValue)) {
            return;
        }
        diffItems.add(buildDiffItem(section, "MODIFIED", fieldCode, fieldName, beforeValue, afterValue,
            I18nUtil.get("tool.import.diff.field.changed", fieldName)));
    }

    private Map<String, JSONObject> indexFieldsByPropertyCode(JSONArray fields) {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        if (fields == null) {
            return result;
        }
        for (int i = 0; i < fields.size(); i++) {
            JSONObject field = fields.getJSONObject(i);
            if (field == null) {
                continue;
            }
            String propertyCode = StringUtils.trimToEmpty(field.getString("propertyCode"));
            if (StringUtils.isBlank(propertyCode)) {
                continue;
            }
            result.put(propertyCode, field);
        }
        return result;
    }

    private void compareObjectFieldDetail(List<ResourceImportDiffItem> diffItems, String fieldCode, String attrCode,
                                          String attrName, JSONObject oldField, JSONObject newField, String section) {
        String beforeValue = normalizeValue(oldField.get(attrCode));
        String afterValue = normalizeValue(newField.get(attrCode));
        if (StringUtils.equals(beforeValue, afterValue)) {
            return;
        }
        diffItems.add(buildDiffItem(section, "MODIFIED", fieldCode,
            StringUtils.defaultIfBlank(newField.getString("propertyName"), oldField.getString("propertyName")),
            beforeValue, afterValue, I18nUtil.get("tool.import.diff.field.changed", attrName)));
    }

    private ResourceImportDiffItem buildDiffItem(String section, String changeType, String fieldCode, String fieldName,
                                                 String beforeValue, String afterValue, String description) {
        ResourceImportDiffItem item = new ResourceImportDiffItem();
        item.setSection(section);
        item.setChangeType(changeType);
        item.setFieldCode(StringUtils.defaultString(fieldCode));
        item.setFieldName(StringUtils.defaultString(fieldName));
        item.setBeforeValue(StringUtils.defaultString(beforeValue));
        item.setAfterValue(StringUtils.defaultString(afterValue));
        item.setDescription(StringUtils.defaultString(description));
        return item;
    }

    private String normalizeValue(Object raw) {
        if (raw == null) {
            return "";
        }
        if (raw instanceof JSONObject || raw instanceof JSONArray) {
            return normalizeJsonText(raw);
        }
        return StringUtils.trimToEmpty(String.valueOf(raw));
    }

    private String normalizeJsonText(Object raw) {
        return JSON.toJSONString(raw, true);
    }

    private static final class ObjectImportSaveResult {
        private Long resourceId;
        private Long catalogId;
        private boolean updated;
        private String targetContent;
        private String diffSummary;
        private List<ResourceImportDiffItem> diffDetails = new ArrayList<>();

        Long getResourceId() {
            return resourceId;
        }

        void setResourceId(Long resourceId) {
            this.resourceId = resourceId;
        }

        Long getCatalogId() {
            return catalogId;
        }

        void setCatalogId(Long catalogId) {
            this.catalogId = catalogId;
        }

        boolean isUpdated() {
            return updated;
        }

        void setUpdated(boolean updated) {
            this.updated = updated;
        }

        String getTargetContent() {
            return targetContent;
        }

        void setTargetContent(String targetContent) {
            this.targetContent = targetContent;
        }

        String getDiffSummary() {
            return diffSummary;
        }

        void setDiffSummary(String diffSummary) {
            this.diffSummary = diffSummary;
        }

        List<ResourceImportDiffItem> getDiffDetails() {
            return diffDetails;
        }

        void setDiffDetails(List<ResourceImportDiffItem> diffDetails) {
            this.diffDetails = diffDetails;
        }
    }

    private static final class ViewImportSaveResult {
        private Long resourceId;
        private Long catalogId;
        private boolean updated;
        private String targetContent;
        private List<String> missingObjectCodes = new ArrayList<>();

        Long getResourceId() {
            return resourceId;
        }

        void setResourceId(Long resourceId) {
            this.resourceId = resourceId;
        }

        Long getCatalogId() {
            return catalogId;
        }

        void setCatalogId(Long catalogId) {
            this.catalogId = catalogId;
        }

        boolean isUpdated() {
            return updated;
        }

        void setUpdated(boolean updated) {
            this.updated = updated;
        }

        String getTargetContent() {
            return targetContent;
        }

        void setTargetContent(String targetContent) {
            this.targetContent = targetContent;
        }

        List<String> getMissingObjectCodes() {
            return missingObjectCodes;
        }

        void setMissingObjectCodes(List<String> missingObjectCodes) {
            this.missingObjectCodes = missingObjectCodes;
        }
    }

    private static final class ViewRelationResult {
        private final List<SsResource> resolvedObjects;
        private final List<String> missingObjectCodes;

        private ViewRelationResult(List<SsResource> resolvedObjects, List<String> missingObjectCodes) {
            this.resolvedObjects = resolvedObjects;
            this.missingObjectCodes = missingObjectCodes;
        }

        List<SsResource> getResolvedObjects() {
            return resolvedObjects;
        }

        List<String> getMissingObjectCodes() {
            return missingObjectCodes;
        }
    }

    /**
     * 资源 curl 生成与运行所需的扩展内容载体。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    private static final class ResourceCurlContent {
        private SsResource resource;
        private String sourceContent;
        private String targetContent;

        SsResource getResource() {
            return resource;
        }

        void setResource(SsResource resource) {
            this.resource = resource;
        }

        String getSourceContent() {
            return sourceContent;
        }

        void setSourceContent(String sourceContent) {
            this.sourceContent = sourceContent;
        }

        String getTargetContent() {
            return targetContent;
        }

        void setTargetContent(String targetContent) {
            this.targetContent = targetContent;
        }
    }
}
