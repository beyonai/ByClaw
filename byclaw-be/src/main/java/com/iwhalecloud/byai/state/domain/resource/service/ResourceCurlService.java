package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.CurlParser;
import com.iwhalecloud.byai.common.util.CurlParser.ParsedCurl;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtAgentService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlParseResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 资源curl操作业务类
 *
 * @author qin.guoquan
 * @date 2026-05-18 14:12:18
 */
@Service
public class ResourceCurlService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceCurlService.class);

    private static final String CURL_GENERATE_SOURCE_RULE = "RULE";

    private static final String CURL_GENERATE_SOURCE_LLM = "LLM";

    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);

    private static final Pattern TEMPLATE_PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{[^}]+}");

    private static final Set<String> TOOL_CURL_BIZ_TYPES = Set.of(ResourceBizType.TOOL.getCode(),
        ResourceBizType.TOOLKIT.getCode(), ResourceBizType.MCP.getCode(), ResourceBizType.AGENT.getCode());

    private static final Set<String> READ_OPERATION_KEYWORDS = Set.of("query", "list", "get", "search", "find",
        "detail", "read", "select", "page", "count", "describe", "lookup", "fetch");

    private static final Set<String> WRITE_OPERATION_KEYWORDS = Set.of("create", "delete", "update", "save", "remove",
        "insert", "modify", "edit", "publish", "send", "submit", "upload", "download", "import", "export", "sync",
        "bind", "unbind", "grant", "revoke", "approve", "reject");

    private static final OkHttpClient RESOURCE_CURL_HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.SECONDS)
        .build();

    private static final OkHttpClient RESOURCE_JSON_VALIDATION_HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).writeTimeout(3, TimeUnit.SECONDS)
        .build();

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtToolKitService ssResExtToolKitService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private SsResExtAgentService ssResExtAgentService;

    @Autowired
    private AIService aiService;

    @Autowired
    private JwtService jwtService;

    @Value("${HOST:}")
    private String host;

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

    public ResourceCurlGenerateResult generateResourceCurl(ResourceCurlGenerateRequest request) {
        Long resourceId = request.getResourceId();
        ResourceCurlContent content = this.loadResourceCurlContent(resourceId);
        if (StringUtils.isBlank(content.getSourceContent())) {
            throw new IllegalArgumentException(I18nUtil.get("resource.curl.source.content.empty"));
        }

        ResourceCurlGenerateResult result = new ResourceCurlGenerateResult();
        if (ResourceBizType.AGENT.getCode().equalsIgnoreCase(content.getResourceBizType())) {
            result.setCurl(this.tryBuildAgentCurl(content.getSourceContent()));
            result.setSource(CURL_GENERATE_SOURCE_RULE);
            result.setMessage(I18nUtil.get("resource.curl.generate.rule.success"));
            return result;
        }

        String curl = tryBuildCurlByRule(content.getSourceContent());
        if (StringUtils.isNotBlank(curl)) {
            result.setCurl(curl);
            result.setSource(CURL_GENERATE_SOURCE_RULE);
            result.setMessage(I18nUtil.get("resource.curl.generate.rule.success"));
            return result;
        }

        curl = buildCurlByLargeModel(content.getSourceContent());
        validateSafeCurlCommand(curl);
        result.setCurl(curl);
        result.setSource(CURL_GENERATE_SOURCE_LLM);
        result.setMessage(I18nUtil.get("resource.curl.generate.llm.success"));
        return result;
    }

    /**
     * @param sourceContent 来源
     * @return String
     */
    private String tryBuildAgentCurl(String sourceContent) {

        JSONObject jsonObject = JSON.parseObject(sourceContent);

        // 请求头，要添加beyond-Token
        JSONObject headers = jsonObject.getJSONObject("headers");
        if (headers == null) {
            headers = new JSONObject();
        }
        headers.put("Beyond-Token", jwtService.createJwt(CurrentUserHolder.getLoginInfo()));

        // 请求地址
        String domainURL = jsonObject.getString("domainURL");
        JSONObject metaContent = jsonObject.getJSONObject("metaContent");
        String agentSseUrl = metaContent.getString("agentSseUrl");

        // 智能体请求参数
        Map<String, Object> body = new HashMap<>();
        body.put("chatContent", "Hello");
        body.put("chatId", UUID.randomUUID().toString().replace("-", ""));

        return this.buildCurlScript("POST", joinUrl(domainURL, agentSseUrl), headers, JSON.toJSONString(body));
    }

    public ResourceCurlRunResult runResourceCurl(ResourceCurlRunRequest request) {
        Long resourceId = request == null ? null : request.getResourceId();
        String curl = normalizeCurlLineContinuation(request == null ? null : request.getCurl());
        ResourceCurlContent content = loadResourceCurlContent(resourceId);
        return runCurl(content, curl, RESOURCE_CURL_HTTP_CLIENT);
    }

    /**
     * Toolkit 资源 JSON 写入前连通性校验：优先选择读/查类接口，只真实调用一次。
     */
    public ResourceCurlRunResult runValidationToolkitTool(String sourceContent) {
        String curl = tryBuildConnectivityValidationCurlByRule(sourceContent);
        if (StringUtils.isBlank(curl)) {
            return skippedValidationResult(I18nUtil.get(
                "resource.json.connectivity.validation.toolkit.readonly.notfound"));
        }
        curl = resolveTemplatePlaceholders(curl);
        if (containsTemplatePlaceholder(curl)) {
            return skippedValidationResult(I18nUtil.get(
                "resource.json.connectivity.validation.toolkit.placeholder.url"));
        }
        return runRawResourceCurl(ResourceBizType.TOOLKIT.getCode(), sourceContent, curl);
    }

    /**
     * Agent 资源 JSON 写入前连通性校验：只测试 Agent 自身 SSE/chat 入口。
     */
    public ResourceCurlRunResult runAgentHealth(String sourceContent) {
        String curl = tryBuildAgentCurl(sourceContent);
        return runRawResourceCurl(ResourceBizType.AGENT.getCode(), sourceContent, curl);
    }

    /**
     * 按指定 OpenAPI operation 生成最小 JSON 请求并执行。
     */
    public ResourceCurlRunResult runOpenApiOperation(String resourceBizType, String sourceContent, JSONObject openApi,
        String operationId, Set<String> pathKeywords, Map<String, Object> bodyOverrides,
        Map<String, Object> extraHeaders) {

        OpenApiOperation operation = resolveOpenApiOperation(openApi, operationId, pathKeywords);
        String curl = buildOpenApiOperationCurl(openApi, operation, bodyOverrides, extraHeaders);
        return runRawResourceCurl(resourceBizType, sourceContent, curl);
    }

    /**
     * 按普通 method/path 描述构造 JSON 请求并执行，兼容未携带 openapiSchema 的知识库 resourceService。
     */
    public ResourceCurlRunResult runSimpleJsonOperation(String resourceBizType, String sourceContent, String method,
        String url, Map<String, Object> body, Map<String, Object> extraHeaders) {

        Map<String, Object> headers = buildJsonHeaders(extraHeaders);
        String requestBody = body == null || body.isEmpty() ? null : JSON.toJSONString(body);
        String curl = buildCurlScript(method, url, headers, requestBody);
        return runRawResourceCurl(resourceBizType, sourceContent, curl);
    }

    private ResourceCurlRunResult runRawResourceCurl(String resourceBizType, String sourceContent, String curl) {
        ResourceCurlContent content = new ResourceCurlContent();
        content.setResourceBizType(resourceBizType);
        // 写入前校验阶段没有 resourceId 和扩展表上下文，只能用当前 JSON 作为 source/target 的 host 白名单来源。
        content.setSourceContent(sourceContent);
        content.setTargetContent(sourceContent);
        return runCurl(content, curl, RESOURCE_JSON_VALIDATION_HTTP_CLIENT);
    }

    private ResourceCurlRunResult skippedValidationResult(String reason) {
        ResourceCurlRunResult result = new ResourceCurlRunResult();
        result.setSuccess(true);
        result.setStatusCode(0);
        result.setBody(StringUtils.defaultString(reason));
        result.setDurationMs(0L);
        return result;
    }

    private ResourceCurlRunResult runCurl(ResourceCurlContent content, String curl, OkHttpClient httpClient) {
        String normalizedCurl = normalizeCurlLineContinuation(curl);
        validateSafeCurlCommand(normalizedCurl);

        ParsedCurl parsed = CurlParser.parse(normalizedCurl);
        // 防止生成或传入的 curl 访问 JSON 定义之外的地址，保持与工具详情页测试按钮一致的安全边界。
        validateCurlTargetHost(parsed.getFullUrl(), content);

        long start = System.currentTimeMillis();
        ResourceCurlRunResult result = new ResourceCurlRunResult();
        try (Response response = httpClient.newCall(buildHttpRequest(parsed)).execute()) {
            result.setSuccess(response.isSuccessful());
            result.setStatusCode(response.code());
            result.setHeaders(flattenHeaders(response));
            ResponseBody responseBody = response.body();
            result.setBody(responseBody == null ? "" : responseBody.string());
        }
        catch (IOException e) {
            result.setSuccess(false);
            result.setErrorMessage(e.getMessage());
        }
        finally {
            result.setDurationMs(System.currentTimeMillis() - start);
        }
        return result;
    }

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
            throw new IllegalArgumentException(I18nUtil.get("resource.curl.only.tool.resource.supported"));
        }
        ResourceCurlContent content = new ResourceCurlContent();
        content.setResourceBizType(resourceBizType);
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

    private String tryBuildCurlByRule(String sourceContent) {
        return tryBuildCurlByRule(sourceContent, false);
    }

    private String tryBuildConnectivityValidationCurlByRule(String sourceContent) {
        return tryBuildCurlByRule(sourceContent, true);
    }

    private String tryBuildCurlByRule(String sourceContent, boolean preferReadOnlyOperation) {
        String trimmed = StringUtils.trimToEmpty(sourceContent);
        if (StringUtils.startsWithIgnoreCase(trimmed, "curl ")) {
            String normalizedCurl = normalizeCurlLineContinuation(trimmed);
            validateSafeCurlCommand(normalizedCurl);
            return normalizedCurl;
        }
        try {
            JSONObject root = JSON.parseObject(trimmed, Feature.OrderedField);
            JSONObject openApi = resolveOpenApiNode(root, preferReadOnlyOperation);
            if (openApi != null && !openApi.isEmpty()) {
                String baseUrl = resolveOpenApiBaseUrl(openApi);
                JSONObject paths = openApi.getJSONObject("paths");
                OpenApiOperation selectedOperation = paths == null ? null
                    : resolveFirstOrReadOnlyOperation(paths, preferReadOnlyOperation);
                if (StringUtils.isNotBlank(baseUrl) && selectedOperation != null) {
                    JSONObject operation = selectedOperation.operation();
                    String requestBody = buildCurlRequestBody(operation);

                    Map<String, Object> headers = new HashMap<>();
                    headers.put("Content-Type", "application/json");
                    return this.buildCurlScript(selectedOperation.method(), joinUrl(baseUrl, selectedOperation.path()),
                        headers, requestBody);
                }
            }
            return tryBuildSimpleResourceServiceCurl(root, preferReadOnlyOperation);
        }
        catch (Exception e) {
            LOGGER.info("规则生成curl失败，将尝试大模型兜底, reason={}", e.getMessage());
            return null;
        }
    }

    private JSONObject resolveOpenApiNode(JSONObject root) {
        return resolveOpenApiNode(root, false);
    }

    private JSONObject resolveOpenApiNode(JSONObject root, boolean preferReadOnlyOperation) {
        if (root == null) {
            return null;
        }
        if (root.containsKey("paths")) {
            return root;
        }
        JSONObject openApi = root.getJSONObject("openAPI");
        if (openApi != null) {
            if (preferReadOnlyOperation && !hasReadOnlyOperation(openApi)) {
                return null;
            }
            return openApi;
        }
        JSONObject pluginMachineOpenApi = resolveOpenApiFromPluginMachineInfo(root, preferReadOnlyOperation);
        if (pluginMachineOpenApi != null) {
            return pluginMachineOpenApi;
        }
        JSONArray tools = root.getJSONArray("tools");
        if (tools != null && !tools.isEmpty()) {
            JSONObject fallback = null;
            for (int i = 0; i < tools.size(); i++) {
                JSONObject tool = tools.getJSONObject(i);
                JSONObject toolOpenApi = tool == null ? null : tool.getJSONObject("openAPI");
                if (toolOpenApi == null || toolOpenApi.isEmpty()) {
                    continue;
                }
                if (fallback == null) {
                    fallback = toolOpenApi;
                }
                if (preferReadOnlyOperation && hasReadOnlyOperation(toolOpenApi)) {
                    return toolOpenApi;
                }
            }
            return preferReadOnlyOperation ? null : fallback;
        }
        return null;
    }

    private JSONObject resolveOpenApiFromPluginMachineInfo(JSONObject root, boolean preferReadOnlyOperation) {
        JSONArray pluginMachineInfo = root == null ? null : root.getJSONArray("pluginMachineInfo");
        if (pluginMachineInfo == null || pluginMachineInfo.isEmpty()) {
            return null;
        }
        JSONObject fallback = null;
        for (int i = 0; i < pluginMachineInfo.size(); i++) {
            JSONObject machineInfo = pluginMachineInfo.getJSONObject(i);
            JSONObject openApi = machineInfo == null ? null : machineInfo.getJSONObject("pluginMachineOpenAPI");
            if (openApi == null || openApi.isEmpty()) {
                continue;
            }
            if (fallback == null) {
                fallback = openApi;
            }
            if (preferReadOnlyOperation && hasReadOnlyOperation(openApi)) {
                return openApi;
            }
        }
        return preferReadOnlyOperation ? null : fallback;
    }

    private String tryBuildSimpleResourceServiceCurl(JSONObject root, boolean preferReadOnlyOperation) {
        JSONArray resourceService = root == null ? null : root.getJSONArray("resourceService");
        if (resourceService == null || resourceService.isEmpty()) {
            return null;
        }
        JSONObject selectedService = resolveFirstOrReadOnlySimpleService(resourceService, preferReadOnlyOperation);
        if (selectedService == null) {
            return null;
        }
        String baseUrl = StringUtils.defaultIfBlank(root.getString("domainURL"), root.getString("domainUrl"));
        String path = selectedService.getString("path");
        if (StringUtils.isBlank(baseUrl) || StringUtils.isBlank(path)) {
            return null;
        }

        String method = StringUtils.upperCase(StringUtils.defaultIfBlank(selectedService.getString("method"), "POST"));
        String requestBody = buildSimpleServiceRequestBody(selectedService.getJSONArray("bodyParams"));
        Map<String, Object> headers = buildSimpleServiceHeaders(root, selectedService, StringUtils.isNotBlank(requestBody));
        String url = appendQueryParams(joinUrl(baseUrl, path), selectedService.getJSONArray("queryParams"));
        return buildCurlScript(method, url, headers, requestBody);
    }

    private JSONObject resolveFirstOrReadOnlySimpleService(JSONArray resourceService, boolean preferReadOnlyOperation) {
        JSONObject fallback = null;
        for (int i = 0; i < resourceService.size(); i++) {
            JSONObject service = resourceService.getJSONObject(i);
            if (service == null || StringUtils.isBlank(service.getString("path"))) {
                continue;
            }
            if (fallback == null) {
                fallback = service;
            }
            if (preferReadOnlyOperation && isReadOnlySimpleService(service)) {
                return service;
            }
        }
        return preferReadOnlyOperation ? null : fallback;
    }

    private boolean isReadOnlySimpleService(JSONObject service) {
        if (service == null) {
            return false;
        }
        String method = service.getString("method");
        if ("get".equalsIgnoreCase(method)) {
            return true;
        }
        String haystack = StringUtils.lowerCase(String.join(" ",
            StringUtils.defaultString(method),
            StringUtils.defaultString(service.getString("path")),
            StringUtils.defaultString(service.getString("action")),
            StringUtils.defaultString(service.getString("serviceCode")),
            StringUtils.defaultString(service.getString("serviceName")),
            StringUtils.defaultString(service.getString("serviceDesc"))));
        if (containsAnyKeyword(haystack, WRITE_OPERATION_KEYWORDS)) {
            return false;
        }
        return containsAnyKeyword(haystack, READ_OPERATION_KEYWORDS);
    }

    private Map<String, Object> buildSimpleServiceHeaders(JSONObject root, JSONObject service, boolean hasRequestBody) {
        Map<String, Object> headers = new LinkedHashMap<>();
        appendHeaderObject(headers, root == null ? null : root.getJSONObject("headers"));
        appendHeaderArray(headers, service == null ? null : service.getJSONArray("headers"));
        if (hasRequestBody && !containsHeader(headers, "Content-Type")) {
            headers.put("Content-Type", "application/json");
        }
        return headers;
    }

    private void appendHeaderObject(Map<String, Object> headers, JSONObject headerObject) {
        if (headerObject == null || headerObject.isEmpty()) {
            return;
        }
        headerObject.forEach((key, value) -> putHeader(headers, key, value));
    }

    private void appendHeaderArray(Map<String, Object> headers, JSONArray headerArray) {
        if (headerArray == null || headerArray.isEmpty()) {
            return;
        }
        for (int i = 0; i < headerArray.size(); i++) {
            JSONObject header = headerArray.getJSONObject(i);
            if (header == null) {
                continue;
            }
            putHeader(headers, header.getString("name"), header.get("value"));
        }
    }

    private void putHeader(Map<String, Object> headers, String name, Object value) {
        if (StringUtils.isBlank(name)) {
            return;
        }
        headers.put(name, value == null ? "" : value);
    }

    private boolean containsHeader(Map<String, Object> headers, String name) {
        if (headers == null || headers.isEmpty() || StringUtils.isBlank(name)) {
            return false;
        }
        return headers.keySet().stream().anyMatch(key -> StringUtils.equalsIgnoreCase(key, name));
    }

    private String appendQueryParams(String url, JSONArray queryParams) {
        if (StringUtils.isBlank(url) || queryParams == null || queryParams.isEmpty()) {
            return url;
        }
        StringBuilder query = new StringBuilder();
        for (int i = 0; i < queryParams.size(); i++) {
            JSONObject param = queryParams.getJSONObject(i);
            String name = param == null ? null : param.getString("name");
            if (StringUtils.isBlank(name)) {
                continue;
            }
            if (query.length() > 0) {
                query.append('&');
            }
            query.append(urlEncode(name)).append('=').append(urlEncode(String.valueOf(sampleValueByParam(param))));
        }
        if (query.length() == 0) {
            return url;
        }
        String delimiter = url.contains("?") ? "&" : "?";
        return url + delimiter + query;
    }

    private String buildSimpleServiceRequestBody(JSONArray bodyParams) {
        if (bodyParams == null || bodyParams.isEmpty()) {
            return null;
        }
        JSONObject body = new JSONObject(true);
        for (int i = 0; i < bodyParams.size(); i++) {
            JSONObject param = bodyParams.getJSONObject(i);
            String name = param == null ? null : param.getString("name");
            if (StringUtils.isBlank(name)) {
                continue;
            }
            body.put(name, sampleValueByParam(param));
        }
        return body.isEmpty() ? null : body.toJSONString();
    }

    private Object sampleValueByParam(JSONObject param) {
        if (param == null) {
            return "";
        }
        Object example = param.get("example");
        if (example != null) {
            return example;
        }
        Object value = param.get("value");
        if (value != null) {
            return value;
        }
        Object defaultValue = param.get("defaultValue");
        if (defaultValue != null) {
            return defaultValue;
        }
        String type = StringUtils.lowerCase(StringUtils.defaultIfBlank(param.getString("type"), "string"));
        return switch (type) {
            case "integer", "int", "long", "number", "double", "float" -> 0;
            case "boolean", "bool" -> false;
            case "array" -> new JSONArray();
            case "object" -> new JSONObject(true);
            default -> "";
        };
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(StringUtils.defaultString(value), StandardCharsets.UTF_8);
    }

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

    private OpenApiOperation resolveFirstOrReadOnlyOperation(JSONObject paths, boolean preferReadOnlyOperation) {
        OpenApiOperation fallback = null;
        for (String path : paths.keySet()) {
            JSONObject pathItem = paths.getJSONObject(path);
            if (pathItem == null || pathItem.isEmpty()) {
                continue;
            }
            for (String method : List.of("get", "post", "put", "patch", "delete")) {
                if (!pathItem.containsKey(method)) {
                    continue;
                }
                JSONObject operation = pathItem.getJSONObject(method);
                OpenApiOperation current = new OpenApiOperation(path, method.toUpperCase(Locale.ROOT), operation);
                if (fallback == null) {
                    fallback = current;
                }
                // 连通性校验优先选择读/查类接口，尽量避开创建、删除、发送等有副作用接口。
                if (preferReadOnlyOperation && isReadOnlyOperation(path, method, operation)) {
                    return current;
                }
            }
        }
        return preferReadOnlyOperation ? null : fallback;
    }

    private boolean containsTemplatePlaceholder(String value) {
        return TEMPLATE_PLACEHOLDER_PATTERN.matcher(StringUtils.defaultString(value)).find();
    }

    private String resolveTemplatePlaceholders(String value) {
        String resolved = StringUtils.defaultString(value);
        if (!resolved.contains("${HOST}")) {
            return resolved;
        }
        String host = resolveConnectivityValidationHost();
        if (StringUtils.isBlank(host)) {
            return resolved;
        }
        return resolved.replace("${HOST}", host);
    }

    private String resolveConnectivityValidationHost() {
        String configuredHost = normalizeHost(host);
        if (StringUtils.isNotBlank(configuredHost)) {
            return configuredHost;
        }
        HttpServletRequest request = currentHttpServletRequest();
        if (request == null) {
            return "";
        }
        String forwardedHost = firstHeaderValue(request.getHeader("X-Forwarded-Host"));
        String host = normalizeHost(forwardedHost);
        if (StringUtils.isNotBlank(host)) {
            return host;
        }
        host = normalizeHost(request.getHeader("Host"));
        if (StringUtils.isNotBlank(host)) {
            return host;
        }
        return normalizeHost(request.getServerName());
    }

    private HttpServletRequest currentHttpServletRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }

    private String firstHeaderValue(String value) {
        String trimmed = StringUtils.trimToEmpty(value);
        int commaIndex = trimmed.indexOf(',');
        return commaIndex < 0 ? trimmed : StringUtils.trimToEmpty(trimmed.substring(0, commaIndex));
    }

    private String normalizeHost(String host) {
        String normalized = StringUtils.trimToEmpty(host);
        if (StringUtils.isBlank(normalized)) {
            return "";
        }
        if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
            try {
                return StringUtils.defaultString(URI.create(normalized).getHost());
            }
            catch (Exception e) {
                return "";
            }
        }
        if (normalized.startsWith("[")) {
            int endBracketIndex = normalized.indexOf(']');
            return endBracketIndex > 0 ? normalized.substring(1, endBracketIndex) : normalized;
        }
        int colonIndex = normalized.indexOf(':');
        return colonIndex < 0 ? normalized : normalized.substring(0, colonIndex);
    }

    private boolean hasReadOnlyOperation(JSONObject openApi) {
        JSONObject paths = openApi == null ? null : openApi.getJSONObject("paths");
        OpenApiOperation selectedOperation = paths == null ? null : resolveFirstOrReadOnlyOperation(paths, true);
        return isReadOnlyOperation(selectedOperation);
    }

    private boolean isReadOnlyOperation(OpenApiOperation operation) {
        return operation != null && isReadOnlyOperation(operation.path(),
            StringUtils.lowerCase(operation.method()), operation.operation());
    }

    private boolean isReadOnlyOperation(String path, String method, JSONObject operation) {
        if ("get".equalsIgnoreCase(method)) {
            return true;
        }
        String haystack = buildOperationHaystack(path, method, operation);
        if (containsAnyKeyword(haystack, WRITE_OPERATION_KEYWORDS)) {
            return false;
        }
        return containsAnyKeyword(haystack, READ_OPERATION_KEYWORDS);
    }

    private String buildOperationHaystack(String path, String method, JSONObject operation) {
        if (operation == null) {
            return StringUtils.lowerCase(StringUtils.defaultString(method) + " " + StringUtils.defaultString(path));
        }
        return StringUtils.lowerCase(String.join(" ",
            StringUtils.defaultString(method),
            StringUtils.defaultString(path),
            StringUtils.defaultString(operation.getString("operationId")),
            StringUtils.defaultString(operation.getString("summary")),
            StringUtils.defaultString(operation.getString("description"))));
    }

    private boolean containsAnyKeyword(String haystack, Set<String> keywords) {
        if (StringUtils.isBlank(haystack) || keywords == null || keywords.isEmpty()) {
            return false;
        }
        return keywords.stream().anyMatch(haystack::contains);
    }

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

    private OpenApiOperation resolveOpenApiOperation(JSONObject openApi, String operationId, Set<String> pathKeywords) {
        if (openApi == null || openApi.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("resource.openapi.empty"));
        }
        JSONObject paths = openApi.getJSONObject("paths");
        if (paths == null || paths.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("resource.openapi.paths.empty"));
        }
        Set<String> normalizedKeywords = normalizeKeywords(pathKeywords);
        OpenApiOperation firstOperation = null;
        for (String path : paths.keySet()) {
            JSONObject pathItem = paths.getJSONObject(path);
            if (pathItem == null || pathItem.isEmpty()) {
                continue;
            }
            for (String method : List.of("get", "post", "put", "patch", "delete")) {
                if (!pathItem.containsKey(method)) {
                    continue;
                }
                JSONObject operation = pathItem.getJSONObject(method);
                OpenApiOperation current = new OpenApiOperation(path, method.toUpperCase(Locale.ROOT), operation);
                if (firstOperation == null) {
                    firstOperation = current;
                }
                // 优先按 operationId 精确匹配；导入 JSON 缺 operationId 时，再用 path/action 关键词兜底。
                String currentOperationId = operation == null ? null : operation.getString("operationId");
                if (StringUtils.isNotBlank(operationId) && StringUtils.equalsIgnoreCase(operationId,
                    currentOperationId)) {
                    return current;
                }
                if (matchesOperationKeyword(path, currentOperationId, normalizedKeywords)) {
                    return current;
                }
            }
        }
        if (StringUtils.isBlank(operationId) && normalizedKeywords.isEmpty() && firstOperation != null) {
            // Toolkit 的轻量校验没有指定接口时只取一个 path/method，避免写入阶段全量调用外部接口。
            return firstOperation;
        }
        throw new IllegalArgumentException(I18nUtil.get("resource.openapi.operation.notfound", operationId));
    }

    private Set<String> normalizeKeywords(Set<String> pathKeywords) {
        Set<String> normalized = new LinkedHashSet<>();
        if (pathKeywords == null || pathKeywords.isEmpty()) {
            return normalized;
        }
        for (String keyword : pathKeywords) {
            String value = StringUtils.lowerCase(StringUtils.trimToEmpty(keyword));
            if (StringUtils.isNotBlank(value)) {
                normalized.add(value);
            }
        }
        return normalized;
    }

    private boolean matchesOperationKeyword(String path, String operationId, Set<String> keywords) {
        if (keywords == null || keywords.isEmpty()) {
            return false;
        }
        String haystack = StringUtils.lowerCase(StringUtils.defaultString(path) + " "
            + StringUtils.defaultString(operationId));
        return keywords.stream().anyMatch(haystack::contains);
    }

    private String buildOpenApiOperationCurl(JSONObject openApi, OpenApiOperation selectedOperation,
        Map<String, Object> bodyOverrides, Map<String, Object> extraHeaders) {

        String baseUrl = resolveOpenApiBaseUrl(openApi);
        if (StringUtils.isBlank(baseUrl)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.openapi.base.url.missing"));
        }
        String requestBody = buildCurlRequestBody(selectedOperation.operation());
        // 知识库 create/delete 需要使用同一个临时 knCode；这里只覆盖 schema 已声明的字段，避免传入多余参数。
        requestBody = mergeJsonBodyOverrides(requestBody, bodyOverrides);
        Map<String, Object> headers = buildJsonHeaders(extraHeaders);
        return buildCurlScript(selectedOperation.method(), joinUrl(baseUrl, selectedOperation.path()), headers,
            requestBody);
    }

    private Map<String, Object> buildJsonHeaders(Map<String, Object> extraHeaders) {
        Map<String, Object> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (extraHeaders != null) {
            headers.putAll(extraHeaders);
        }
        return headers;
    }

    private String mergeJsonBodyOverrides(String requestBody, Map<String, Object> bodyOverrides) {
        if (bodyOverrides == null || bodyOverrides.isEmpty()) {
            return requestBody;
        }
        JSONObject body = parseBodyObject(requestBody);
        boolean bodyWasEmpty = body.isEmpty();
        bodyOverrides.forEach((key, value) -> {
            if (StringUtils.isBlank(key)) {
                return;
            }
            if (bodyWasEmpty || body.containsKey(key)) {
                body.put(key, value);
            }
        });
        return body.toJSONString();
    }

    private JSONObject parseBodyObject(String requestBody) {
        if (StringUtils.isBlank(requestBody)) {
            return new JSONObject(true);
        }
        try {
            JSONObject parsed = JSON.parseObject(requestBody, Feature.OrderedField);
            return parsed == null ? new JSONObject(true) : parsed;
        }
        catch (Exception e) {
            return new JSONObject(true);
        }
    }

    private String buildCurlScript(String method, String url, Map<String, Object> headers, String requestBody) {
        StringBuilder curl = new StringBuilder();
        curl.append("curl -X ").append(method).append(" ").append(shellQuote(url));

        for (Map.Entry<String, Object> entrySet : headers.entrySet()) {
            curl.append(" \\\n  -H ").append(shellQuote(entrySet.getKey() + ": " + entrySet.getValue()));
        }

        if (StringUtils.isNotBlank(requestBody) && !"GET".equalsIgnoreCase(method)) {
            curl.append(" \\\n  -d ").append(shellQuote(requestBody));
        }
        return curl.toString();
    }

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

    private String normalizeCurlFromLargeModel(String modelOutput) {
        String curl = StringUtils.trimToEmpty(modelOutput);
        curl = curl.replaceAll("(?is)<think>[^<]*+(?:<(?!/think>)[^<]*+)*+</think>", "");
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
                if (StringUtils.endsWith(command.toString(), "\\") || StringUtils.startsWith(nextLine, "-")
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

    private String normalizeCurlLineContinuation(String curl) {
        return StringUtils.trimToEmpty(curl).replace("\\\r\n", " ").replace("\\\n", " ").replace("\\\r", " ");
    }

    private void validateSafeCurlCommand(String curl) {
        String trimmed = StringUtils.trimToEmpty(curl);
        if (StringUtils.isBlank(trimmed)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.curl.script.empty"));
        }
        if (!StringUtils.startsWithIgnoreCase(trimmed, "curl ")) {
            throw new IllegalArgumentException(I18nUtil.get("resource.curl.only.supported"));
        }
        validateNoUnquotedShellControl(trimmed);
    }

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
                throw new IllegalArgumentException(I18nUtil.get("resource.curl.shell.control.not.allowed"));
            }
        }
    }

    private void validateCurlTargetHost(String fullUrl, ResourceCurlContent content) {
        Set<String> allowedHosts = extractHosts(content.getSourceContent());
        allowedHosts.addAll(extractHosts(content.getTargetContent()));
        if (allowedHosts.isEmpty()) {
            return;
        }
        String host = parseHost(fullUrl);
        if (StringUtils.isBlank(host) || !allowedHosts.contains(host)) {
            throw new IllegalArgumentException(I18nUtil.get("resource.curl.target.host.out.of.scope"));
        }
    }

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

    private String parseHost(String url) {
        try {
            URI uri = URI.create(url);
            return StringUtils.lowerCase(uri.getHost());
        }
        catch (Exception e) {
            return null;
        }
    }

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

    private Map<String, String> flattenHeaders(Response response) {
        Map<String, String> headers = new LinkedHashMap<>();
        response.headers().names().forEach(name -> headers.put(name, response.header(name)));
        return headers;
    }

    private String joinUrl(String baseUrl, String path) {
        String safeBase = StringUtils.removeEnd(StringUtils.trimToEmpty(baseUrl), "/");
        String safePath = StringUtils.prependIfMissing(StringUtils.trimToEmpty(path), "/");
        return safeBase + safePath;
    }

    private String shellQuote(String value) {
        return "'" + StringUtils.defaultString(value).replace("'", "'\"'\"'") + "'";
    }

    private record OpenApiOperation(String path, String method, JSONObject operation) {
    }

    private static final class ResourceCurlContent {

        private String resourceBizType;

        private String sourceContent;

        private String targetContent;

        String getResourceBizType() {
            return resourceBizType;
        }

        void setResourceBizType(String resourceBizType) {
            this.resourceBizType = resourceBizType;
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
