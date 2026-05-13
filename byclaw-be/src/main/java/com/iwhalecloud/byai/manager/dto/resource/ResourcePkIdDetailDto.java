package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-10-23 23:33:32
 * @description TODO
 */
@Getter
@Setter
public class ResourcePkIdDetailDto {

    /**
     * 主键
     */
    private Long resourceSourcePkId;

    /**
     * 资源类型:DIG_EMPLOYEE-数字员工,AGENT-智能体，DOC-文档，PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL-
     * 工具，MCP_TOOL:MCP工具,TOOLKIT-插件,KG_DOC-文档知识库，KG_DB-数据知识库，KG_DB-术语知识库
     */
    private String resourceBizType;
}
