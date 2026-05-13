package com.iwhalecloud.byai.manager.qo.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源操作权限查询入参。
 *
 * @author qin.guoquan
 * @date 2026-05-06
 */
@Getter
@Setter
@Schema(description = "资源操作权限查询入参")
public class ResourceOperationPermissionsQo {

    /**
     * 资源 ID。
     */
    @NotNull
    @Schema(description = "资源 ID", required = true)
    private Long resourceId;
}
