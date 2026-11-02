package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;

/** A startup failure whose terminal event was already written before persistence and cleanup. */
public final class ChatStartupFailureException extends BdpRuntimeException {
    public ChatStartupFailureException(String message, RuntimeException cause) {
        super(message, cause);
    }

    public static boolean wasReported(Throwable failure) {
        for (int depth = 0; failure != null && depth < 32; depth++, failure = failure.getCause()) {
            if (failure instanceof ChatStartupFailureException) return true;
        }
        return false;
    }
}
