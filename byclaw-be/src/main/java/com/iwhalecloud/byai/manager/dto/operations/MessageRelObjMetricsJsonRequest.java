package com.iwhalecloud.byai.manager.dto.operations;

import jakarta.validation.constraints.NotEmpty;
import lombok.Data;


/**
 * 消息引用对象指标查询json
 * @author zzh
 */
@Data
public class MessageRelObjMetricsJsonRequest {
    
    /**
     * 开始时间
     */
    @NotEmpty(message = "执行查询指标json不能为空")
    private String metricContentJson;
    
}