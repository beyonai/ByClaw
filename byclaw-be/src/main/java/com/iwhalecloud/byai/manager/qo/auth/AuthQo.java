package com.iwhalecloud.byai.manager.qo.auth;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;
import java.util.Collection;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-11-12 23:37:35
 * @description TODO
 */
@Getter
@Setter
public class AuthQo extends QueryObject {

    /**
     * 用户授权
     */
    private Long userId;

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

    /**
     * 当前用户是否为平台管理员。
     */
    private Boolean platformManager;

    /**
     * 当前用户作为组织管理员可管理的组织路径。
     */
    private Collection<String> managerOrgPathCodes;

    /**
     * 终端类型
     */
    private List<String> terminals;

}
