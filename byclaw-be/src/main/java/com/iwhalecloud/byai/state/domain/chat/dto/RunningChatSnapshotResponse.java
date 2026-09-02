package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatSnapshotResponse extends ByaiMessageHotDtoDto {

    private Boolean running;

    private String traceId;

    private String clientRequestId;

    private Long modelAnswerMessageId;

    private String snapshotStreamId;

    /** Stable worker-side identifier for one execution of a reused child session. */
    private String childRunId;

    /** Monotonic, one-based execution number supplied by the worker. */
    private Long childTurn;
}
