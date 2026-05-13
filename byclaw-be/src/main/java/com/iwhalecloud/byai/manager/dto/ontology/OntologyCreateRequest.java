package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 对象创建请求DTO
 */
@Getter
@Setter
@Schema(description = "对象创建请求")
public class OntologyCreateRequest {

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
     * 目录ID
     */
    @NotNull(message = "目录ID不能为空")
    @Schema(description = "目录ID", required = true, example = "123456")
    private Long catalogId;


    /**
     * 文档库id
     */
    private Long docId;


    private String pid;

    /**
     * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     */
    @NotNull(message = "数据来源类型不能为空")
    @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE", required = true, example = "1")
    private Integer sourceType;

    /**
     * 对象类型（固定为OBJECT）
     */
    @NotBlank(message = "对象类型不能为空")
    @Schema(description = "对象类型", required = true, example = "OBJECT")
    private String type;


    private List<OntologyBatchSaveRequest.ObjectAttribute> attributes;
}

