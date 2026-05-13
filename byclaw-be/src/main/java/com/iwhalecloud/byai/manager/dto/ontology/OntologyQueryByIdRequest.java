package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 根据ID查询对象请求DTO
 */
@Getter
@Setter
@Schema(description = "根据ID查询对象请求")
public class OntologyQueryByIdRequest {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    @Schema(description = "资源ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "123456")
    private Long resourceId;
}

