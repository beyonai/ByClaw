package com.iwhalecloud.byai.manager.qo.permissiongroup;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 权限组查询对象
 */
@Getter
@Setter
public class PermissionGroupQueryQO {

    /**
     * 权限组名称（模糊查询）
     */
    private String groupName;

    /**
     * 权限组编码（模糊查询）
     */
    private String groupCode;

    /**
     * 创建人（模糊查询）
     */
    private Long createBy;

    /**
     * 创建人姓名（模糊查询）
     */
    private String createByName;

    /**
     * 创建开始时间
     */
    private Date createTimeStart;

    /**
     * 创建结束时间
     */
    private Date createTimeEnd;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 所属组织ID
     */
    private Long orgId;

    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}

