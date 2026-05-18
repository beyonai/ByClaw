package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.dto.resource.CallMcpParamsDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpMapper;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientSseClientTransport;
import io.modelcontextprotocol.spec.McpClientTransport;
import io.modelcontextprotocol.spec.McpSchema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.Map;
import java.util.Set;

/**
 * @author he.duming
 * @date 2026-05-18 17:10:34
 * @description TODO
 */
public class SsResExtMcpService {

    private static final Logger logger = LoggerFactory.getLogger(SsResExtMcpService.class);

    @Autowired
    private SsResExtMcpMapper ssResExtMcpMapper;

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

        SsResExtMcp ssResExtMcp = ssResExtMcpMapper.selectById(resourceId);

        // 组装参数
        String sourceContent = ssResExtMcp.getSourceContent();
        JSONObject jsonObject = JSON.parseObject(sourceContent);
        String domainURL = jsonObject.getString("domainURL");
        JSONObject headers = jsonObject.getJSONObject("headers");

        // 获取扩展信息
        JSONObject metaContent = jsonObject.getJSONObject("metaContent");
        String mcpServerUrl = metaContent.getString("mcpServerUrl");

        return HttpClientSseClientTransport.builder(domainURL).sseEndpoint(mcpServerUrl)
            .httpRequestCustomizer((builder, method, uri, body, context) -> {
                Set<Map.Entry<String, Object>> entrySet = headers.entrySet();
                for (Map.Entry<String, Object> entry : entrySet) {
                    builder.header(entry.getKey(), String.valueOf(entry.getValue()));
                }
            }).build();
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
