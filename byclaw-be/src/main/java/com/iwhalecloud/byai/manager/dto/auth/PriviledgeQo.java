package com.iwhalecloud.byai.manager.dto.auth;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 权限查询
 */
@Getter
@Setter
public class PriviledgeQo {

    /**
     * 页数
     */
    private Integer pageIndex;

    /**
     * 页码大小
     */
    private Integer pageSize;

    /**
     * 授权对象 - 知识库Id
     */
    private Long grantObjId;

    /**
     * 授权类型，AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权
     */
    private String grantType;

    /**
     * 资源类型,AGENT:智能体,DOC:文档,DB:数据库,PLUGIN:插件,TOOL:工具,CATALOGUE:文档库目录,TAG:标签
     */
    private String grantObjType;

    /**
     * 红名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
     */
    private List<String> redToObjType;

    /**
     * 黑名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
     */
    private List<String> blackToObjType;

    /**
     * 关键字搜索
     */
    private String keyWord;

}
