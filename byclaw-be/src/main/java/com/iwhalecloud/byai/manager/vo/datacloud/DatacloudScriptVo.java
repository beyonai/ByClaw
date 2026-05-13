package com.iwhalecloud.byai.manager.vo.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Builder;
import lombok.Data;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/26 15:37
 */
@Data
@Builder
public class DatacloudScriptVo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long scripId;
}
