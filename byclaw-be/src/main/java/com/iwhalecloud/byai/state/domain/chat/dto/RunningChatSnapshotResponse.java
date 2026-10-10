package com.iwhalecloud.byai.state.domain.chat.dto;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
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

    @JsonSerialize(using = ToStringSerializer.class)
    private Long modelAnswerMessageId;

    private String snapshotStreamId;

    /** Stable worker-side identifier for one execution of a reused child session. */
    private String childRunId;

    /** Monotonic, one-based execution number supplied by the worker. */
    private Long childTurn;

    // Recovery identities must retain all digits when parsed by browser clients.
    @Override
    @JsonSerialize(using = ToStringSerializer.class)
    public Long getSessionId() {
        return super.getSessionId();
    }

    @Override
    @JsonSerialize(using = ToStringSerializer.class)
    public Long getMessageId() {
        return super.getMessageId();
    }

    @Override
    @JsonSerialize(using = ToStringSerializer.class)
    public Long getCreatorId() {
        return super.getCreatorId();
    }

    @Override
    @JsonSerialize(using = ToStringSerializer.class)
    public Long getTaskId() {
        return super.getTaskId();
    }

    @Override
    @JsonSerialize(using = ToStringSerializer.class)
    public Long getProjectId() {
        return super.getProjectId();
    }
}
