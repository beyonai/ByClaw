package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * 资源成员信息
 */
@Getter
@Setter
public class ResourceMemberItemVo {

    /**
     * 授权对象类型
     */
    private String grantToObjType;

    /**
     * 授权对象ID
     */
    private Long grantToObjId;

    /**
     * 授权对象名称
     */
    private String grantToObjName;

    /**
     * 授权类型，多个时逗号分隔
     */
    private String grantType;

    /**
     * 红黑名单类型
     */
    private String grantToType;
}
