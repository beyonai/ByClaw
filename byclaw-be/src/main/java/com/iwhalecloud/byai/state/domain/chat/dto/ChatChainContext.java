package com.iwhalecloud.byai.state.domain.chat.dto;

/** Server-owned identity and process-local clock for one accepted chat invocation. */
public record ChatChainContext(String requestId, String invocationId, String tenantId,
                               String scope, String userCode, String ingressRequestId, long startedNanos) {
}
