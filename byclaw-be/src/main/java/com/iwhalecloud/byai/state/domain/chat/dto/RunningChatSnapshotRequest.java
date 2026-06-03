package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatSnapshotRequest {

    private Long sessionId;

    private String traceId;

    private Long modelAnswerMessageId;
}
