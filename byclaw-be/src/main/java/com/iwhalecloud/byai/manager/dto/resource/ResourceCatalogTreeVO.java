package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * 资源目录关联树查询结果VO
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ResourceCatalogTreeVO implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 目录名称
     */
    private String catalogName;

    /**
     * 目录ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 资源类型（资源业务类型：AGENT-智能体，DOC-文档库等）
     */
    private String resourceBizType;

    /**
     * 资源类型（ATOM：原子资源/COMBIN：组合资源）
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 父目录ID
     */
    @JsonProperty("pCatalogId")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long pCatalogId;

    /**
     * 目录类型（6-领域活动对象，7-核心业务对象）
     */
    private Integer catalogType;

    /**
     * 目录路径
     */
    private String catalogPath;

    /**
     * 排序索引
     */
    private Integer orderIndex;

    /**
     * 关联的资源目录ID（ss_resource表的catalog_id）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relCatalogId;

    /**
     * 关联的资源ID（ss_resource表的resource_id）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relResourceId;

    /**
     * 资源创建时间（ss_resource表的create_time）
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 子节点列表（用于树形结构）
     */
    private List<ResourceCatalogTreeVO> children;
}

