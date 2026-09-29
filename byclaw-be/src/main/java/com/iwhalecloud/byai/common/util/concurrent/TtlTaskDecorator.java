package com.iwhalecloud.byai.common.util.concurrent;

import org.springframework.core.task.TaskDecorator;

import com.alibaba.ttl.TtlRunnable;

/** Captures TransmittableThreadLocal values per task and restores the worker state afterwards. */
public final class TtlTaskDecorator implements TaskDecorator {

    public static final TtlTaskDecorator INSTANCE = new TtlTaskDecorator();

    private TtlTaskDecorator() {
    }

    @Override
    public Runnable decorate(Runnable runnable) {
        return TtlRunnable.get(runnable, true, true);
    }
}
