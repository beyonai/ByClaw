package com.iwhalecloud.byai.state.domain.chat.service;

/** Proven local preparation failure: Gateway routing has not been entered for this turn. */
public class ChatTurnPreparationException extends RuntimeException {
    public ChatTurnPreparationException(Throwable cause) {
        super("Chat turn failed before Gateway routing", cause);
    }
}
