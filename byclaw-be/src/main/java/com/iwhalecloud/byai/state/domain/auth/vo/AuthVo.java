package com.iwhalecloud.byai.state.domain.auth.vo;

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
     * AVAILABLE_USE:使用授权,FORCE_USE：强制使用,ALLOW_MANAGE:管理授权
     */
    private String grantType;

    /**
     * 红名单对象
     */
    private Long redToObjId;

    /**
     * 红名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
     */
    private String redToObjType;

    /**
     * 黑名单对象
     */
    private Long blackToObjId;

    /**
     * 黑名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
     */
    private String blackToObjType;

    /**
     * READ:读，WRITE:写
     */
    private String operType;

    /**
     * 资源类型,AGENT:智能体,DOC:文档库,DB:数据库,PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录,TAG:标签
     */
    private String grantObjType;

    /**
     * 资源对象标识
     */
    private Long grantObjId;

    /**
     * 添加人
     */
    private String createdBy;

    /**
     * 成员
     */
    private String memberName;
}
