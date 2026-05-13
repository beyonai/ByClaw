package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 数据集执行请求DTO
 * 用于执行数据集查询，根据配置的SQL和入参出参构建最终查询语句
 *
 * @author zzh
 */
@Getter
@Setter
public class DatasetExecuteRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源ID（数据集ID）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{resource.id.required}")
    private Long resourceId;

    /**
     * 当前页码（从1开始）
     */
    @Min(value = 1, message = "页码不能小于1")
    private Long pageIndex = 1L;

    /**
     * 每页条数（默认30，最大30）
     */
    @Min(value = 1, message = "每页条数不能小于1")
    @Max(value = 30, message = "每页条数不能大于30")
    private Long pageSize = 30L;


    /**
     * 入参列表（用于构建WHERE条件）
     * 支持多种匹配类型：=、!=、>、>=、<、<=、between、in、like、not_like、is_null、is_not_null
     */
    private List<DatasetExecuteParam> inParamList;

    /**
     * 出参列表（用于构建SELECT子句）
     * 如果为空，则返回所有配置的出参字段
     */
    private List<DatasetExecuteParam> outParamList;

    /**
     * 数据集执行参数项
     */
    @Getter
    @Setter
    public static class DatasetExecuteParam implements Serializable {

        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 属性编码（字段名）
         * 对应 SsResExtAttribute.attribute_code
         */
        @NotNull(message = "{attribute.code.required}")
        private String attributeCode;

        /**
         * 属性值列表
         * - 普通匹配（=、!=、>、>=、<、<=）：使用第一个值
         * - between：使用前两个值（最小值、最大值）
         * - in：使用所有值
         * - like/not_like：使用第一个值（会自动添加%）
         * - is_null/is_not_null：不需要值
         */
        private List<String> attributeValueList;

        /**
         * 匹配类型
         * 支持：=、!=、>、>=、<、<=、between、in、like、not_like、is_null、is_not_null
         */
        private String matchType;

        /**
         * 扩展元数据（JSON字符串）
         * 包含 sourceTableCode 等信息，用于WHERE条件构建
         */
        private String extMeta;

    }
}
