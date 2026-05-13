package com.iwhalecloud.byai.manager.vo.users;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.List;

/**
 * 用户关联组织查询
 */
@Getter
@Setter
public class UsersOrgVo implements Serializable {

    /**
     * 用户标识
     */
    private Long userId;

    /**
     * 用户编码
     */
    private String userCode;

    /**
     * 用户名称
     */
    private String userName;

    /**
     * 电话信息
     */
    private String phone;

    /**
     * 组织标识
     */
    private Long orgId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 职位名称
     */
    private String positionName;

    /**
     * 
     */
    private String userNumber;

    /**
     * 用户角色,ORD_USER:普通用户,ORG_MAN:组织管理,PLAT_MAN:平台管理,PLAT_DEVOPS:平台运维,DEV_USER:技术开发
     */
    private String userType;

    /**
     * 用户角色,ORD_USER:普通用户,ORG_MAN:组织管理,PLAT_MAN:平台管理,PLAT_DEVOPS:平台运维,DEV_USER:技术开发
     */
    private List<String> userTypes;

    /**
     * 岗位ID
     */
    private Long positionId;

    /**
     * 驻地ID
     */
    private Long stationId;

    /**
     * 超级助手ID
     */
    private Long superassistId;
}
