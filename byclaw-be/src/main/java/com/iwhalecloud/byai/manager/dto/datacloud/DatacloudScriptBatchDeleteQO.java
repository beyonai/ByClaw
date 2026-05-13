package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

/**
 * 脚本批量删除QO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptBatchDeleteQO {

    /**
     * 脚本ID列表
     */
    @NotEmpty(message = "脚本ID列表不能为空")
    private List<@NotNull(message = "脚本ID不能为空") Long> scriptIds;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;
}
