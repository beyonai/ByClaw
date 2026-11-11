package com.iwhalecloud.byai.common.concurrent;

import java.util.concurrent.CancellationException;

/** Cancellation budget scoped to one sandbox reconcile worker, including nested remote calls. */
public final class SandboxReconcileCancellation {

    private static final ThreadLocal<Long> DEADLINE = new ThreadLocal<>();

    private SandboxReconcileCancellation() {
    }

    public static void setDeadline(long deadline) {
        DEADLINE.set(deadline);
    }

    public static void clear() {
        DEADLINE.remove();
    }

    public static boolean isActive() {
        return DEADLINE.get() != null;
    }

    public static boolean isCancelled(Throwable failure) {
        Long deadline = DEADLINE.get();
        if (deadline == null) {
            return false;
        }
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof InterruptedException) {
                Thread.currentThread().interrupt();
                break;
            }
            if (cause instanceof CancellationException) {
                return true;
            }
        }
        return Thread.currentThread().isInterrupted() || System.currentTimeMillis() >= deadline;
    }

    public static void check(Throwable failure) {
        if (isCancelled(failure)) {
            throw new CancellationException("Sandbox reconcile cancelled or deadline exceeded");
        }
    }
}
