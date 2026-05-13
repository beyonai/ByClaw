package com.iwhalecloud.byai.manager.qo.auth;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-25 10:03:36
 * @description TODO
 */
@Getter
@Setter
public class DigitalEmployeeAuthQo extends QueryObject {

    /**
     * 授权类型,AVAILABLE_USE:使用授权,FORCE_USE：强制使�?ALLOW_MANAGE:管理授权
     */
    private String grantType;

    /***
     * 权限授予对象类型,USER:人员,ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /**
     * 授权对象标识
     */
    private Long grantToObjId;

    /**
     * 授权对象编码
     */
    private String grantToObjCode;

    /**
     * 关键字搜�?
     */
    private String keyword;

    private Long current;

    private Long pageCount;

    private Long total;

    /**
     * 当前授权名称 如岗位名称、组织名称等
     */
    private String grantName;

}
