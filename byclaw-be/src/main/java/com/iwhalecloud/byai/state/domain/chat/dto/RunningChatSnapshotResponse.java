package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatSnapshotResponse extends ByaiMessageHotDtoDto {

    /** Kept separately so recovery never appends deltas onto the explicit final body. */
    private String accumulatedAnswerText;

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
