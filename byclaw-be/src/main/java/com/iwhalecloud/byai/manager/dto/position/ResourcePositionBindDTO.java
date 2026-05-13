package com.iwhalecloud.byai.manager.dto.position;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 资源岗位绑定请求DTO
 */
@Data
public class ResourcePositionBindDTO {

    /**
     * 岗位ID
     */
    @NotNull(message = "position.positionid.notnull")
    private Long positionId;

    /**
     * 资源ID
     */
    @NotNull(message = "resource.resourceid.notnull")
    private Long resourceId;
}