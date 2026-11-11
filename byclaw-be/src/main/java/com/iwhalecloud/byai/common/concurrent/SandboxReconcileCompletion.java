package com.iwhalecloud.byai.common.concurrent;

import com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/** Local-only completion on clean threads; durable STARTING/restart rows remain the recovery fallback. */
public final class SandboxReconcileCompletion {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(SandboxReconcileCompletion.class);
    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final ExecutorService EXECUTOR = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(32), runnable -> {
            Thread thread = new Thread(null, runnable, "sandbox-reconcile-completion-" + SEQUENCE.incrementAndGet(), 0, false);
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.AbortPolicy());

    private SandboxReconcileCompletion() { }

    public static <T> T complete(Supplier<T> completion) {
        var login = CurrentUserHolder.getLoginInfo();
        String dataSource = CustomerContextHolder.getCustomerType();
        Future<T> future = EXECUTOR.submit(() -> {
            CurrentUserHolder.setLoginInfo(login);
            CustomerContextHolder.setCustomerType(dataSource);
            try {
                return completion.get();
            }
            catch (RuntimeException e) {
                LOG.error("Local sandbox completion failed; durable record retained for reconciliation", e);
                throw e;
            }
            finally {
                CurrentUserHolder.clearLoginInfo();
                CustomerContextHolder.clearCustomerType();
            }
        });
        try {
            return future.get(5, TimeUnit.SECONDS);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CancellationException("Local sandbox completion continues independently");
        }
        catch (TimeoutException e) {
            // Do not cancel a known-result write. It may already have committed.
            throw new CancellationException("Local sandbox completion pending; reconcile will recover it");
        }
        catch (ExecutionException e) {
            throw new IllegalStateException("Local sandbox completion failed; durable record retained", e.getCause());
        }
    }
}
