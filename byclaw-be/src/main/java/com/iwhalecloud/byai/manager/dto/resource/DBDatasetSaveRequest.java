package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;

/**
 * 数据集保存请求DTO
 */
@Getter
@Setter
public class DBDatasetSaveRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源ID（数据集ID）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{resource.id.required}")
    private Long resourceId;

    /**
     * 数据集的布局（前端画布JSON）
     */
    private String tableLocation;

    /**
     * 表之间的关系（JSON格式）
     * 包含：mainTable, tableFieldInfoList, dimensionJoinList, subJoinList, tableList
     */
    private Object tableJoinInfo;

    /**
     * 数据源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long dataSourceId;

}

