package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * 数据集响应DTO
 */
@Getter
@Setter
public class DatasetResponse implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 数据集标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long datasetId;

    /**
     * 资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 库表关联关系信息（JSON格式）
     */
    private Object tableJoinInfo;

    /**
     * 表关联关系json-数据集的布局（前端画布JSON）
     */
    private String tableLocation;

    /**
     * 执行SQL
     */
    private String executeSql;

    /**
     * 创建人
     */
    private String createBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;

}

