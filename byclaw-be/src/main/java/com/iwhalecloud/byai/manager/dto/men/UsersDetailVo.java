package com.iwhalecloud.byai.manager.dto.men;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

@Getter
@Setter
public class UsersDetailVo implements Serializable {

    /**
     * 用户标识
     */
    private Long userId;

    /**
     * 用户名
     */
    private String userName;

    /**
     * 用户编码
     */
    private String userCode;

    /**
     * 工号
     */
    private String userNumber;

    /**
     * 邮箱
     */
    private String email;

    /**
     * 电话信息
     */
    private String phone;

    /**
     * 用户角色,ORD_USER:普通用户,ORG_MAN:组织管理,PLAT_MAN:平台管理,PLAT_DEVOPS:平台运维'
     */
    private String userType;

    /**
     * 组织标识
     */
    private Long orgId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 职位标识
     */
    private Long positionId;

    /**
     * 驻地ID
     * 数据库字段：station_id
     */
    private Long stationId;

}
