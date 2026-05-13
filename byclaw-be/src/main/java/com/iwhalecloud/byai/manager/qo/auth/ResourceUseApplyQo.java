package com.iwhalecloud.byai.manager.qo.auth;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源使用申请查询/创建入参。
 * 统一只接 resourceId，后端再根据资源主表拿真实的 resourceBizType，
 * 避免前端传错类型导致申请和审核口径不一致。
 * @author qin.guoquan
 * @date 2026-04-25 16:20:00
 */
@Getter
@Setter
public class ResourceUseApplyQo {

    /**
     * 资源标识。
     */
    @NotNull(message = "resourceId不能为空")
    private Long resourceId;
}
