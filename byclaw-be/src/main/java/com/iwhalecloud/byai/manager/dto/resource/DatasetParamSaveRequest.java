package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 数据集参数保存请求DTO
 */
@Getter
@Setter
public class DatasetParamSaveRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源ID（数据集ID）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{resource.id.required}")
    private Long resourceId;

    /**
     * 入参列表
     */
    private List<DatasetParamItem> inParamList;

    /**
     * 出参列表
     */
    private List<DatasetParamItem> outParamList;

    /**
     * 数据集参数项
     */
    @Getter
    @Setter
    public static class DatasetParamItem implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 属性名称（相当于selectFieldList.fieldName）
         */
        private String fieldName;

        /**
         * 属性编码（相当于selectFieldList.fieldCode）
         */
        private String fieldCode;

        /**
         * 别名
         */
        private String alias;

        /**
         * 字段类型（相当于ss_res_ext_attribute.type）
         * S => String, D => Date, I => Integer, N => Number, A => Array, O => Object, E => Enum
         */
        private String fieldType;

        private String perDataScopeType;

        /**
         * 属性描述（用户填写）
         */
        private String attributeDesc;

        /**
         * 是否必填（0 否；1 是）
         */
        private Integer isRequired;

        /**
         * 关联的术语类型编码（相当于ss_res_ext_attribute.term_type_code）
         */
        private String termTypeCode;

        /**
         * 关联术语字段（相当于ss_res_ext_attribute.term_field）
         * 枚举值：id/name
         */
        private String termField;

        /**
        * 关联术语类型名称
        */
        private String termTypeName;
        /**
         * 属于类型是枚举还是列表
         * 1-枚举
         * 2-列表
         */
        private String termDataType;
        /**
         * 术语库id
         */
        private String datasetId;

        /**
         * 来源表编码（相当于selectFieldList.sourceTableCode）
         */
        private String sourceTableCode;
    }

}

