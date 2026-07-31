package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.dto.resource.CallMcpParamsDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpMapper;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientSseClientTransport;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpClientTransport;
import io.modelcontextprotocol.spec.McpSchema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * MCP扩展服务
 */
@Service
public class SsResExtMcpService {

    private static final Logger logger = LoggerFactory.getLogger(SsResExtMcpService.class);

    private static final Duration MCP_VALIDATION_CONNECT_TIMEOUT = Duration.ofSeconds(3);

    private static final Duration MCP_VALIDATION_REQUEST_TIMEOUT = Duration.ofSeconds(5);

    private static final Set<String> READ_TOOL_KEYWORDS = Set.of("query", "list", "get", "search", "find", "detail",
        "read", "select", "page", "count", "describe", "lookup", "fetch");

    private static final Set<String> WRITE_TOOL_KEYWORDS = Set.of("create", "delete", "update", "save", "remove",
        "insert", "modify", "edit", "publish", "send", "submit", "upload", "download", "import", "export", "sync",
        "bind", "unbind", "grant", "revoke", "approve", "reject");

    @Autowired
    private SsResExtMcpMapper ssResExtMcpMapper;

    public void save(SsResExtMcp ssResExtMcp) {
        ssResExtMcpMapper.insert(ssResExtMcp);
    }

    public void update(SsResExtMcp ssResExtMcp) {
        ssResExtMcpMapper.updateById(ssResExtMcp);
    }

    public void removeById(Long resourceId) {
        ssResExtMcpMapper.deleteById(resourceId);
    }

    public SsResExtMcp findById(Long resourceId) {
        return ssResExtMcpMapper.selectById(resourceId);
    }

    /**
     * 获取mcp工具信息
     *
     * @return ResponseUtil
     */
    public McpSchema.ListToolsResult listTools(ResourceIdDto resourceIdDto) {

        McpClientTransport mcpClientTransport = this.buildMcpClientTransport(resourceIdDto.getResourceId());

        try (McpSyncClient client = McpClient.sync(mcpClientTransport).build();) {

            // 初始化
            client.initialize();

            return client.listTools();
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
        }

    }

    /**
     * 组装mcp资源参数返回
     *
     * @param resourceId 资源标识
     * @return McpClientTransport
     */
    private McpClientTransport buildMcpClientTransport(Long resourceId) {

        SsResExtMcp ssResExtMcp = this.findById(resourceId);

        // 组装参数
        return buildMcpClientTransport(ssResExtMcp.getSourceContent());
    }

    private McpClientTransport buildMcpClientTransport(String sourceContent) {
        JSONObject jsonObject = JSON.parseObject(sourceContent);
        String domainURL = jsonObject.getString("domainURL");
        JSONObject headers = jsonObject.getJSONObject("headers");
        JSONObject safeHeaders = headers == null ? new JSONObject() : headers;

        // MCP 的服务端点在 metaContent.mcpServerUrl 中；写入前校验没有 resourceId，所以直接从原始 JSON 构建 transport。
        JSONObject metaContent = jsonObject.getJSONObject("metaContent");
        if (metaContent == null) {
            throw new IllegalArgumentException(
                I18nUtil.get("resource.json.connectivity.validation.mcp.meta.content.missing"));
        }

        String mcpType = metaContent.getString("mcpType");
        String mcpServerUrl = metaContent.getString("mcpServerUrl");

        if ("sse".equalsIgnoreCase(mcpType)) {
            return HttpClientSseClientTransport.builder(domainURL).connectTimeout(MCP_VALIDATION_CONNECT_TIMEOUT)
                .sseEndpoint(mcpServerUrl).httpRequestCustomizer((builder, method, uri, body, context) -> {
                    Set<Map.Entry<String, Object>> entrySet = safeHeaders.entrySet();
                    for (Map.Entry<String, Object> entry : entrySet) {
                        builder.header(entry.getKey(), String.valueOf(entry.getValue()));
                    }
                }).build();
        }
        else {
            return HttpClientStreamableHttpTransport.builder(domainURL).connectTimeout(MCP_VALIDATION_CONNECT_TIMEOUT)
                .endpoint(mcpServerUrl).openConnectionOnStartup(false).resumableStreams(false)
                .httpRequestCustomizer((builder, method, uri, body, context) -> {
                    Set<Map.Entry<String, Object>> entrySet = headers.entrySet();
                    for (Map.Entry<String, Object> entry : entrySet) {
                        builder.header(entry.getKey(), String.valueOf(entry.getValue()));
                    }
                }).build();
        }
    }

