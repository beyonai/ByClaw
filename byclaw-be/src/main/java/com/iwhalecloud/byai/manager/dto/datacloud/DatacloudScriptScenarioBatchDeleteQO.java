package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

/**
 * 脚本场景批量删除QO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptScenarioBatchDeleteQO {

    /**
     * 场景ID列表
     */
    @NotEmpty(message = "场景ID列表不能为空")
    private List<@NotNull(message = "场景ID不能为空") Long> scenarioIds;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;
}
