package com.iwhalecloud.byai.manager.dto.ecosystem;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/**
 * 生态采集运行启动请求。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemRunStartRequest {

    /**
     * 要启动的生态采集任务 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    /**
     * 触发来源，例如 MANUAL、SCHEDULED、SKILL、RETRY。
     */
    private String triggerType;
}
