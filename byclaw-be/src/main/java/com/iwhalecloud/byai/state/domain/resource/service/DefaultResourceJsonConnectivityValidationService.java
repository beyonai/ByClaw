package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonConnectivityValidationService;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationContext;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 资源 JSON 写入开放目录前的轻量连通性校验。
 * @author qin.guoquan
 * @date 2026-05-23 14:12:18
 */
@Service
public class DefaultResourceJsonConnectivityValidationService implements ResourceJsonConnectivityValidationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(DefaultResourceJsonConnectivityValidationService.class);

    private static final Set<String> CREATE_KNOWLEDGE_KEYWORDS = Set.of("knowledge-bases/create", "create_kb");

    private static final Set<String> DELETE_KNOWLEDGE_KEYWORDS = Set.of("knowledge-bases/delete", "delete_kb");

    private final ResourceCurlService resourceCurlService;

    private final SsResExtMcpService ssResExtMcpService;

    /**
     * 是否开启校验（资源文件写入minio前的终极校验）
     * true：默认校验
     * false: 不校验
     */
    @Value("${resource.json.connectivity-validation.enabled:true}")
    private boolean enabled;

    /**
     * true: 校验失败，不写入minio
     * false：校验失败只打 warn，仍继续写入minio
     */
    @Value("${resource.json.connectivity-validation.fail-fast:true}")
    private boolean failFast;

    public DefaultResourceJsonConnectivityValidationService(ResourceCurlService resourceCurlService,
        SsResExtMcpService ssResExtMcpService) {
        this.resourceCurlService = resourceCurlService;
        this.ssResExtMcpService = ssResExtMcpService;
    }

    @Override
    public void validate(ResourceJsonValidationContext context) {
        if (!enabled || context == null || context.resourceJsonPath() == null) {
            return;
        }

        String resourceBizType = StringUtils.trimToEmpty(context.resourceJsonPath().resourceBizType());
        try {
            // 这里按资源类型执行“轻量强校验”：
            // 知识库只做创建/删除闭环，工具集与 MCP 只测一个读/查类优先的可调用项，避免写入链路被全量接口测试拖慢。

            /**
             * KG_*:
             *   解析所有 resourceService[*].openapiSchema
             *   真实调用只做 create_kb
             *   create 成功后 finally 里调用 delete_kb 清理
             *   不再调用查询知识库
             */
            if (StringUtils.startsWithIgnoreCase(resourceBizType, "KG_")) {
                validateKnowledgeCreateThenDelete(context);
                return;
            }

            /**
             * 解析 tools/openAPI
             *   优先选择 GET 或 query/list/get/search 等读/查语义接口
             *   避开 create/delete/update/send 等明显写入或消息发送语义接口
             *   找不到读/查语义时，为兼容老数据才退回第一个可用 path/method
             */
            if (StringUtils.equalsIgnoreCase(ResourceBizType.TOOLKIT.getCode(), resourceBizType)) {
                assertCurlSuccess(I18nUtil.get("resource.json.connectivity.validation.toolkit.interface"),
                    resourceCurlService.runValidationToolkitTool(context.json()));
                return;
            }

            /**
             * initialize
             *   listTools
             *   优先选择 query/list/get/search 等读/查语义 tool
             *   找不到读/查语义时，为兼容老 MCP 才退回 listTools 返回的第一个 tool
             *   根据 schema 生成最小 arguments
             *   callTool 一次
             */
            if (StringUtils.equalsIgnoreCase(ResourceBizType.MCP.getCode(), resourceBizType)) {
                ssResExtMcpService.validateValidationToolBySourceContent(context.json());
                return;
            }

            /**
             * 只调用一次 Agent 自己的测试请求
             *   不递归校验关联工具、知识库、MCP
             */
            if (StringUtils.equalsIgnoreCase(ResourceBizType.AGENT.getCode(), resourceBizType)) {
                assertCurlSuccess(I18nUtil.get("resource.json.connectivity.validation.agent.interface"),
                    resourceCurlService.runAgentHealth(context.json()));
            }
        }
        catch (IllegalArgumentException e) {
            handleValidationFailure(context, e);
        }
        catch (Exception e) {
            handleValidationFailure(context,
                new IllegalArgumentException(I18nUtil.get("resource.json.connectivity.validation.failed.path",
                    context.resourceJsonPath().targetPath()), e));
        }
    }

    private void handleValidationFailure(ResourceJsonValidationContext context, IllegalArgumentException e) {
        String failureMessage = formatValidationFailureMessage(e);
        if (failFast) {
            throw new IllegalArgumentException(failureMessage, e);
        }
        // 非 fail-fast 模式只记录告警，不阻断资源 JSON 写入，便于生产环境对外部服务抖动做容错。
        LOGGER.warn("{}: path={}, reason={}",
            I18nUtil.get("resource.json.connectivity.validation.failed.allowed"),
            context.resourceJsonPath().targetPath(), failureMessage, e);
    }

    private String formatValidationFailureMessage(IllegalArgumentException e) {
        String message = e == null ? null : e.getMessage();
        message = StringUtils.defaultIfBlank(message, I18nUtil.get("resource.json.connectivity.validation.unknown"));
        String prefix = I18nUtil.get("resource.json.connectivity.validation.prefix");
        if (StringUtils.startsWith(message, prefix)) {
            return message;
        }
        return prefix + message;
    }

    private void validateKnowledgeCreateThenDelete(ResourceJsonValidationContext context) {
        JSONObject root = JSON.parseObject(context.json(), Feature.OrderedField);
        // 先遍历校验所有 openapiSchema 的基本结构，防止 JSON 虽然能连通但接口描述不可被下游解析。
        validateKnowledgeOpenApiSchemas(root);

        KnowledgeOperation createOperation = findKnowledgeOperation(root, "create_kb", CREATE_KNOWLEDGE_KEYWORDS);
        KnowledgeOperation deleteOperation = findKnowledgeOperation(root, "delete_kb", DELETE_KNOWLEDGE_KEYWORDS);
        String testKnowledgeCode = "VALIDATE_" + context.resourceJsonPath().resourceId() + "_"
            + System.currentTimeMillis();
        // create/delete 必须共享同一个临时知识库标识，确保 finally 删除的是本次校验刚创建的那一个。
        Map<String, Object> validationIdentity = buildKnowledgeValidationBody(testKnowledgeCode);
        boolean created = false;
        try {
            // 真实调用只验证创建接口；创建成功后标记 created，确保 finally 里能做资源清理。
            assertCurlSuccess(I18nUtil.get("resource.json.connectivity.validation.knowledge.create.interface"),
                runKnowledgeOperation(context.json(), root, createOperation, validationIdentity));
            created = true;
        }
        finally {
            if (created) {
                // 删除不作为独立前置调用，只用于清理本次创建出来的临时知识库，避免测试数据残留。
                assertCurlSuccess(I18nUtil.get("resource.json.connectivity.validation.knowledge.delete.interface"),
                    runKnowledgeOperation(context.json(), root, deleteOperation, validationIdentity));
            }
        }
    }

    private void validateKnowledgeOpenApiSchemas(JSONObject root) {
        JSONArray resourceService = root == null ? null : root.getJSONArray("resourceService");
        if (resourceService == null || resourceService.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get(
                "resource.json.connectivity.validation.knowledge.resource.service.missing"));
        }
        for (int i = 0; i < resourceService.size(); i++) {
            JSONObject service = resourceService.getJSONObject(i);
            JSONObject openApi = service == null ? null : service.getJSONObject("openapiSchema");
            if (openApi == null) {
                // 兼容老格式 resourceService：只有 method/path/action 时，后续仍可走普通 JSON 请求校验。
                continue;
            }
            JSONObject paths = openApi.getJSONObject("paths");
            if (paths == null || paths.isEmpty()) {
                throw new IllegalArgumentException(I18nUtil.get(
                    "resource.json.connectivity.validation.knowledge.openapi.paths.missing", i));
            }
        }
    }

    private KnowledgeOperation findKnowledgeOperation(JSONObject root, String operationId, Set<String> keywords) {
        JSONArray resourceService = root == null ? null : root.getJSONArray("resourceService");
        if (resourceService == null || resourceService.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get(
                "resource.json.connectivity.validation.knowledge.resource.service.missing"));
        }
        for (int i = 0; i < resourceService.size(); i++) {
            JSONObject service = resourceService.getJSONObject(i);
            if (service == null) {
                continue;
            }
            JSONObject openApi = service.getJSONObject("openapiSchema");
            if (openApi != null && openApiContainsOperation(openApi, operationId, keywords)) {
                // 部分导入 JSON 的 openapiSchema 没有 servers.url，这里回填根节点 domainURL 供 curl 生成使用。
                fillOpenApiBaseUrl(openApi, root);
                return new KnowledgeOperation(openApi, null, null, operationId, keywords);
            }
            if (matchesSimpleKnowledgeService(service, operationId, keywords)) {
                // 老格式知识库接口没有 OpenAPI，只能用根 domainURL + service.path 组装请求。
                return new KnowledgeOperation(null, service.getString("method"), service.getString("path"), operationId,
                    keywords);
            }
        }
        throw new IllegalArgumentException(I18nUtil.get(
            "resource.json.connectivity.validation.knowledge.operation.notfound", operationId));
    }

    private boolean openApiContainsOperation(JSONObject openApi, String operationId, Set<String> keywords) {
        JSONObject paths = openApi == null ? null : openApi.getJSONObject("paths");
        if (paths == null || paths.isEmpty()) {
            return false;
        }
        for (String path : paths.keySet()) {
            JSONObject pathItem = paths.getJSONObject(path);
            if (pathItem == null) {
                continue;
            }
            for (String method : Set.of("get", "post", "put", "patch", "delete")) {
                if (!pathItem.containsKey(method)) {
                    continue;
                }
                JSONObject operation = pathItem.getJSONObject(method);
                String currentOperationId = operation == null ? null : operation.getString("operationId");
                if (StringUtils.equalsIgnoreCase(operationId, currentOperationId)
                    || containsKeyword(path, currentOperationId, keywords)) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean matchesSimpleKnowledgeService(JSONObject service, String operationId, Set<String> keywords) {
        String action = service.getString("action");
        String path = service.getString("path");
        return StringUtils.equalsIgnoreCase(operationId, action) || containsKeyword(path, action, keywords);
    }

    private boolean containsKeyword(String path, String operationId, Set<String> keywords) {
        if (keywords == null || keywords.isEmpty()) {
            return false;
        }
        String haystack = StringUtils.lowerCase(StringUtils.defaultString(path) + " "
            + StringUtils.defaultString(operationId));
        return keywords.stream().map(StringUtils::lowerCase).anyMatch(haystack::contains);
    }

    private void fillOpenApiBaseUrl(JSONObject openApi, JSONObject root) {
        if (StringUtils.isNotBlank(resolveOpenApiBaseUrl(openApi))) {
            return;
        }
        String domainUrl = root == null ? null : root.getString("domainURL");
        if (StringUtils.isNotBlank(domainUrl)) {
            openApi.put("domainURL", domainUrl);
        }
    }

    private String resolveOpenApiBaseUrl(JSONObject openApi) {
        JSONArray servers = openApi == null ? null : openApi.getJSONArray("servers");
        if (servers != null && !servers.isEmpty()) {
            JSONObject server = servers.getJSONObject(0);
            String url = server == null ? null : server.getString("url");
            if (StringUtils.isNotBlank(url)) {
                return url;
            }
        }
        return openApi == null ? null : StringUtils.defaultIfBlank(openApi.getString("domainURL"),
            openApi.getString("domainUrl"));
    }

    private ResourceCurlRunResult runKnowledgeOperation(String sourceContent, JSONObject root,
        KnowledgeOperation operation, Map<String, Object> body) {

        Map<String, Object> headers = jsonObjectToMap(root.getJSONObject("headers"));
        if (operation.openApi() != null) {
            return resourceCurlService.runOpenApiOperation(root.getString("resourceBizType"), sourceContent,
                operation.openApi(), operation.operationId(), operation.keywords(), body, headers);
        }

        String domainUrl = root.getString("domainURL");
        if (StringUtils.isBlank(domainUrl)) {
            throw new IllegalArgumentException(I18nUtil.get(
                "resource.json.connectivity.validation.knowledge.domain.url.missing"));
        }
        String method = StringUtils.defaultIfBlank(operation.method(), "POST");
        String url = StringUtils.removeEnd(domainUrl, "/") + "/"
            + StringUtils.removeStart(StringUtils.trimToEmpty(operation.path()), "/");
        return resourceCurlService.runSimpleJsonOperation(root.getString("resourceBizType"), sourceContent, method, url,
            body, headers);
    }

    private Map<String, Object> buildKnowledgeValidationBody(String knowledgeCode) {
        Map<String, Object> body = new LinkedHashMap<>();
        // 不同知识库服务对“知识库编码/名称”的字段命名不完全一致，因此一次性提供常见别名。
        // ResourceCurlService 合并请求体时只会覆盖 schema 中已有字段；老格式请求才会完整发送这些字段。
        body.put("knCode", knowledgeCode);
        body.put("kbCode", knowledgeCode);
        body.put("knowledgeCode", knowledgeCode);
        body.put("knowledgeBaseCode", knowledgeCode);
        body.put("resourceCode", knowledgeCode);
        body.put("name", "validation-knowledge");
        body.put("knName", "validation-knowledge");
        body.put("kbName", "validation-knowledge");
        body.put("knowledgeName", "validation-knowledge");
        body.put("knowledgeBaseName", "validation-knowledge");
        body.put("resourceName", "validation-knowledge");
        body.put("description", "resource json connectivity validation");
        body.put("resourceDesc", "resource json connectivity validation");
        return body;
    }

    private Map<String, Object> jsonObjectToMap(JSONObject object) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (object == null || object.isEmpty()) {
            return map;
        }
        object.forEach(map::put);
        return map;
    }

    private void assertCurlSuccess(String name, ResourceCurlRunResult result) {
        if (result != null && Boolean.TRUE.equals(result.getSuccess())) {
            return;
        }
        String detail = result == null
            ? I18nUtil.get("resource.json.connectivity.validation.result.empty")
            : StringUtils.defaultIfBlank(result.getErrorMessage(),
                I18nUtil.get("resource.json.connectivity.validation.http.status", result.getStatusCode()));
        throw new IllegalArgumentException(I18nUtil.get("resource.json.connectivity.validation.interface.failed",
            name, detail));
    }

    private record KnowledgeOperation(JSONObject openApi, String method, String path, String operationId,
                                      Set<String> keywords) {
    }
}
