package com.iwhalecloud.byai.manager.dto.ontology;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量创建属性请求DTO
 */
@Getter
@Setter
@Schema(description = "批量创建属性请求")
public class AttributeCreateRequest {


    /**
     * 资源ID（必填）
     */
    @NotNull(message = "资源ID不能为空")
    @Schema(description = "资源ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "123456")
    private Long resourceId;

    /**
     * 函数属性列表（必填，至少包含一个函数）
     */
    @NotNull(message = "函数属性列表不能为空")
    @jakarta.validation.constraints.NotEmpty(message = "函数属性列表不能为空")
    @Valid
    @Schema(description = "函数属性列表", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<FunctionAttribute> functions;

    /**
     * 函数属性信息
     */
    @Getter
    @Setter
    @Schema(description = "函数属性信息")
    public static class FunctionAttribute {

        /**
         * 函数名称（必填）
         */
        @NotBlank(message = "函数名称不能为空")
        @Schema(description = "函数名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "getUserInfo")
        private String functionName;

        /**
         * 该函数的属性列表（必填，至少包含一个属性）
         */
        @NotNull(message = "属性列表不能为空")
        @jakarta.validation.constraints.NotEmpty(message = "属性列表不能为空")
        @Valid
        @Schema(description = "属性列表", requiredMode = Schema.RequiredMode.REQUIRED)
        private List<AttributeInfo> attributes;
    }

    /**
     * 属性信息
     */
    @Getter
    @Setter
    @Schema(description = "属性信息")
    public static class AttributeInfo {

        /**
         * 属性类型：in_param-入参，out_param-出参，script-脚本，basic-基本属性，promt-提示词
         */
        @NotBlank(message = "属性类型不能为空")
        @Schema(description = "属性类型：in_param-入参，out_param-出参，script-脚本，basic-基本属性，promt-提示词", 
                requiredMode = Schema.RequiredMode.REQUIRED, example = "in_param")
        private String attributeType;

        /**
         * 属性编码
         */
        @NotBlank(message = "属性编码不能为空")
        @Schema(description = "属性编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "user_id")
        private String attributeCode;

        /**
         * 参数值
         */
        @Schema(description = "参数值", example = "123456")
        private String attributeValue;

        /**
         * 数据类型：String、Integer、Number、Array、Object、Enum
         */
        @NotBlank(message = "数据类型不能为空")
        @Schema(description = "数据类型：String、Integer、Number、Array、Object、Enum", 
                requiredMode = Schema.RequiredMode.REQUIRED, example = "String")
        private String type;

        /**
         * 属性值正则校验规则
         */
        @Schema(description = "属性值正则校验规则", example = "^[a-zA-Z0-9]{1,32}$")
        private String formatExpSt;

        /**
         * 单位，例如：元、万
         */
        @Schema(description = "单位", example = "元")
        private String unit;

        /**
         * 是否必填：0-否，1-是
         */
        @Schema(description = "是否必填：0-否，1-是", example = "1")
        private Integer isRequired;

        /**
         * 关联的术语类型编码
         */
        @Schema(description = "关联的术语类型编码", example = "TERM_TYPE_001")
        private String termTypeCode;

        /**
         * 关联术语字段：枚举值：id/name
         */
        @Schema(description = "关联术语字段：id/name", example = "id")
        private String termField;

        /**
         * 属性描述
         */
        @Schema(description = "属性描述", example = "用户ID")
        private String attributeDesc;

        /**
         * 扩展元数据（JSON字符串格式）
         * 对象参数示例：{"is_biz_id":"0","is_obj_id":"0","is_obj_name":"0"}
         * 动作参数示例：{"rel_obj_id":"","rel_obj_attribute_id":"","action_xpath":""}
         */
        @Schema(description = "扩展元数据（JSON字符串格式）", example = "{\"is_biz_id\":\"0\",\"is_obj_id\":\"0\",\"is_obj_name\":\"0\"}")
        private String extMeta;

        /**
         * 排序
         */
        @Schema(description = "排序", example = "1")
        private Integer sort;
    }
}

