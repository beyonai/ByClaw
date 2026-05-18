package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
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
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
/**
 * 资源curl操作业务类
 * @author qin.guoquan
 * @date 2026-05-18 14:12:18
 */
@Service
public class ResourceCurlService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceCurlService.class);

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

    private String buildCurlScript(String method, String url, String requestBody) {
        StringBuilder curl = new StringBuilder();
        curl.append("curl -X ").append(method).append(" ").append(shellQuote(url));
        curl.append(" \\\n  -H ").append(shellQuote("Content-Type: application/json"));
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

    private String normalizeCurlLineContinuation(String curl) {
        return StringUtils.trimToEmpty(curl)
            .replace("\\\r\n", " ")
            .replace("\\\n", " ")
            .replace("\\\r", " ");
    }

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
        } catch (Exception e) {
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

    private static final class ResourceCurlContent {
        private String sourceContent;
        private String targetContent;

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
