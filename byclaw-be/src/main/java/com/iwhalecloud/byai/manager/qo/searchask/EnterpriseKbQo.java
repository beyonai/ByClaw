package com.iwhalecloud.byai.manager.qo.searchask;

import lombok.Getter;
import lombok.Setter;
import java.util.Collection;

/**
 * @author he.duming
 * @date 2026-03-11 11:37:52
 * @description TODO
 */
@Getter
@Setter
public class EnterpriseKbQo {

    private Integer pageNum = 1;

    private Integer pageSize = 10;

    private Long sessionId;

    private Long userId;

    private String keyword;

    /**
     * 驻地授权
     */
    private Long userStationId;

    /**
     * 岗位授权
     */
    private Collection<Long> userPositionIds;

    /**
     * 授权组织
     */
    private Collection<Long> userOrgIds;
}
