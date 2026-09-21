package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

/** Local observation identity; never used as authority to start or resend an execution. */
public record GroupChatExecutionStarted(Long executionId, boolean turn, String traceId) { }
