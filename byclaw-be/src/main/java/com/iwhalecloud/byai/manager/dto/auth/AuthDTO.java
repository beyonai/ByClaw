package com.iwhalecloud.byai.manager.dto.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-25 15:04:15
 * @description TODO
 */

@Getter
@Setter
public class AuthDTO {

    /**
     * 授权对象
     */
    private Long grantToObjId;

    /**
     * 对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /**
     * 授权对象名称
     */
    private String grantToObjName;

    /**
     * 授权类型 AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权,SHARE_USE:分享授权
     * 如果设置此字段，则使用此字段的授权类型；否则使用AuthRedBlackDTO中的grantType
     */
    private String grantType;

}
