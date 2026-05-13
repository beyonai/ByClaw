package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-25 10:15:16
 * @description TODO
 */
@Getter
@Setter
public class DigitalEmployeeAuthVo {

    private String objId;

    /**
     * 资源id字符?
     */
    private String resourceIdStr;

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    private Long createBy;

    /**
     * 智能?
     */
    private String name;

    /***
     * 信息
     */
    private String intro;

    /**
     * 是否有权?
     */
    private boolean hasPermission;

    /**
     * 授权来源
     */
    private List<GrantSourceVo> grantSourceVos;

    /**
     * 创建时间
     */
    private String createTime;

    /**
     * 状态：0-草稿 1-发布 2-上架 3-下架
     */
    private Integer status;

    /**
     * 资源类型 1-智能?2-文档?3-插件 4-数据
     */
    private Integer resourceType;

    /**
     * 资源类型，AGENT-智能体，DOC-文档?PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL- 工具，MCP_TOOL:MCP工具
     */
    private String resourceBizType;

    /**
     * 资源状态 status=0草稿 status=1待上架 status=2已上架 status=3已下架
     */
    private Integer resourceStatus;

    /**
     * 上架目录
     */
    private String catalogName;

    /**
     * 标签
     */
    private String tags;

    /**
     * 归属组织
     */
    private Long manOrgId;

    /**
     * 归属组织名称
     */
    private String manOrgName;

    /**
     * 资源上架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date shelfTime;

    /**
     * 资源下架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date unshelfTime;

    /**
     * 资源发布时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date publishTime;

    private long redCount;

    private long blackCount;

    private long forceUseCount;

    private long availableUseCount;

    private long allowManageCount;

}
