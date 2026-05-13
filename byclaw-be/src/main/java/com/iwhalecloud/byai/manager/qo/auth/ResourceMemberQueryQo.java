package com.iwhalecloud.byai.manager.qo.auth;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源成员查询入参
 */
@Getter
@Setter
public class ResourceMemberQueryQo {

    /**
     * 资源ID
     */
    @NotNull(message = "resourceId不能为空")
    private Long resourceId;
}
