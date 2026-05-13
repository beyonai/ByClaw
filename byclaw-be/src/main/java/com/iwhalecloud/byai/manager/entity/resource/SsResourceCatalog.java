package com.iwhalecloud.byai.manager.entity.resource;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

/**
 * 资源发布目录表实体类
 */
@Data
@TableName("ss_resource_catalog")
public class SsResourceCatalog implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识
     */
    @TableId
    private Long catalogId;

    /**
     * 资源名称
     */
    private String catalogName;

    /**
     * 资源描述
     */
    private String catalogDesc;

    /**
     * 父目录标识
     */
    private Long pCatalogId;

    /**
     * 目录类型，1-智能体，2-文档库 3-插件 4-数据库，5-MCP服务
     */
    private Integer catalogType;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;

    /**
     * 目录路径，用.隔开，如：1.2.3
     */
    private String catalogPath;

    private Integer orderIndex;

    private Long resourceId;
}
