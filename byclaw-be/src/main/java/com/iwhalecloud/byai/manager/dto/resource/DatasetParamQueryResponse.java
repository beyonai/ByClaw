package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 数据集参数查询响应DTO
 */
@Getter
@Setter
public class DatasetParamQueryResponse implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 入参列表
     */
    private List<DatasetParamField> inParamList;

    /**
     * 出参列表
     */
    private List<DatasetParamField> outParamList;

    /**
     * 数据集参数字段信息
     */
    @Getter
    @Setter
    public static class DatasetParamField implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 字段编码
         */
        private String fieldCode;

        /**
         * 字段名称
         */
        private String fieldName;
        /**
         * 数据范围类型（P => Per Data, A => All Data）
         */
        private String perDataScopeType;

        /**
         * 来源表编码
         */
        private String sourceTableCode;

        /**
         * 字段类型（S => String, D => Date, I => Integer, N => Number, A => Array, O => Object, E => Enum）
         */
        private String fieldType;

        /**
         * 别名
         */
        private String alias;

        /**
         * 是否已选中（0-未选中，1-已选中）
         */
        private Integer isSelected;

        /**
         * 是否必填（0-否，1-是）
         */
        private Integer isRequired;

        /**
         * 属性描述
         */
        private String attributeDesc;

        /**
         * 关联的术语类型编码
         */
        private String termTypeCode;

        /**
         * 关联术语字段（id/name）
         */
        private String termField;

        private String termDataType;

        private String termTypeName;

        private String datasetId;

    }
}
