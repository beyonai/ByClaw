package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.Data;

@Data
public class AppendMessageDto {
    private Long messageId;

    private String content;

    private String messageStruct;

    private Boolean isComplete;

    private Integer appendIndex;

    private String inferLog;

    private Long sessionId;
}
