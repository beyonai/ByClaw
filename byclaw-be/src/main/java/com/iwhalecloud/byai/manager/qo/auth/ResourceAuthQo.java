package com.iwhalecloud.byai.manager.qo.auth;

import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-25 10:12:34
 * @description TODO
 */
@Getter
@Setter
public class ResourceAuthQo extends AuthQo {

    /**
     * 授权范围 使用范围 AVAILABLE_USE:使用授权,FORCE_USE：强制使�?ALLOW_MANAGE:管理授权,分享授权:SHARE_USE
     */
    private String grantType;

    /**
     * 授权类型
     */
    private List<String> grantTypeList;

    /***
     * 权限授予对象类型,USER:人员ORG:组织,POST:岗位
     */
    private String grantToObjType;

    /***
     * 权限授予对象类型,KG_DOC,KG_DB
     */
    private String grantObjType;

    /**
     * 授权对象id
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

    /**
     * 授权类型 岗位名称/组织名称
     */
    private String grantName;

    /**
     * 资源类型, DIG_EMPLOYEE：数字员�? AGENT：智能体, DOC：文档库, DB：数据库, PLUGIN：插�? TOOL：工�? CATLOGUE：文档库目录, TAG：标�?
     */
    private List<String> grantResourceTypeList;

    /**
     * 状态：0-草稿 1-待上�?2-已上�?3-已下�?
     */
    private Integer resourceStatus;

    /**
     * 所属目录ID
     */
    private Long catalogId;

    /**
     * 1 组织的归属授�? 2 使用授权
     */
    private Integer authType;

    private String resourceType;

    /**
     * 排序字段列表
     */
    private List<SortField> sortFields;

    private List<String> systemCodes;

    private List<Long> catalogIds;

}
