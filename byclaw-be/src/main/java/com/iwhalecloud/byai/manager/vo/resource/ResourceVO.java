package com.iwhalecloud.byai.manager.vo.resource;

import lombok.Data;

import java.util.Date;

/**
 * 资源VO
 */
@Data
public class ResourceVO {
    
    /**
     * 资源ID
     */
    private String resourceId;
    
    /**
     * 资源版本ID
     */
    private String resourceVersionId;
    
    /**
     * 资源名称
     */
    private String resourceName;
    
    /**
     * 资源描述
     */
    private String resourceDesc;
    
    /**
     * 资源业务类型
     */
    private String resourceBizType;
    
    /**
     * 资源类型
     */
    private String resourceType;
    
    /**
     * 资源图标
     */
    private String avatar;
    
    /**
     * 常见问题
     */
    private String sample;
    
    /**
     * 服务模式
     */
    private String hostType;
    
    /**
     * 目录ID
     */
    private String catalogId;
    
    /**
     * 管理组织ID
     */
    private String manOrgId;
    
    /**
     * 管理用户ID
     */
    private String manUserId;
    
    /**
     * 创建人
     */
    private String createBy;
    
    /**
     * 创建时间
     */
    private Date createTime;
    
    /**
     * 更新人
     */
    private String updateBy;
    
    /**
     * 更新时间
     */
    private Date updateTime;
    
    /**
     * 状态：0-草稿 1-待上架 2-已上架 3-已下架
     */
    private Integer status;
}
