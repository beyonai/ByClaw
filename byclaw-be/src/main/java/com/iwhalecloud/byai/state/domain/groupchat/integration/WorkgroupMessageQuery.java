package com.iwhalecloud.byai.state.domain.groupchat.integration;

/** Business identity used by authorized service consumers; no device, vendor or notification fields. */
public record WorkgroupMessageQuery(long enterpriseId, long sessionId, long messageId, long accountId) {
}
