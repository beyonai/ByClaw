package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongConsumer;

/** Sticky cancellation for an admitted synchronous chat startup, even if a dependency clears interruption. */
public final class ChatRequestCancellation {
    private static final ThreadLocal<Scope> CURRENT = new ThreadLocal<>();

    private ChatRequestCancellation() {
    }

    public static void run(AtomicBoolean cancelled, LongConsumer bindSession, Runnable action) {
        try {
            CURRENT.set(new Scope(cancelled, bindSession));
            check();
            action.run();
        }
        finally {
            CURRENT.remove();
        }
    }

    public static boolean isCancelled() {
        Scope scope = CURRENT.get();
        return scope != null && scope.cancelled().get();
    }

    public static void bindSession(Long sessionId) {
        Scope scope = CURRENT.get();
        if (scope != null && sessionId != null) scope.bindSession().accept(sessionId);
        check();
    }

    public static void check() {
        if (isCancelled() || Thread.currentThread().isInterrupted()) {
            throw new CancellationException("Chat request cancelled");
        }
    }
    private record Scope(AtomicBoolean cancelled, LongConsumer bindSession) {
    }

}
