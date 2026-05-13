package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;

/**
 * MCP服务扩展表实体类
 */
@Data
@TableName("ss_res_ext_mcpserver")
public class SsResExtMcpServer implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 服务地址，当类型为sse、http时有值
     */
    private String mcpServerUrl;

    /**
     * 传输类型
     * stdio---标准类型，sse---sse，类型，streamable_http---流式http
     */
    private String mcpTransferType;

    /**
     * 请求头，当类型为sse、http时有值
     */
    private String mcpHeader;

    /**
     * 命令:当类型为stdio时有值,例如npx
     */
    private String mcpCommand;

    /**
     * 参数:当类型为stdio时有值,例如 ["-y", "12306-mcp"]
     */
    private String mcpArgs;

    /**
     * 环境变量:例如 {"CONFLUENCE_URL": "https://your-company.atlassian.net/wiki",}
     */
    private String mcpEnv;

    /**
     * 超时时间
     */
    private Integer mcpTimeout;

    /**
     * 服务原始地址
     */
    private String mcpServerUrlOri;
}

