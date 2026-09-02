package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatInfo {

    private Long sessionId;

    private Boolean running = false;

    private String traceId;

    private String laneId;

    private String clientRequestId;

    private Long userMessageId;

    private Long modelAnswerMessageId;

    private Long taskId;

    private String transport;

    private Long startedAt;

    private Long ttlSeconds;

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
