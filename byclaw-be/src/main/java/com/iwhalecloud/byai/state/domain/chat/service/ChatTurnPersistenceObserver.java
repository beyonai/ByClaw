package com.iwhalecloud.byai.state.domain.chat.service;

/** Durable business projections run only after the ordinary turn message has been persisted. */
public interface ChatTurnPersistenceObserver {
    void afterPersisted(ChatProcessContext context);
}
