package com.iwhalecloud.byai.state.domain.chat.dto;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatInfo {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    private Boolean running = false;

    private String traceId;

    private String laneId;

    private String clientRequestId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long userMessageId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long modelAnswerMessageId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    private String transport;

    private Long startedAt;

    private Long ttlSeconds;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long agentId;

    private String agentCode;

    private String agentType;

    private String chatContent;

    private String runtimeStatus;

    private String runtimeSource;

    private Boolean rootActive;

    private Boolean acceptingInput;

    private Long activeAgentCount;

    private Long activeChildCount;

    private Long waitingInteractionCount;

    private Long runtimeRevision;

    private Long runtimeChangedAt;
}
