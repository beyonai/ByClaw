package com.iwhalecloud.byai.manager.vo.organization;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * 组织视图对象
 */
@Getter
@Setter
public class OrganizationVo implements Serializable {

    /**
     * 组织ID
     */
    private Long orgId;

    /**
     * 组织编码
     */
    private String orgCode;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 组织排序索引
     */
    private Integer orgIndex;

    /**
     * 父组织ID
     */
    private Long parentOrgId;

    /**
     * 父组织名称
     */
    private String parentOrgName;

    /**
     * 组织描述
     */
    private String orgDesc;

}
