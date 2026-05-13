package com.iwhalecloud.byai.manager.qo.position;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-24 22:24:46
 * @description 查询岗位下面的用户信息
 */
@Getter
@Setter
public class PositionUsersQo extends QueryObject {

    /**
     * 用户角色
     */
    private String userType;

    /**
     * 岗位标识
     */
    private Long positionId;

    /**
     * 员工姓名，手机号，工号信息查询
     */
    private String keyword;

}
