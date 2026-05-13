package com.iwhalecloud.byai.manager.dto.datacloud;


import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScript;
import lombok.Data;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/12 09:56
 */
@Data
public class DataCloudViewScriptDTO extends DatacloudScript {

    private String loginTypeName;

    /**
     * 场景主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scenarioId;

    /**
     * 场景名称
     */
    private String scenarioName;
}
