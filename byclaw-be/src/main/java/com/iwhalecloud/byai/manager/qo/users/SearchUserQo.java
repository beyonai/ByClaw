package com.iwhalecloud.byai.manager.qo.users;

import lombok.Getter;
import lombok.Setter;

import jakarta.validation.constraints.NotNull;

/**
 * @author he.duming
 * @date 2025-04-14 00:28:42
 * @description 用户查询对象
 */
@Getter
@Setter
public class SearchUserQo {

    /**
     * 查询用户标识，不允许为空
     */
    @NotNull(message = "{searchuserqo.userid.notnull}")
    private Long userId;

    /**
     * 用户所在组织
     */
    @NotNull(message = "{searchuserqo.orgid.notnull}")
    private Long orgId;

}
