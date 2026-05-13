package com.iwhalecloud.byai.manager.qo.auth;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-25 19:30:58
 * @description TODO
 */
@Getter
@Setter
public class AuthDetailQo {

    /***
     * 授权类型 AVAILABLE_USE:使用授权,FORCE_USE：强制使用,ALLOW_MANAGE:管理授权
     */
    @NotEmpty(message = "{authdetailqo.authType.notempty}")
    private String grantType;

    /**
     * 资源类型,AGENT:智能体,DOC:文档,DB:数据源,PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录,TAG:标签
     */
    @NotEmpty(message = "{authdetailqo.resourceType.notempty}")
    private String grantObjType;

    /**
     * 资源对象标识
     */
    @NotNull(message = "{authdetailqo.resourceId.notnull}")
    private Long grantObjId;

}
