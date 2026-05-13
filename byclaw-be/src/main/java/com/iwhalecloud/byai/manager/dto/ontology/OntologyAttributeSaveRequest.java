package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 对象函数和属性保存请求DTO
 * 包括：对象基本信息、对象属性、函数和函数属性、关联对象
 */
@Getter
@Setter
@Schema(description = "对象函数和属性保存请求")
public class OntologyAttributeSaveRequest {


    /**
     * 对象资源ID（必填）
     */
    @NotNull(message = "对象资源ID不能为空")
    @Schema(description = "对象资源ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "123456")
    private Long resourceId;



    /**
     * 对象属性列表（前端传入完整列表，后端自动对比计算增删改）
     */
    @Valid
    @Schema(description = "对象属性列表，前端传入完整列表，后端自动对比数据库计算增删改")
    private List<OntologyBatchSaveRequest.ObjectAttribute> attributes;


}

