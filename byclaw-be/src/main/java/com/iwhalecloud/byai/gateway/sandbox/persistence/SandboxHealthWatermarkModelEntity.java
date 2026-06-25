package com.iwhalecloud.byai.gateway.sandbox.persistence;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@TableName("sandbox_health_watermark_model")
@Data
public class SandboxHealthWatermarkModelEntity {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private String modelName;

    private String serviceType;

    private String profileKey;

    private Integer enabled;

    private Integer priority;

    private Double idleMemoryLimitRatio;

    private Double busyMemoryLimitRatio;

    private Double criticalMemoryLimitRatio;

    private Double busyCpuRequestRatio;

    private Double criticalCpuRequestRatio;

    private Integer consecutiveBusySamples;

    private Integer recoverSamples;

    private Integer sampleIntervalSeconds;

    private Integer snapshotTtlSeconds;

    private Integer watchTtlSeconds;

    private String remark;

    private Date createdAt;

    private Date updatedAt;
}
