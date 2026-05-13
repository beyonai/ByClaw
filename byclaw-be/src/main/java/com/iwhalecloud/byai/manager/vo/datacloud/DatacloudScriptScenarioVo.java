package com.iwhalecloud.byai.manager.vo.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Builder;
import lombok.Data;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/26 14:42
 */
@Data
@Builder
public class DatacloudScriptScenarioVo {

    /**
     * 场景主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scenarioId;
}
