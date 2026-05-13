package com.iwhalecloud.byai.common.util;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import java.util.List;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * @author he.duming
 * @date 2025-12-09 19:43:42
 * @description OpenAPI 解析工具类（返回 OpenAPI 原生格式） 核心：请求体/响应体直接返回 OpenAPI 原生 Schema 对象，保留完整规范格式
 */
public final class OpenAPIUtil {

    private OpenAPIUtil() {
    }

    /**
     * 解析单个方法的 OpenAPI 对象，返回原生格式的入参和出参
     *
     * @param openAPI OpenAPI 对象
     * @return 包含 apiPath、httpMethod、inputParams、outputParams 的 Map
     */
    public static Map<String, Object> parseSingleMethodNativeParams(OpenAPI openAPI) {

        Objects.requireNonNull(openAPI, "OpenAPI 对象不能为空");

        if (openAPI.getPaths() == null || openAPI.getPaths().isEmpty()) {
            throw new BaseException(I18nUtil.get("openapi.util.no.path"));
        }
        if (openAPI.getPaths().size() != 1) {
            throw new BaseException(I18nUtil.get("openapi.util.multiple.paths.not.single.method"));
        }

        String apiPath = openAPI.getPaths().keySet().iterator().next();
        PathItem pathItem = openAPI.getPaths().get(apiPath);
        Map<PathItem.HttpMethod, Operation> operationMap = pathItem.readOperationsMap();

        if (operationMap.size() != 1) {
            throw new BaseException(I18nUtil.get("openapi.util.path.multiple.http.methods.not.single.method"));
        }

        Operation operation = operationMap.values().iterator().next();
        PathItem.HttpMethod httpMethod = operationMap.keySet().iterator().next();

        Schema<?> requestBodySchema = getRequestBodyNativeSchema(operation);
        Schema<?> responseBodySchema = getResponseBodyNativeSchema(operation);
        Map<String, Schema<?>> querySchema = getParametersSchema(operation, "query");
        Map<String, Schema<?>> pathSchema = getParametersSchema(operation, "path");

        String url = buildRequestUrl(openAPI, apiPath);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("url", url);
        result.put("method", httpMethod.name());
        result.put("inputSchema", requestBodySchema);
        result.put("outputSchema", responseBodySchema);
        result.put("querySchema", querySchema);
        result.put("pathSchema", pathSchema);
        return result;
    }

    /**
     * 提取请求体的原生 Schema 对象
     *
     * @param operation Operation 对象
     * @return Schema 对象，无请求体时返回 null
     */
    private static Schema<?> getRequestBodyNativeSchema(Operation operation) {
        if (operation == null || operation.getRequestBody() == null) {
            return null;
        }

        RequestBody requestBody = operation.getRequestBody();
        Content content = requestBody.getContent();
        if (content == null) {
            return null;
        }

        MediaType jsonMediaType = getJsonMediaType(content);
        return jsonMediaType != null ? jsonMediaType.getSchema() : null;
    }

    /**
     * 提取响应体的原生 Schema 对象
     *
     * @param operation Operation 对象
     * @return Schema 对象，无响应体时返回 null
     */
    private static Schema<?> getResponseBodyNativeSchema(Operation operation) {
        ApiResponse response = getApiResponse(operation);
        if (response == null) {
            return null;
        }

        Content content = response.getContent();
        if (content == null) {
            return null;
        }

        MediaType jsonMediaType = getJsonMediaType(content);
        return jsonMediaType != null ? jsonMediaType.getSchema() : null;
    }

    /**
     * 从Operation中获取ApiResponse对象 优先返回200状态码的响应，否则返回第一个响应
     *
     * @param operation Operation 对象
     * @return ApiResponse 对象，无响应时返回 null
     */
    private static ApiResponse getApiResponse(Operation operation) {
        if (operation == null || operation.getResponses() == null) {
            return null;
        }

        ApiResponses responses = operation.getResponses();
        if (responses == null || responses.isEmpty()) {
            return null;
        }

        ApiResponse response = responses.get("200");
        if (response == null) {
            response = responses.values().iterator().next();
        }

        return response;
    }

    /**
     * 从Content中获取JSON格式的MediaType 优先查找"application/json"，否则查找包含"application/json"的媒体类型
     *
     * @param content Content 对象
     * @return MediaType 对象，无JSON媒体类型时返回 null
     */
    private static MediaType getJsonMediaType(Content content) {
        if (content == null) {
            return null;
        }

        Map<String, MediaType> mediaTypeMap = content;
        if (mediaTypeMap == null || mediaTypeMap.isEmpty()) {
            return null;
        }

        MediaType jsonMediaType = mediaTypeMap.get("application/json");
        if (jsonMediaType != null) {
            return jsonMediaType;
        }

        return mediaTypeMap.entrySet().stream()
            .filter(entry -> entry.getKey().toLowerCase().contains("application/json")).findFirst()
            .map(Map.Entry::getValue).orElse(null);
    }

    /**
     * 提取指定类型的参数 Schema
     *
     * @param operation Operation 对象
     * @param paramType 参数类型（"query" 或 "path"）
     * @return 参数 Schema Map，Key 为参数名，Value 为参数 Schema
     */
    private static Map<String, Schema<?>> getParametersSchema(Operation operation, String paramType) {
        if (operation == null || operation.getParameters() == null) {
            return Collections.emptyMap();
        }

        List<Parameter> parameters = operation.getParameters();
        Map<String, Schema<?>> schemaMap = new LinkedHashMap<>();

        for (Parameter parameter : parameters) {
            if (parameter != null && paramType.equals(parameter.getIn()) && parameter.getSchema() != null) {
                schemaMap.put(parameter.getName(), parameter.getSchema());
            }
        }

        return schemaMap;
    }

    /**
     * 构建完整的请求 URL
     *
     * @param openAPI OpenAPI 对象
     * @param apiPath API 路径
     * @return 完整的请求 URL
     */
    private static String buildRequestUrl(OpenAPI openAPI, String apiPath) {
        String baseUrl = "";
        if (openAPI.getServers() != null && !openAPI.getServers().isEmpty()) {
            io.swagger.v3.oas.models.servers.Server server = openAPI.getServers().get(0);
            if (server != null && server.getUrl() != null) {
                baseUrl = server.getUrl();
            }
        }

        if (baseUrl.isEmpty()) {
            return apiPath;
        }

        baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        String path = apiPath.startsWith("/") ? apiPath : "/" + apiPath;
        return baseUrl + path;
    }

}