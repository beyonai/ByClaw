package com.iwhalecloud.byai.common.feign.request.manager;

import java.util.Date;


import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-24 18:11:47
 * @description 授权信息表
 */

@Getter
@Setter
public class PrivilegeGrantDto {

    private Long privilegeGrantId;

    /**
     * AVAILABLE_USE:使用授权,FORCE_USE：强制使用,ALLOW_MANAGE:管理授权
     */
    private String grantType;

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
     * 资源对象名称
     */
    private String grantObjName;

    /**
     * 资源对象描述
     */
    private String grantObjDesc;

    /**
     * 生效时间
     */
    private Date effDate;

    /**
     * 失效时间
     */
    private Date expDate;

    /**
     * 状态
     */
    private String statusCd;

    /**
     * 创建人标识
     */
    private Long createStaff;

    /**
     * 创建时间
     */
    private Date createDate;

    /**
     * 修改人员标识
     */
    private Long updateStaff;

    /**
     * 修改时间
     */
    private Date updateDate;

    /**
     * 权限授予对象id
     */
    private Long grantToObjId;

    /**
     * 权限授予对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /**
     * 授权红黑名单：red:红名单，black：黑名单
     */
    private String grantToType;

    /**
     * 允许退订
     */
    private String allowUnsubscribe;

}
