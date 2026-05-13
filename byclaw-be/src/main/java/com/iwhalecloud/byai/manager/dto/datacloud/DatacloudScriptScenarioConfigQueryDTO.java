package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/**
 * 场景配置查询DTO
 * 用于分页查询脚本场景配置
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptScenarioConfigQueryDTO {

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 页大小
     */
    private Integer pageSize = 10;

    /**
     * 脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scriptId;

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
     * 是否包含脚本内容
     */
    private Boolean includeContent = false;

}
