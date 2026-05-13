package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-04-25 10:16:29
 * @description TODO
 */
@Getter
@Setter
public class ResourceAuthVo extends AuthVo {

    /**
     * 资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 外部系统资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

    /**
     * 系统编码
     */
    private String systemCode;

    /**
     * 资源业务类型
     */
    private String resourceBizType;

    /**
     * 资源类型
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
     * 资源图标
     */
    private String avatar;

    /**
     * 常见问题
     */
    private String sample;

    /**
     * 标签
     */
    private String tags;

    /**
     * 引用资源版本
     */
    private String resourceVersionId;

    /**
     * 服务模式
     */
    private String hostType;

    /**
     * 所属目录ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 归属目录名称
     */
    private String catalogName;

    /**
     * 归属组织
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long manOrgId;

    /**
     * 授权管理员
     */
    private String manUserId;

    /**
     * 归属组织名称
     */
    private String manOrgName;

    /**
     * 索引清单
     */
    private String indexList;

    /**
     * 创建人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    private String createUserName;

    /**
     * 是否有权限
     */
    private boolean hasPermission;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    /**
     * 所属企业
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long comAcctId;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 草稿版本号
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceDVerid;

    /**
     * 正式版本号
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceRVerid;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 发布时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date publishTime;

    /**
     * 上架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date shelfTime;

    /**
     * 下架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date unshelfTime;

    /**
     * 授权状态
     */
    private String authStatus;

    /**
     * 是否发布到业务门户
     */
    private Integer publishPortal;

    /**
     * 父级资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long parentResourceId;

    /**
     * 资源发布类型
     */
    private String publishType;

    /**
     * 资源归属类型
     */
    private String ownerType;

    /**
     * 是否可编辑资源信息
     */
    private Boolean canEdit;

    /**
     * 是否可维护管理授权
     */
    private Boolean canManageAuth;

    /**
     * 是否可维护使用授权
     */
    private Boolean canUseAuth;

    /**
     * 是否可注销资源
     */
    private Boolean canDelete;

    /**
     * 是否可发起使用申请
     */
    private Boolean canApplyUse;

    /**
     * 是否可审核使用申请
     */
    private Boolean canAuditUse;

}
