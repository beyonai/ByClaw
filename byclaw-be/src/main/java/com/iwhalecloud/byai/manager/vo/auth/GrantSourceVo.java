package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-27 09:45:31
 * @description TODO
 */
@Getter
@Setter
public class GrantSourceVo {

    /***
     * 权限授予对象类型标识
     */
    private Long grantToObjId;

    /***
     * 权限授予对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /***
     * 权限授予对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjName;

    /**
     * 红名单或是黑名单
     */
    private String color;

}
