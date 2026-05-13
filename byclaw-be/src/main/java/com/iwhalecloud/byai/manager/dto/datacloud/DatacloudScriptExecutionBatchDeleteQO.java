package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

/**
 * 脚本执行记录批量删除QO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptExecutionBatchDeleteQO {

    /**
     * 执行记录ID列表
     */
    @NotEmpty(message = "执行记录ID列表不能为空")
    private List<@NotNull(message = "执行记录ID不能为空") Long> executionIds;

    /**
     * 企业ID
     */
    @NotNull(message = "企业ID不能为空")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;
}
