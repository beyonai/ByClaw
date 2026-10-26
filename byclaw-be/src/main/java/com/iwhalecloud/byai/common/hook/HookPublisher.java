package com.iwhalecloud.byai.common.hook;

import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;

/** Stable business API; disabled environments do not construct payloads or start workers. */
public class HookPublisher {
    private final ObjectProvider<HookDispatcher> dispatcher;
    private final DurableHookPublisher durable;

    public HookPublisher(ObjectProvider<HookDispatcher> dispatcher) {
        this(dispatcher, null);
    }

    public HookPublisher(ObjectProvider<HookDispatcher> dispatcher, DurableHookPublisher durable) {
        this.dispatcher = dispatcher;
        this.durable = durable;
    }

    /** Durable calls fail closed instead of silently downgrading to the best-effort transport. */
    public String publishDurable(String type, int version, String aggregateId, String aggregateRevision,
        String generation, String correlationId, Map<String, Object> data) {
        if (durable == null) {
            throw new IllegalStateException("Durable event publisher is unavailable");
        }
        return durable.publish(type, version, aggregateId, aggregateRevision, generation, correlationId, data);
    }

    public void publish(String type, int version, Map<String, Object> data) {
        HookDispatcher active = dispatcher.getIfAvailable();
        if (active != null) {
            active.publish(type, version, data);
        }
    }
}
