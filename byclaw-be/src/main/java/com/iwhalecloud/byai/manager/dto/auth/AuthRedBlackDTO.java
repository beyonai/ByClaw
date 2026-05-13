package com.iwhalecloud.byai.manager.dto.auth;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-25 14:57:58
 * @description TODO
 */
@Getter
@Setter
public class AuthRedBlackDTO {

    /***
     * 来源系统
     */
    private String sourceSystem;

    /***
     * 授权类型 AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权
     */
    private String grantType;

    /**
     * 多个授权类型列表，用于批量处理多种授权类型 如果传入grantTypes，则会按每个类型分别处理
     */
    private List<String> grantTypes;

    /**
     * 资源对象标识
     */
    private Long grantObjId;

    /**
     * 资源类型,AGENT:智能体DOC:文档库DB:数据库PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录?TAG:标签
     */
    private String grantObjType;

    /***
     * 红名单列表
     */
    private List<AuthDTO> redList;

    /**
     * 黑名单列表
     */
    private List<AuthDTO> blackList;

    /**
     * 是否允许取消订阅，true-允许 false-不允许默认为false
     */
    private boolean allowUnSubscribe = false;

    private Long orgId;
}
