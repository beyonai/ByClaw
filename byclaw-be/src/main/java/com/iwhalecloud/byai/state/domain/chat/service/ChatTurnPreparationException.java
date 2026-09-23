package com.iwhalecloud.byai.state.domain.chat.service;

/** Proven local preparation failure: no Gateway delivery has been attempted for this turn. */
public class ChatTurnPreparationException extends RuntimeException {
    public ChatTurnPreparationException(String message, Throwable cause) {
        super(message, cause);
    }

    public ChatTurnPreparationException(Throwable cause) {
        super("Chat turn failed before Gateway routing", cause);
    }
}
