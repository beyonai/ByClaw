package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * 对象查询请求DTO
 */
@Getter
@Setter
@Schema(description = "对象查询请求")
public class OntologyQueryRequest {

    private Long resourceId;

    /**
     * 对象名称（模糊查询）
     */
    @Schema(description = "对象名称（模糊查询）", example = "用户")
    private String name;

    /**
     * 目录ID
     */
    @Schema(description = "目录ID", example = "123456")
    private Long catalogId;

    /**
     * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     */
    @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE", example = "1")
    private Integer sourceType;

    /**
     * 页码
     */
    @Schema(description = "页码", example = "1")
    private Integer pageIndex = 1;

    /**
     * 每页大小
     */
    @Schema(description = "每页大小", example = "10")
    private Integer pageSize = 10;
}

