package com.iwhalecloud.byai.state.domain.taskplan.dto;

import lombok.Data;

/** 查询一轮执行当前任务计划的定位信息。 */
@Data
public class TaskPlanLookupRequest {

    private String sessionId;

    private String messageId;

    private String traceId;

    private String laneId;

    private String sourceRuntime;

    private String sourceRunId;

    /** true 时返回最新终态快照，供 WebSocket 重连恢复；Agent 运行时保持 false。 */
    private Boolean includeTerminal;

    private String reason;
}
