package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import com.dingtalk.open.app.api.OpenDingTalkClient;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectionSlotTest {

    @Test
    void sdkStopIsInvokedAtMostOnce() throws Exception {
        AtomicInteger stops = new AtomicInteger();
        ClientAttempt attempt = new ClientAttempt(new OpenDingTalkClient() {
            @Override
            public void start() {
            }

            @Override
            public void stop() {
                stops.incrementAndGet();
            }
        }, 1);

        attempt.stopOnce();
        attempt.stopOnce();

        assertThat(stops).hasValue(1);
    }

    @Test
    void messagesDrainOnlyAfterAdmissionIsClosedAndLastLeaseReturns() {
        ConnectionSlot slot = slot();
        slot.openMessageAdmission();
        ConnectionSlot.MessageLease lease = slot.tryAcquireMessageLease(false, true);

        slot.closeMessageAdmissionPermanently();
        assertThat(slot.messagesDrained().isDone()).isFalse();

        lease.close();
        lease.close();
        assertThat(slot.messagesDrained().isDone()).isTrue();
    }

    @Test
    void generationWaitsForClientAndLeaseAcquireAttemptsToSettle() {
        ConnectionSlot slot = slot();
        ClientAttempt clientAttempt = new ClientAttempt(new NoopClient(), 1);
        LeaseAcquireAttempt leaseAttempt = new LeaseAcquireAttempt("candidate-token");
        slot.setCurrentAttempt(clientAttempt);
        slot.setCurrentLeaseAttempt(leaseAttempt);

        slot.cancel();
        assertThat(slot.generationDrained().isDone()).isFalse();

        clientAttempt.markSettled();
        slot.tryCompleteGenerationDrained();
        assertThat(slot.generationDrained().isDone()).isFalse();

        leaseAttempt.markSettled();
        slot.tryCompleteGenerationDrained();
        assertThat(slot.generationDrained().isDone()).isTrue();
    }

    private ConnectionSlot slot() {
        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setRobotCode("robot-1");
        config.setResourceId(1L);
        return new ConnectionSlot("robot-1", 1L, 1L, config, "fingerprint");
    }

    private static final class NoopClient implements OpenDingTalkClient {
        @Override
        public void start() {
        }

        @Override
        public void stop() {
        }
    }
}
