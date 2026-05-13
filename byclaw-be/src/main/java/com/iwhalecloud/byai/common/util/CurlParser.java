package com.iwhalecloud.byai.common.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.state.domain.resource.dto.ParamField;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * curl 命令解析工具类
 * 将 curl 命令解析为结构化数据，并支持转换为 OpenAPI 3.0 JSON
 */
@Slf4j
public final class CurlParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 标准 HTTP header（自动过滤，不展示给用户）
     */
    private static final Set<String> STANDARD_HEADERS = Set.of(
            "accept", "accept-encoding", "accept-language", "accept-charset",
            "cache-control", "connection", "content-type", "content-length",
            "content-encoding", "cookie", "host", "origin", "referer",
            "user-agent", "pragma", "te", "transfer-encoding",
            "upgrade", "via", "warning", "dnt",
            "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-ch-ua",
            "sec-ch-ua-mobile", "sec-ch-ua-platform",
            "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"
    );

    private CurlParser() {
    }

    /**
     * curl 解析结果
     */
    @Data
    public static class ParsedCurl {
        private String method = "GET";
        private String fullUrl;
        private Map<String, String> headers = new LinkedHashMap<>();
        private String body;
        private String baseUrl;
        private String path;
        private Map<String, String> queryParams = new LinkedHashMap<>();
    }

    // ========================= 解析 =========================

    /**
     * 解析 curl 命令字符串
     */
    public static ParsedCurl parse(String curlCommand) {
        if (curlCommand == null || curlCommand.isBlank()) {
            throw new IllegalArgumentException("curl 命令不能为空");
        }

        String trimmed = curlCommand.trim();
        if (trimmed.toLowerCase().startsWith("curl")) {
            trimmed = trimmed.substring(4).trim();
        }

        List<String> tokens = tokenize(trimmed);
        ParsedCurl result = new ParsedCurl();
        boolean hasExplicitMethod = false;

        for (int i = 0; i < tokens.size(); i++) {
            String token = tokens.get(i);
            switch (token) {
                case "-X":
                case "--request":
                    if (i + 1 < tokens.size()) {
                        result.setMethod(tokens.get(++i).toUpperCase());
                        hasExplicitMethod = true;
                    }
                    break;
                case "-H":
                case "--header":
                    if (i + 1 < tokens.size()) {
                        String header = tokens.get(++i);
                        int colonIdx = header.indexOf(':');
                        if (colonIdx > 0) {
                            String key = header.substring(0, colonIdx).trim();
                            String value = header.substring(colonIdx + 1).trim();
                            result.getHeaders().put(key, value);
                        }
                    }
                    break;
                case "-d":
                case "--data":
                case "--data-raw":
                case "--data-binary":
                    if (i + 1 < tokens.size()) {
                        result.setBody(tokens.get(++i));
                    }
                    break;
                default:
                    if (token.startsWith("-")) {
                        if (token.startsWith("--") && i + 1 < tokens.size()
                                && !tokens.get(i + 1).startsWith("-")) {
                            i++;
                        }
                        break;
                    }
                    if (result.getFullUrl() == null) {
                        result.setFullUrl(token);
                    }
                    break;
            }
        }

        if (!hasExplicitMethod && result.getBody() != null) {
            result.setMethod("POST");
        }

        if (result.getFullUrl() != null) {
            parseUrl(result);
        }

        return result;
    }

    // ========================= ParamField 提取 =========================

    /**
     * 从 JSON body 提取参数列表（ParamField 结构）
     */
    public static List<ParamField> extractBodyParams(String jsonBody) {
        if (jsonBody == null || jsonBody.isBlank()) {
            return Collections.emptyList();
        }
        try {
            JsonNode node = MAPPER.readTree(jsonBody);
            if (node.isObject()) {
                return extractObjectFields(node, true);
            }
            return Collections.emptyList();
        } catch (Exception e) {
            log.warn("解析 body 参数失败: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 从 query 参数 Map 提取参数列表（ParamField 结构）
     */
    public static List<ParamField> extractQueryParams(Map<String, String> queryParams) {
        if (queryParams == null || queryParams.isEmpty()) {
            return Collections.emptyList();
        }
        List<ParamField> fields = new ArrayList<>();
        for (Map.Entry<String, String> entry : queryParams.entrySet()) {
            ParamField field = new ParamField();
            field.setName(entry.getKey());
            field.setType(inferPrimitiveType(entry.getValue()));
            field.setExample(entry.getValue());
            field.setDescription("");
            field.setRequired(false);
            fields.add(field);
        }
        return fields;
    }

    /**
     * 从 headers Map 提取自定义 header 参数列表（过滤标准 HTTP header）
     */
    public static List<ParamField> extractHeaderParams(Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) {
            return Collections.emptyList();
        }
        List<ParamField> fields = new ArrayList<>();
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String key = entry.getKey();
            // 过滤标准 HTTP header
            if (STANDARD_HEADERS.contains(key.toLowerCase())) {
                continue;
            }
            ParamField field = new ParamField();
            field.setName(key);
            field.setType("string");
            field.setExample(entry.getValue());
            field.setDescription("");
            field.setRequired(false);
            fields.add(field);
        }
        return fields;
    }

    // ========================= OpenAPI JSON 生成（带描述） =========================

    /**
     * 根据用户补全描述后的数据，生成带 description 的 OpenAPI 3.0 JSON
     */
    public static String toOpenApiJsonWithDesc(String resourceName, String resourceDesc,
                                               String method, String url,
                                               List<ParamField> bodyParams,
                                               List<ParamField> queryParams,
                                               List<ParamField> pathParams,
                                               List<ParamField> headerParams) {
        try {
            // 从 url 中提取 baseUrl 和 path
            String baseUrl = "";
            String apiPath = url;
            try {
                URI uri = new URI(url);
                baseUrl = uri.getScheme() + "://" + uri.getHost();
                if (uri.getPort() > 0 && uri.getPort() != 80 && uri.getPort() != 443) {
                    baseUrl += ":" + uri.getPort();
                }
                apiPath = uri.getPath();
            } catch (Exception ignored) {
            }

            ObjectNode root = MAPPER.createObjectNode();
            root.put("openapi", "3.0.3");

            // info
            ObjectNode info = MAPPER.createObjectNode();
            info.put("title", resourceName != null ? resourceName : "unnamed-tool");
            info.put("version", "1.0.0");
            if (resourceDesc != null && !resourceDesc.isBlank()) {
                info.put("description", resourceDesc);
            }
            root.set("info", info);

            // servers
            if (!baseUrl.isEmpty()) {
                ArrayNode servers = MAPPER.createArrayNode();
                ObjectNode server = MAPPER.createObjectNode();
                server.put("url", baseUrl);
                servers.add(server);
                root.set("servers", servers);
            }

            // paths
            ObjectNode paths = MAPPER.createObjectNode();
            ObjectNode pathItem = MAPPER.createObjectNode();
            ObjectNode operation = buildOperationWithDesc(resourceName, resourceDesc,
                    method, bodyParams, queryParams, pathParams, headerParams);
            pathItem.set(method.toLowerCase(), operation);
            paths.set(apiPath, pathItem);
            root.set("paths", paths);

            return MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root);
        } catch (Exception e) {
            log.error("生成 OpenAPI JSON 失败", e);
            throw new RuntimeException("生成 OpenAPI JSON 失败: " + e.getMessage(), e);
        }
    }

    /**
     * 将 OpenAPI JSON 包装为带 resource + tool 元信息的完整格式
     *
     * @param resourceName 资源名称
     * @param resourceDesc 资源描述
     * @param toolCode     工具编码
     * @param toolName     工具名称
     * @param toolDesc     工具描述
     * @param openApiJson  纯 OpenAPI 3.0 JSON 字符串
     * @return 包装后的完整 JSON
     */
    public static String wrapOpenApiJson(String resourceName, String resourceDesc,
                                         Long resourceId,
                                         String openApiJson) {
        try {
            String resourceCode = ResourceBizType.TOOL.getCode() + resourceId;
            ObjectNode root = MAPPER.createObjectNode();
            root.put("resourceName", resourceName);
            root.put("resourceBizType", "TOOL");
            root.put("resourceDesc", resourceDesc);
            root.put("resourceSourcePkId", "");
            root.put("resourceCode", resourceCode);

            // tools 数组
            ArrayNode toolsArray = MAPPER.createArrayNode();
            ObjectNode toolItem = MAPPER.createObjectNode();

            // tool 元信息
            ObjectNode toolMeta = MAPPER.createObjectNode();
            toolMeta.put("toolCode", resourceCode);
            toolMeta.put("toolName", resourceName);
            toolMeta.put("toolDesc", resourceDesc);
            toolItem.set("tool", toolMeta);

            // openAPI 内容
            JsonNode openApiNode = MAPPER.readTree(openApiJson);
            toolItem.set("openAPI", openApiNode);

            toolsArray.add(toolItem);
            root.set("tools", toolsArray);

            return MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root);
        } catch (Exception e) {
            log.error("包装 OpenAPI JSON 失败", e);
            throw new RuntimeException("包装 OpenAPI JSON 失败: " + e.getMessage(), e);
        }
    }

    /**
     * 从 ParamField 列表重建 inputSchema（JSON Schema，带 description）
     */
    public static String buildInputSchema(List<ParamField> bodyParams) {
        if (bodyParams == null || bodyParams.isEmpty()) {
            return null;
        }
        try {
            ObjectNode schema = buildObjectSchema(bodyParams);
            return MAPPER.writeValueAsString(schema);
        } catch (Exception e) {
            log.warn("构建 inputSchema 失败", e);
            return null;
        }
    }

    /**
     * 从 ParamField 列表重建 querySchema（JSON Schema，带 description）
     */
    public static String buildQuerySchema(List<ParamField> queryParams) {
        if (queryParams == null || queryParams.isEmpty()) {
            return null;
        }
        try {
            ObjectNode schema = MAPPER.createObjectNode();
            for (ParamField field : queryParams) {
                ObjectNode paramSchema = MAPPER.createObjectNode();
                paramSchema.put("type", field.getType() != null ? field.getType() : "string");
                if (field.getDescription() != null && !field.getDescription().isBlank()) {
                    paramSchema.put("description", field.getDescription());
                }
                schema.set(field.getName(), paramSchema);
            }
            return MAPPER.writeValueAsString(schema);
        } catch (Exception e) {
            log.warn("构建 querySchema 失败", e);
            return null;
        }
    }

    /**
     * 从 ParamField 列表重建 pathSchema（JSON Schema，带 description）
     */
    public static String buildPathSchema(List<ParamField> pathParams) {
        if (pathParams == null || pathParams.isEmpty()) {
            return null;
        }
        return buildQuerySchema(pathParams);
    }

    // ========================= 旧版兼容方法 =========================

    /**
     * 将解析结果转换为 OpenAPI 3.0 JSON 字符串（不含描述，旧版兼容）
     */
    public static String toOpenApiJson(ParsedCurl parsed) {
        try {
            ObjectNode root = MAPPER.createObjectNode();
            root.put("openapi", "3.0.3");

            ObjectNode info = MAPPER.createObjectNode();
            info.put("title", generateToolName(parsed.getPath()));
            info.put("version", "1.0.0");
            info.put("description", "Auto-generated from curl command");
            root.set("info", info);

            if (parsed.getBaseUrl() != null && !parsed.getBaseUrl().isEmpty()) {
                ArrayNode servers = MAPPER.createArrayNode();
                ObjectNode server = MAPPER.createObjectNode();
                server.put("url", parsed.getBaseUrl());
                servers.add(server);
                root.set("servers", servers);
            }

            ObjectNode paths = MAPPER.createObjectNode();
            ObjectNode pathItem = MAPPER.createObjectNode();
            ObjectNode operation = buildOperation(parsed);
            pathItem.set(parsed.getMethod().toLowerCase(), operation);
            paths.set(parsed.getPath() != null ? parsed.getPath() : "/", pathItem);
            root.set("paths", paths);

            return MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root);
        } catch (Exception e) {
            log.error("生成 OpenAPI JSON 失败", e);
            throw new RuntimeException("生成 OpenAPI JSON 失败: " + e.getMessage(), e);
        }
    }

    /**
     * 将 JSON 字符串转换为 JSON Schema
     */
    public static String toJsonSchema(String jsonBody) {
        if (jsonBody == null || jsonBody.isBlank()) {
            return null;
        }
        try {
            JsonNode node = MAPPER.readTree(jsonBody);
            ObjectNode schema = inferSchema(node);
            return MAPPER.writeValueAsString(schema);
        } catch (Exception e) {
            log.warn("JSON body 解析为 Schema 失败: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 将 query 参数转为 JSON Schema 格式字符串
     */
    public static String queryParamsToSchema(Map<String, String> queryParams) {
        if (queryParams == null || queryParams.isEmpty()) {
            return null;
        }
        try {
            ObjectNode schema = MAPPER.createObjectNode();
            for (Map.Entry<String, String> entry : queryParams.entrySet()) {
                ObjectNode paramSchema = MAPPER.createObjectNode();
                paramSchema.put("type", inferPrimitiveType(entry.getValue()));
                schema.set(entry.getKey(), paramSchema);
            }
            return MAPPER.writeValueAsString(schema);
        } catch (Exception e) {
            log.warn("query 参数转 Schema 失败", e);
            return null;
        }
    }

    /**
     * 从 URL path 生成工具名称
     */
    public static String generateToolName(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            return "unnamed-tool";
        }
        String[] segments = path.split("/");
        List<String> meaningful = new ArrayList<>();
        for (String seg : segments) {
            if (!seg.isEmpty() && !"api".equalsIgnoreCase(seg)
                    && !"v1".equalsIgnoreCase(seg) && !"v2".equalsIgnoreCase(seg)
                    && !"v3".equalsIgnoreCase(seg)) {
                meaningful.add(seg);
            }
        }
        if (meaningful.isEmpty()) {
            return "unnamed-tool";
        }
        int start = Math.max(0, meaningful.size() - 2);
        return String.join(" ", meaningful.subList(start, meaningful.size()));
    }

    // ========================= 内部方法 =========================

    /**
     * 从 JSON 对象节点提取字段为 ParamField 列表
     */
    private static List<ParamField> extractObjectFields(JsonNode objectNode, boolean allRequired) {
        List<ParamField> fields = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> it = objectNode.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            ParamField field = new ParamField();
            field.setName(entry.getKey());
            field.setDescription("");
            field.setRequired(allRequired);

            JsonNode value = entry.getValue();
            if (value.isObject()) {
                field.setType("object");
                field.setChildren(extractObjectFields(value, true));
            } else if (value.isArray()) {
                field.setType("array");
                if (value.size() > 0 && value.get(0).isObject()) {
                    field.setChildren(extractObjectFields(value.get(0), true));
                }
            } else if (value.isTextual()) {
                field.setType("string");
                field.setExample(value.asText());
            } else if (value.isInt() || value.isLong()) {
                field.setType("integer");
                field.setExample(value.asText());
            } else if (value.isFloat() || value.isDouble() || value.isBigDecimal()) {
                field.setType("number");
                field.setExample(value.asText());
            } else if (value.isBoolean()) {
                field.setType("boolean");
                field.setExample(value.asText());
            } else {
                field.setType("string");
            }
            fields.add(field);
        }
        return fields;
    }

    /**
     * 构建带描述的 operation 节点
     */
    private static ObjectNode buildOperationWithDesc(String resourceName, String resourceDesc,
                                                     String method,
                                                     List<ParamField> bodyParams,
                                                     List<ParamField> queryParams,
                                                     List<ParamField> pathParams,
                                                     List<ParamField> headerParams) {
        ObjectNode operation = MAPPER.createObjectNode();
        if (resourceName != null) {
            operation.put("summary", resourceName);
        }
        if (resourceDesc != null && !resourceDesc.isBlank()) {
            operation.put("description", resourceDesc);
        }
        operation.put("operationId", resourceName != null ? toCamelCase(resourceName) : "unnamedOperation");

        // path + query + header 参数
        ArrayNode parameters = MAPPER.createArrayNode();
        if (pathParams != null) {
            for (ParamField p : pathParams) {
                parameters.add(buildParamNode(p, "path"));
            }
        }
        if (queryParams != null) {
            for (ParamField p : queryParams) {
                parameters.add(buildParamNode(p, "query"));
            }
        }
        if (headerParams != null) {
            for (ParamField p : headerParams) {
                parameters.add(buildParamNode(p, "header"));
            }
        }
        if (parameters.size() > 0) {
            operation.set("parameters", parameters);
        }

        // 请求体
        if (bodyParams != null && !bodyParams.isEmpty()) {
            ObjectNode requestBody = MAPPER.createObjectNode();
            requestBody.put("required", true);
            ObjectNode content = MAPPER.createObjectNode();
            ObjectNode mediaType = MAPPER.createObjectNode();
            mediaType.set("schema", buildObjectSchema(bodyParams));
            content.set("application/json", mediaType);
            requestBody.set("content", content);
            operation.set("requestBody", requestBody);
        }

        // 响应
        ObjectNode responses = MAPPER.createObjectNode();
        ObjectNode resp200 = MAPPER.createObjectNode();
        resp200.put("description", "Successful response");
        responses.set("200", resp200);
        operation.set("responses", responses);

        return operation;
    }

    /**
     * 构建单个 parameter 节点（query/path）
     */
    private static ObjectNode buildParamNode(ParamField field, String in) {
        ObjectNode param = MAPPER.createObjectNode();
        param.put("name", field.getName());
        param.put("in", in);
        param.put("required", Boolean.TRUE.equals(field.getRequired()));
        if (field.getDescription() != null && !field.getDescription().isBlank()) {
            param.put("description", field.getDescription());
        }
        ObjectNode schema = MAPPER.createObjectNode();
        schema.put("type", field.getType() != null ? field.getType() : "string");
        if (field.getExample() != null && !field.getExample().isEmpty()) {
            schema.put("example", field.getExample());
        }
        param.set("schema", schema);
        return param;
    }

    /**
     * 从 ParamField 列表构建 object 类型的 JSON Schema
     */
    private static ObjectNode buildObjectSchema(List<ParamField> fields) {
        ObjectNode schema = MAPPER.createObjectNode();
        schema.put("type", "object");
        ObjectNode properties = MAPPER.createObjectNode();
        ArrayNode required = MAPPER.createArrayNode();

        for (ParamField field : fields) {
            ObjectNode prop = buildFieldSchema(field);
            properties.set(field.getName(), prop);
            if (Boolean.TRUE.equals(field.getRequired())) {
                required.add(field.getName());
            }
        }

        schema.set("properties", properties);
        if (required.size() > 0) {
            schema.set("required", required);
        }
        return schema;
    }

    /**
     * 从单个 ParamField 构建 JSON Schema 节点
     */
    private static ObjectNode buildFieldSchema(ParamField field) {
        ObjectNode schema = MAPPER.createObjectNode();
        String type = field.getType() != null ? field.getType() : "string";
        schema.put("type", type);

        if (field.getDescription() != null && !field.getDescription().isBlank()) {
            schema.put("description", field.getDescription());
        }

        if ("object".equals(type) && field.getChildren() != null && !field.getChildren().isEmpty()) {
            ObjectNode childProps = MAPPER.createObjectNode();
            ArrayNode childRequired = MAPPER.createArrayNode();
            for (ParamField child : field.getChildren()) {
                childProps.set(child.getName(), buildFieldSchema(child));
                if (Boolean.TRUE.equals(child.getRequired())) {
                    childRequired.add(child.getName());
                }
            }
            schema.set("properties", childProps);
            if (childRequired.size() > 0) {
                schema.set("required", childRequired);
            }
        } else if ("array".equals(type) && field.getChildren() != null && !field.getChildren().isEmpty()) {
            schema.set("items", buildObjectSchema(field.getChildren()));
        }

        return schema;
    }

    /**
     * 分词器：处理单引号、双引号和转义字符
     */
    private static List<String> tokenize(String input) {
        List<String> tokens = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inSingleQuote = false;
        boolean inDoubleQuote = false;
        boolean escape = false;

        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);

            if (escape) {
                if (c == '\n' || c == '\r') {
                    if (c == '\r' && i + 1 < input.length() && input.charAt(i + 1) == '\n') {
                        i++;
                    }
                } else {
                    current.append(c);
                }
                escape = false;
                continue;
            }

            if (c == '\\' && !inSingleQuote) {
                escape = true;
                continue;
            }

            if (c == '\'' && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (c == '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (Character.isWhitespace(c) && !inSingleQuote && !inDoubleQuote) {
                if (current.length() > 0) {
                    tokens.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }

            current.append(c);
        }

        if (current.length() > 0) {
            tokens.add(current.toString());
        }

        return tokens;
    }

    /**
     * 解析 URL 为 baseUrl、path、queryParams
     */
    private static void parseUrl(ParsedCurl result) {
        try {
            String url = result.getFullUrl();
            URI uri = new URI(url);

            String baseUrl = uri.getScheme() + "://" + uri.getHost();
            if (uri.getPort() > 0 && uri.getPort() != 80 && uri.getPort() != 443) {
                baseUrl += ":" + uri.getPort();
            }
            result.setBaseUrl(baseUrl);
            result.setPath(uri.getPath());

            String query = uri.getRawQuery();
            if (query != null && !query.isEmpty()) {
                for (String param : query.split("&")) {
                    String[] kv = param.split("=", 2);
                    String key = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
                    String value = kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "";
                    result.getQueryParams().put(key, value);
                }
            }
        } catch (Exception e) {
            log.warn("URL 解析失败: {}", result.getFullUrl(), e);
            result.setBaseUrl("");
            result.setPath(result.getFullUrl());
        }
    }

    /**
     * 构建 OpenAPI operation 节点（不含描述，旧版兼容）
     */
    private static ObjectNode buildOperation(ParsedCurl parsed) {
        ObjectNode operation = MAPPER.createObjectNode();
        operation.put("summary", generateToolName(parsed.getPath()));
        operation.put("operationId", generateOperationId(parsed.getPath()));

        if (!parsed.getQueryParams().isEmpty()) {
            ArrayNode parameters = MAPPER.createArrayNode();
            for (Map.Entry<String, String> entry : parsed.getQueryParams().entrySet()) {
                ObjectNode param = MAPPER.createObjectNode();
                param.put("name", entry.getKey());
                param.put("in", "query");
                param.put("required", false);
                ObjectNode schema = MAPPER.createObjectNode();
                schema.put("type", inferPrimitiveType(entry.getValue()));
                if (entry.getValue() != null && !entry.getValue().isEmpty()) {
                    schema.put("example", entry.getValue());
                }
                param.set("schema", schema);
                parameters.add(param);
            }
            operation.set("parameters", parameters);
        }

        if (parsed.getBody() != null && !parsed.getBody().isBlank()) {
            ObjectNode requestBody = MAPPER.createObjectNode();
            requestBody.put("required", true);
            ObjectNode content = MAPPER.createObjectNode();
            String contentType = parsed.getHeaders().getOrDefault("Content-Type",
                    parsed.getHeaders().getOrDefault("content-type", "application/json"));
            ObjectNode mediaType = MAPPER.createObjectNode();
            try {
                JsonNode bodyNode = MAPPER.readTree(parsed.getBody());
                mediaType.set("schema", inferSchema(bodyNode));
            } catch (Exception e) {
                ObjectNode schema = MAPPER.createObjectNode();
                schema.put("type", "string");
                mediaType.set("schema", schema);
            }
            content.set(contentType, mediaType);
            requestBody.set("content", content);
            operation.set("requestBody", requestBody);
        }

        ObjectNode responses = MAPPER.createObjectNode();
        ObjectNode resp200 = MAPPER.createObjectNode();
        resp200.put("description", "Successful response");
        responses.set("200", resp200);
        operation.set("responses", responses);

        return operation;
    }

    /**
     * 从 JSON 节点推断 JSON Schema
     */
    private static ObjectNode inferSchema(JsonNode node) {
        ObjectNode schema = MAPPER.createObjectNode();

        if (node.isObject()) {
            schema.put("type", "object");
            ObjectNode properties = MAPPER.createObjectNode();
            ArrayNode required = MAPPER.createArrayNode();
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                properties.set(entry.getKey(), inferSchema(entry.getValue()));
                required.add(entry.getKey());
            }
            schema.set("properties", properties);
            if (required.size() > 0) {
                schema.set("required", required);
            }
        } else if (node.isArray()) {
            schema.put("type", "array");
            if (node.size() > 0) {
                schema.set("items", inferSchema(node.get(0)));
            }
        } else if (node.isTextual()) {
            schema.put("type", "string");
        } else if (node.isInt() || node.isLong()) {
            schema.put("type", "integer");
        } else if (node.isFloat() || node.isDouble() || node.isBigDecimal()) {
            schema.put("type", "number");
        } else if (node.isBoolean()) {
            schema.put("type", "boolean");
        } else {
            schema.put("type", "string");
        }

        return schema;
    }

    /**
     * 推断原始值的类型
     */
    private static String inferPrimitiveType(String value) {
        if (value == null || value.isEmpty()) {
            return "string";
        }
        try {
            Integer.parseInt(value);
            return "integer";
        } catch (NumberFormatException ignored) {
        }
        try {
            Double.parseDouble(value);
            return "number";
        } catch (NumberFormatException ignored) {
        }
        if ("true".equalsIgnoreCase(value) || "false".equalsIgnoreCase(value)) {
            return "boolean";
        }
        return "string";
    }

    /**
     * 从 URL path 生成 operationId
     */
    private static String generateOperationId(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            return "unnamedOperation";
        }
        String[] segments = path.split("/");
        StringBuilder sb = new StringBuilder();
        for (String seg : segments) {
            if (!seg.isEmpty() && !"api".equalsIgnoreCase(seg)) {
                if (sb.length() == 0) {
                    sb.append(seg.toLowerCase());
                } else {
                    sb.append(Character.toUpperCase(seg.charAt(0)));
                    if (seg.length() > 1) {
                        sb.append(seg.substring(1).toLowerCase());
                    }
                }
            }
        }
        return sb.length() > 0 ? sb.toString() : "unnamedOperation";
    }

    /**
     * 将字符串转为 camelCase（用于 operationId）
     */
    private static String toCamelCase(String input) {
        if (input == null || input.isBlank()) {
            return "unnamedOperation";
        }
        String[] parts = input.split("[\\s\\-_/]+");
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (sb.length() == 0) {
                sb.append(part.toLowerCase());
            } else {
                sb.append(Character.toUpperCase(part.charAt(0)));
                if (part.length() > 1) {
                    sb.append(part.substring(1).toLowerCase());
                }
            }
        }
        return sb.length() > 0 ? sb.toString() : "unnamedOperation";
    }
}
