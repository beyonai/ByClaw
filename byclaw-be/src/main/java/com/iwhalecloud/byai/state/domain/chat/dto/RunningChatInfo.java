package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatInfo {

    private Long sessionId;

    private Boolean running = false;

    private String traceId;

    private String clientRequestId;

    private Long userMessageId;

    private Long modelAnswerMessageId;

    private String transport;

    private Long startedAt;

    private Long ttlSeconds;

    private Long agentId;

    private String agentCode;

    private String agentType;

    private String chatContent;
}
