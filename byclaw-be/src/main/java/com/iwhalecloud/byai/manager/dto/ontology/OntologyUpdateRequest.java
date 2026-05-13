package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 对象更新请求DTO
 */
@Getter
@Setter
@Schema(description = "对象更新请求")
public class OntologyUpdateRequest {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    @Schema(description = "资源ID", required = true, example = "123456")
    private Long resourceId;

    /**
     * 对象名称
     */
    @NotBlank(message = "对象名称不能为空")
    @Schema(description = "对象名称", required = true, example = "用户对象")
    private String name;

    /**
     * 对象描述
     */
    @Schema(description = "对象描述", example = "用户对象描述")
    private String desc;

    /**
     * 文档库id
     */
    private Long docId;

    /**
     * 目录ID
     */
    @Schema(description = "目录ID", example = "123456")
    private Long catalogId;

    /**
     * 类型， VIEW/OBJECT
     */
    private String type;

    /**
     * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     */
    @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE", example = "1")
    private Integer sourceType;
}

