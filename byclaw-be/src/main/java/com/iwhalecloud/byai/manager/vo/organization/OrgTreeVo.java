package com.iwhalecloud.byai.manager.vo.organization;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * 组织树视图对象
 */
@Getter
@Setter
public class OrgTreeVo implements Serializable {

    /**
     * 组织ID
     */
    private Long orgId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 父组织ID
     */
    private Long parentOrgId;

    /**
     * 组织路径信息
     */
    private String pathCode;

    /***
     * 子组织数量
     */
    private int total;

}
