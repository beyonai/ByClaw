package com.iwhalecloud.byai.manager.qo.auth;

import lombok.Getter;
import lombok.Setter;
import java.util.Collection;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-04 11:03:26
 * @description 权限查询对象
 */

@Getter
@Setter
public class PrivilegeGrantQo {

    /**
     * 授权范围 使用范围 AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权,分享授权:SHARE_USE
     */
    private String grantType;

    /**
     * 授权范围列表，授权范围使用范围 AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权,分享授权:SHARE_USE
     */
    private List<String> grantTypes;

    /**
     * 授权资源标识，单个查询
     */
    private Long granToObjId;

    /**
     * 单个资源类型,AGENT:智能体DOC:文档DB:数据源PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录TAG:标签
     */
    private String grantObjType;

    /***
     * 批量查询资源类型,AGENT:智能体DOC:文档DB:数据源PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录TAG:标签
     */
    private List<String> grantObjTypes;

    /**
     * 授权资源类型标识，单个查询
     */
    private Long grantObjId;

    /**
     * 授权资源类型标识，批量查询
     */
    private Collection<Long> grantObjIds;

    /***
     * 授权对象，USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /**
     * 授权对象标识单个查询
     */
    private Long grantToObjId;

    /**
     * 授权对象标识列表批量查询
     */
    private Collection<Long> grantToObjIds;

    /**
     * 红黑名单 RED或BLACK，不指定默认查所有
     */
    private String color;

    /**
     * 状态查询
     */
    private String statusCd;

}
