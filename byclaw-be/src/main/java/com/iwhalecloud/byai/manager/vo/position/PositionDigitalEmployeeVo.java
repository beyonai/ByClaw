package com.iwhalecloud.byai.manager.vo.position;

import lombok.Getter;
import lombok.Setter;

/**
 * 岗位数字员工VO
 * 包含数字员工基本信息和岗位关联信息
 */
@Getter
@Setter
public class PositionDigitalEmployeeVo {

    /**
     * 数字资源标识
     */
    private Long resourceId;

    /**
     * 外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    /**
     * 资源类型:DIG_EMPLOYEE-数字员工,AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL-
     * 工具，MCP_TOOL:MCP工具,TOOLKIT-插件,KG_DOC-文档知识库,KG_DB-数据知识库,KG_DB-术语知识库
     */
    private String resourceBizType;

    /**
     * ATOM：原子资源,COMBIN：组合资源
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源图标：前端提供的枚举值
     */
    private String avatar;

    /**
     * 常见问题
     */
    private String sample;

    /**
     * 标签:用于关键字检索匹配
     */
    private String tags;


    /**
     * 数字岗位ID
     */
    private Long positionId;

    /**
     * 状态：0-待上岗，1-已上岗，2-已下岗
     */
    private Integer status;
    
    /**
     * 审批人
     */
    private String approver;
    
    /**
     * 上岗时间
     */
    private String onJobTime;

    /**
     * 发布时间
     */
    private String publishTime;

}