    /**
     * MCP 资源 JSON 写入前连通性校验：listTools 后优先选择读/查类 tool，只真实调用一次。
     */
    public void validateValidationToolBySourceContent(String sourceContent) {
        McpClientTransport mcpClientTransport = this.buildMcpClientTransport(sourceContent);

        try (McpSyncClient client = McpClient.sync(mcpClientTransport)
            .initializationTimeout(MCP_VALIDATION_REQUEST_TIMEOUT).requestTimeout(MCP_VALIDATION_REQUEST_TIMEOUT)
            .build()) {
            // 先 initialize/listTools 验证 MCP 协议链路可用，再只调用一个读/查类优先的 tool 控制耗时和副作用范围。
            client.initialize();
            McpSchema.ListToolsResult listToolsResult = client.listTools();
            if (listToolsResult == null || listToolsResult.tools() == null || listToolsResult.tools().isEmpty()) {
                throw new IllegalArgumentException(
                    I18nUtil.get("resource.json.connectivity.validation.mcp.tools.empty"));
            }

            McpSchema.Tool validationTool = resolveValidationTool(listToolsResult.tools());
            // 根据 inputSchema 生成最小可调用参数，避免校验逻辑依赖页面测试按钮传入的人工参数。
            Map<String, Object> arguments = buildMcpToolArguments(validationTool.inputSchema());
            McpSchema.CallToolResult callToolResult = client
                .callTool(new McpSchema.CallToolRequest(validationTool.name(), arguments));
            if (callToolResult == null) {
                throw new IllegalArgumentException(
                    I18nUtil.get("resource.json.connectivity.validation.mcp.tool.result.empty", validationTool.name()));
            }
            if (Boolean.TRUE.equals(callToolResult.isError())) {
                throw new IllegalArgumentException(
                    I18nUtil.get("resource.json.connectivity.validation.mcp.tool.call.failed", validationTool.name()));
            }
        }
        catch (IllegalArgumentException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalArgumentException(
                I18nUtil.get("resource.json.connectivity.validation.mcp.connectivity.failed", e.getMessage()), e);
        }
    }

    private McpSchema.Tool resolveValidationTool(List<McpSchema.Tool> tools) {
        if (tools == null || tools.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("resource.json.connectivity.validation.mcp.tools.empty"));
        }
        // 优先选择读/查类 tool，依据 tool.name/description 中的动词判断；没有明确读类时再退回第一个，保持兼容。
        return tools.stream().filter(this::isReadOnlyTool).findFirst().orElse(tools.get(0));
    }

    private boolean isReadOnlyTool(McpSchema.Tool tool) {
        if (tool == null) {
            return false;
        }
        String haystack = String.join(" ", String.valueOf(tool.name()), String.valueOf(tool.description()))
            .toLowerCase();
        if (WRITE_TOOL_KEYWORDS.stream().anyMatch(haystack::contains)) {
            return false;
        }
        return READ_TOOL_KEYWORDS.stream().anyMatch(haystack::contains);
    }

    private Map<String, Object> buildMcpToolArguments(McpSchema.JsonSchema inputSchema) {
        Map<String, Object> arguments = new HashMap<>();
        if (inputSchema == null || inputSchema.properties() == null || inputSchema.properties().isEmpty()) {
            return arguments;
        }
        List<String> required = inputSchema.required();
        Set<String> selectedKeys = required == null || required.isEmpty() ? inputSchema.properties().keySet()
            : Set.copyOf(required);
        // 有 required 时只填必填字段；没有 required 时填全部字段，尽量满足工具的最小调用条件。
        for (String key : selectedKeys) {
            Object propertySchema = inputSchema.properties().get(key);
            arguments.put(key, sampleMcpSchemaValue(propertySchema));
        }
        return arguments;
    }

    @SuppressWarnings("unchecked")
    private Object sampleMcpSchemaValue(Object propertySchema) {
        if (!(propertySchema instanceof Map<?, ?> schema)) {
            return "";
        }
        // 取值优先级：example/default/enum，比按 type 造空值更接近工具真实可接受的请求。
        Object example = schema.get("example");
        if (example != null) {
            return example;
        }
        Object defaultValue = schema.get("default");
        if (defaultValue != null) {
            return defaultValue;
        }
        Object enumValue = schema.get("enum");
        if (enumValue instanceof List<?> values && !values.isEmpty()) {
            return values.get(0);
        }
        Object typeValue = schema.get("type");
        String type = typeValue == null ? "string" : String.valueOf(typeValue);
        return switch (type) {
            case "integer", "number" -> 0;
            case "boolean" -> false;
            case "array" -> List.of();
            case "object" -> Map.of();
            default -> "test";
        };
    }

    /**
     * 调用mcp工具
     *
     * @param callMcpParamsDto 调用参数
     * @return CallToolResult
     */
    public McpSchema.CallToolResult callToolRequest(CallMcpParamsDto callMcpParamsDto) {

        McpClientTransport mcpClientTransport = this.buildMcpClientTransport(callMcpParamsDto.getResourceId());

        try (McpSyncClient client = McpClient.sync(mcpClientTransport).build();) {

            // 初始化
            client.initialize();

            String name = callMcpParamsDto.getName();
            Map<String, Object> arguments = callMcpParamsDto.getArguments();

            McpSchema.CallToolRequest callToolRequest = new McpSchema.CallToolRequest(name, arguments);

            return client.callTool(callToolRequest);

        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
        }

    }
}
