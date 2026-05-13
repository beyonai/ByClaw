package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * 目标脚本DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudTargetScriptDTO {

    /**
     * 目标脚本主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetScriptId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scriptId;

    /**
     * Python脚本内容
     */
    private String pyScriptContent;

    /**
     * NodeJS脚本内容
     */
    private String nodeScriptContent;

    /**
     * 目标选择器
     */
    private String targetSelector;

    /**
     * 目标选择器的类型
     */
    private String type;

    /**
     * 扩展参数（JSON格式）
     */
    private String extParams;

    /**
     * 目标顺序
     */
    private Integer targetOrder;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新者ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;
}
