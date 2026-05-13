package com.iwhalecloud.byai.manager.qo.resource;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-02 18:00:37
 * @description TODO
 */
@Getter
@Setter
public class ResourceQo extends QueryObject {

    /**
     * 归属类型�?=授权给我�?1=我创建的�?=我管理的
     */
    private Integer ownershipType = 0;

    /**
     * 创建用户
     */
    private Long createBy;

    /**
     * 资源标识
     */
    private List<Long> resourceIds;

    private Long resourceId;

    /**
     * 资源类型
     */
    private List<String> resourceBizTypes = new ArrayList<>(5);

}
