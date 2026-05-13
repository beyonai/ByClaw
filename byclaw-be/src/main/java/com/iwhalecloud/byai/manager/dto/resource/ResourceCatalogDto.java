package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.util.Date;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ResourceCatalogDto {

    /**
     * 资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    private String resourceCode;

    /**
     * 存放智能体平台或BOT的resourceId
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

    /**
     * 资源类型，AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL- 工具，MCP_TOOL:MCP工具
     */
    private String resourceBizType;

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
     * 资源图标：前端提供的枚举值
     */
    private String avatar;

    /**
     * 标签:用于关键字检索匹配
     */
    private String tags;

    /**
     * 所属目录ID
     */
    private Long catalogId;

    /**
     * 目录名称
     */
    private String catalogName;

    /**
     * 归属组织
     */
    private Long manOrgId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 上架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date shelfTime;

    /**
     * 发布时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date publishTime;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    private Integer orderIndex;

}
