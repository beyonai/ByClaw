package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * 数据集扩展表实体类
 */
@Getter
@Setter
@TableName("ss_res_ext_dbdataset")
public class SsResExtDbDataset implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 数据集标识（主键）
     */
    @TableId(value = "dataset_id", type = IdType.AUTO)
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
    private String tableJoinInfo;

    /**
     * 表关联关系json-数据集的布局（前端画布JSON）
     */
    private String tableLocation;

    /**
     * 执行SQL
     */
    private String executeSql;

    /**
     * 主表dataSourceId
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long mainDataSourceId;

    /**
     * 创建人
     */
    private String createBy;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

}

