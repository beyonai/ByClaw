package com.iwhalecloud.byai.manager.entity.monitor;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 监控目标表实体，仅包含数据库现有字段
 */
@Data
@TableName("byai_monitor_target")
public class MonitorTarget implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 主键ID
     */
    @TableId(value = "target_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetId;

    /**
     * 目标名称（数字员工名称）
     */
    private String targetName;

    /**
     * 目标类型
     */
    private String targetType;

    /**
     * 是否启用监控
     */
    private Integer enabled;

    /**
     * 是否开启告警
     */
    private Integer alertEnabled;

    /**
     * 可用性
     */
    private Integer availability;

    /**
     * 告警次数
     */
    private Long alterCount;

    /**
     * 目标子类型
     */
    private String targetSubType;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;

    /**
     * 创建人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    /**
     * 更新人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 数字员工ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long agentId;

    /**
     * 质量等级
     */
    private String targetQuality;

    /**
     * 质量说明
     */
    private String qualityDescription;
}


