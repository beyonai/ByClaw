package com.iwhalecloud.byai.common.feign.request.manager;

import com.alibaba.fastjson.JSONObject;
import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/10
 */
@Data
public class McpServer {

    /**
     * mcp服务id
     */
    private Long mcpResourceId;

    /**
     * 外部资源标识，根据类型不同，标识不同
     */
    private Long mcpResourceSourcePkId;

    /**
     * VIEW---视图，OBJECT---对象， MCP---mcp服务
     */
    private String mcpResourceBizType;

    /**
     * 来源系统编码
     */
    private String systemCode;

    /**
     * mcp服务名称
     */
    private String mcpResourceName;

    /**
     * mcp服务描述
     */
    private String mcpResourceDesc;

    /**
     * 服务地址，当类型为sse、http时有值
     */
    private String url;

    /**
     * 传输类型 stdio---标准类型，sse---sse，类型，http---流式http
     */
    private String transferType;

    /**
     * 请求头，当类型为sse、http时有值
     */
    private String header;

    /**
     * headers
     */
    private JSONObject headers;

    /**
     * 命令:当类型为stdio时有值,例如npx
     */
    private String command;

    /**
     * 参数:当类型为stdio时有值,例如 ["-y", "12306-mcp"]
     */
    private String args;

    /**
     * 环境变量:例如 {"CONFLUENCE_URL": "https://your-company.atlassian.net/wiki",}
     */
    private String env;

    /**
     * 超时时间
     */
    private Integer timeout;

}
