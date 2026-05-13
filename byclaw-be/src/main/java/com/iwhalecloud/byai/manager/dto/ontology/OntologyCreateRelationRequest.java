package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * 创建对象关联请求DTO
 */
@Getter
@Setter
@Schema(description = "创建对象关联请求")
public class OntologyCreateRelationRequest {

    /**
     * 被关联的对象ID（必填）
     */
    @NotNull(message = "被关联的对象ID不能为空")
    @Schema(description = "被关联的对象ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "123456")
    private Long objId;

    /**
     * 已存在的关联对象ID（可选）
     * 如果为空，则需要提供name、desc、type、catalogId、sourceType来创建新对象
     */
    @Schema(description = "已存在的关联对象ID", example = "789012")
    private List<Long> relIds;

    /**
     * 对象名称（当relId为空时必填）
     */
    @Schema(description = "对象名称（当relId为空时必填）", example = "用户对象")
    private String name;

    /**
     * 对象描述（当relId为空时可选）
     */
    @Schema(description = "对象描述", example = "用户对象描述")
    private String desc;

    /**
     * 对象类型（当relId为空时必填，固定为OBJECT）
     */
    @Schema(description = "对象类型（当relId为空时必填，固定为OBJECT）", example = "OBJECT")
    private String type;

    /**
     * 目录ID（当relId为空时必填）
     */
    @Schema(description = "目录ID（当relId为空时必填）", example = "123456")
    private Long catalogId;

    /**
     * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE（当relId为空时必填）
     */
    @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE（当relId为空时必填）", example = "1")
    private Integer sourceType;
}

