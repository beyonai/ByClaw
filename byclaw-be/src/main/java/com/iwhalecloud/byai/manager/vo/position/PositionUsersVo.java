package com.iwhalecloud.byai.manager.vo.position;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-24 22:31:57
 * @description TODO
 */
@Getter
@Setter
public class PositionUsersVo {

    /***
     * 岗位标识
     */
    private Long positionId;

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
     * 电话号码
     */
    private String phone;

    /**
     * 工号
     */
    private String userNumber;

    /**
     * 对应组织层级路径
     */
    private String orgIds;

    /**
     * 用户角色
     */
    private String userTypes;

    /**
     * 部门组织名称路径:浩鲸-大数据平台
     */
    private String pathName;

}
