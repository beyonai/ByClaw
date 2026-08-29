package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.LinkedBlockingQueue;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSONObject;

class OutputStreamManagerMetricsTest {

    @Test
    void aggregatesOnlyGatewayEventQueues() {
        OutputStreamManager manager = new OutputStreamManager();
        manager.putContext("10", contextWithQueue(2));
        manager.putContext("20", contextWithQueue(1));
        manager.putContext("30", new ChatProcessContext(null, null));

        assertThat(manager.getTotalGatewayEventQueueSize()).isEqualTo(3L);
        assertThat(manager.getMaxGatewayEventQueueSize()).isEqualTo(2L);
    }

    @Test
    void returnsZeroWhenNoGatewayQueueExists() {
        OutputStreamManager manager = new OutputStreamManager();
        manager.putContext("30", new ChatProcessContext(null, null));

        assertThat(manager.getTotalGatewayEventQueueSize()).isZero();
        assertThat(manager.getMaxGatewayEventQueueSize()).isZero();
    }

    private ChatProcessContext contextWithQueue(int size) {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.gatewayEventQueue = new LinkedBlockingQueue<>();
        for (int index = 0; index < size; index++) {
            ctx.gatewayEventQueue.add(new JSONObject());
        }
        return ctx;
    }
}
