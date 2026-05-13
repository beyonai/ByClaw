package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-25 02:03:08
 * @description TODO
 */
@Getter
@Setter
public class AuthVo {

    /**
     * AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权
     */
    private String grantType;

    /**
     * READ:读，WRITE:写
     */
    private String operType;

    /**
     * 资源类型,AGENT:智能体,DOC:文档,DB:数据源,PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录,TAG:标签
     */
    private String grantResourceType;

    /**
     * 资源对象标识
     */
    private Long grantResourceId;

    /**
     * 添加人
     */
    private String createdBy;

    /**
     * 成员
     */
    private String memberName;

    /**
     * 唯一标识
     */
    private Long privilegeGrantId;


    /**
     *
     * 权限授予对象id
     */
    private Long grantToObjId;

    /**
     * 权限授予对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /**
     * 授权红黑名单标识，如 RED、BLACK（与 au_privilege_grant.grant_to_type 对应）
     */
    private String grantToType;
}
