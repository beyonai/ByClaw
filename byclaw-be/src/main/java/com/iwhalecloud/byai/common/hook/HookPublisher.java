package com.iwhalecloud.byai.common.hook;

import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;

/** Stable business API; disabled environments do not construct payloads or start workers. */
public class HookPublisher {
    private final ObjectProvider<HookDispatcher> dispatcher;
    public HookPublisher(ObjectProvider<HookDispatcher> dispatcher) {
        this.dispatcher = dispatcher;
    }

    public void publish(String type, int version, Map<String, Object> data) {
        HookDispatcher active = dispatcher.getIfAvailable();
        if (active != null) {
            active.publish(type, version, data);
        }
    }
}
