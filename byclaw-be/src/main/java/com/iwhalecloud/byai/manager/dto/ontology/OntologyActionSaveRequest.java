package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 对象动作保存请求DTO
 * 包括：动作和动作属性
 */
@Getter
@Setter
@Schema(description = "对象动作保存请求")
public class OntologyActionSaveRequest {

    /**
     * 对象资源ID（saveOntologyInfos场景必填；saveBatchForOther场景可选，为空时自动创建新对象）
     */
    @Schema(description = "对象资源ID", example = "123456")
    private Long resourceId;

    /**
     * 对象名称
     */
    @Schema(description = "对象名称", example = "用户对象")
    private String name;

    /**
     * 对象描述
     */
    @Schema(description = "对象描述", example = "用户对象描述")
    private String desc;

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
     * 对象类型（OBJECT/VIEW，新建场景使用，默认OBJECT）
     */
    @Schema(description = "对象类型", example = "OBJECT")
    private String type;

    /**
     * 文档库ID（新建场景使用）
     */
    @Schema(description = "文档库ID", example = "123456")
    private Long docId;

    /**
     * 父级ID（新建场景使用）
     */
    @Schema(description = "父级ID")
    private String pid;

    /**
     * 对象属性列表（前端传入完整列表，后端自动对比计算增删改）
     */
    @Valid
    @Schema(description = "对象属性列表，前端传入完整列表，后端自动对比数据库计算增删改")
    private List<OntologyBatchSaveRequest.ObjectAttribute> attributes;


    /**
     * 动作列表
     */
    @Valid
    @Schema(description = "动作列表", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<OntologyBatchSaveRequest.ActionInfo> actions;


}

