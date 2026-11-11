package com.iwhalecloud.byai.common.hook;

import java.util.Map;
import com.iwhalecloud.byai.common.util.JsonUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;

/** Stable business API; disabled environments do not construct payloads or start workers. */
public class HookPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(HookPublisher.class);
    private final ObjectProvider<HookDispatcher> dispatcher;
    public HookPublisher(ObjectProvider<HookDispatcher> dispatcher) {
        this.dispatcher = dispatcher;
    }

    public void publish(String type, int version, Map<String, Object> data) {
        HookDispatcher active = dispatcher.getIfAvailable();
        if (active != null) {
            active.publish(type, version, data);
        } else {
            LOG.info("触发勾子失败，Hook未启用,type={},data={}", type, JsonUtil.toJSONString(data));
        }
    }

    /** Publish a business fact whose owning database has already committed, including tenant Node writes. */
    public void publishCommitted(String type, int version, Map<String, Object> data) {
        HookDispatcher active = dispatcher.getIfAvailable();
        if (active != null) {
            active.publishCommitted(type, version, data);
        }
    }
}
