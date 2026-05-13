package com.iwhalecloud.byai.common.feign.request.manager;

import io.swagger.v3.oas.models.OpenAPI;
import lombok.Data;
import lombok.EqualsAndHashCode;

@EqualsAndHashCode(callSuper = true)
@Data
public class OpenAiToolDto extends OpenAPI {

    /**
     * 资源标识
     */
    private Long resourceId;

    /**
     * 上级资源标识，如果是工具上级资源是工具集
     */
    private Long parentResourceId = -1L;

    private String relToolkitId;

    /**
     * 外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    /**
     * 存放智能体平台或BOT的resourceId
     */
    private Long resourceSourcePkId;

    /**
     * 资源类型，AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL- 工具，MCP_TOOL:MCP工具
     */
    private String resourceBizType;

    /**
     * ATOM：原子资源/COMBIN：组合资源
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 是否异步，0：同步，1：异步
     */
    private Integer isAsync;

}
