package com.iwhalecloud.byai.manager.qo.organization;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Collection;

/**
 * @author he.duming
 * @date 2025-04-14 01:17:59
 * @description 查询组织树对象
 */
@Getter
@Setter
public class OrgTreeQo {

    /**
     * 是否需要根据父组织标识过滤
     */

    @Min(value = -1, message = "{orgtreeqo.parentid.min}")
    private Long parentOrgId;

    /**
     * 关键字搜索
     */
    @Size(max = 100, message = "{orgtreeqo.keyword.size}")
    private String keyword;

    /**
     * 模糊搜索时是否查询父节点返回
     */
    private boolean containsParent;

    /**
     * 根据组织标识查询
     */
    private Collection<Long> orgIds;

    /**
     * 前端传入的标识：1: 我的组织 0：所有组织
     */
    private String myFlag;

    public OrgTreeQo() {
    }

    public OrgTreeQo(Collection<Long> orgIds) {
        this.orgIds = orgIds;
    }

}
