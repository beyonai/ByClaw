package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.util.ReferenceCountUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ScopedProjectionOutboundTest {
    private final HeldWrites held = new HeldWrites();
    private final EmbeddedChannel slow = new EmbeddedChannel(held);
    private final EmbeddedChannel healthy = new EmbeddedChannel();
    private final MultiDeviceBroadcastService service = new MultiDeviceBroadcastService();

    @BeforeEach
    void setUp() {
        ChannelManager manager = mock(ChannelManager.class);
        when(manager.getChannels(9L)).thenReturn(Set.of(slow, healthy));
        ReflectionTestUtils.setField(service, "channelManager", manager);
    }

    @AfterEach
    void tearDown() {
        held.releaseAll();
        slow.finishAndReleaseAll();
        healthy.finishAndReleaseAll();
    }

    @Test
    void waitsForActualTransportCompletionAndKeepsLatestTerminalWithoutBlockingHealthyClient() {
        send("child", "first", false);
        for (int revision = 0; revision < 1000; revision++) {
            send("child", "revision-" + revision, false);
        }
        send("child", "complete", true);

        assertThat(held.messages).hasSize(1);
        assertThat(slow.isActive()).isTrue();
        int healthyCount = 0;
        TextWebSocketFrame frame;
        while ((frame = healthy.readOutbound()) != null) {
            healthyCount++;
            frame.release();
        }
        assertThat(healthyCount).isEqualTo(1002);

        held.complete(0);
        slow.runPendingTasks();
        assertThat(held.messages).hasSize(2);
        assertThat(((TextWebSocketFrame) held.messages.get(1)).text()).contains("complete");
        held.complete(1);
        slow.runPendingTasks();
        assertThat(held.messages).hasSize(2);
    }

    @Test
    void pendingContextLimitDisconnectsSlowClientRatherThanSilentlyDiscardingTerminal() {
        ReflectionTestUtils.setField(service, "scopedMaxPendingContexts", 1);
        send("first", "in flight", false);
        send("second", "pending", false);
        send("third", "terminal", true);

        assertThat(slow.isActive()).isFalse();
        assertThat(healthy.isActive()).isTrue();
        assertThat(held.messages).hasSize(1);
    }

    @Test
    void pendingBytesIncludeInFlightAndReplacingSnapshotDoesNotAccumulateOldBytes() {
        ReflectionTestUtils.setField(service, "scopedMaxRetainedBytes", 300L);
        send("first", "a".repeat(50), false);
        for (int i = 0; i < 20; i++) {
            send("second", "b".repeat(50), false);
        }
        assertThat(slow.isActive()).isTrue();
        send("third", "c".repeat(200), true);
        assertThat(slow.isActive()).isFalse();
        assertThat(held.messages).hasSize(1);
    }

    @Test
    void neverAllocatesAnOversizeTransportFrame() {
        ReflectionTestUtils.setField(service, "scopedMaxFrameBytes", 100L);
        send("child", "a".repeat(200), true);
        assertThat(slow.isActive()).isFalse();
        assertThat(held.messages).isEmpty();
    }

    @Test
    void writeFailureDisconnectsInsteadOfPretendingTerminalWasDelivered() {
        send("child", "first", false);
        send("child", "complete", true);
        held.fail(0);
        slow.runPendingTasks();
        assertThat(slow.isActive()).isFalse();
        assertThat(held.messages).hasSize(1);
        assertThat(healthy.isActive()).isTrue();
    }

    @Test
    void pendingTerminalAndNextTurnRemainDistinctEvenWhenChildContextIsReused() {
        send("child", "first", false);
        JSONObject terminal = new JSONObject();
        terminal.put("data", JSONObject.parseObject("{\"messageId\":\"old-turn\",\"messageContent\":\"complete\"}"));
        JSONObject nextTurn = new JSONObject();
        nextTurn.put("data", JSONObject.parseObject("{\"messageId\":\"new-turn\",\"messageContent\":\"new response\"}"));
        service.broadcastScopedProjection(9L, "child", terminal, true);
        service.broadcastScopedProjection(9L, "child", nextTurn, false);

        held.complete(0);
        slow.runPendingTasks();
        assertThat(((TextWebSocketFrame) held.messages.get(1)).text()).contains("old-turn");
        held.complete(1);
        slow.runPendingTasks();
        assertThat(held.messages).hasSize(3);
        assertThat(((TextWebSocketFrame) held.messages.get(2)).text()).contains("new-turn");
    }

    @Test
    void stalledWriteDisconnectsWhenItsDeadlineExpires() throws Exception {
        ReflectionTestUtils.setField(service, "scopedWriteTimeoutMillis", 10L);
        send("child", "first", false);
        send("child", "complete", true);
        Thread.sleep(30);
        slow.runScheduledPendingTasks();
        assertThat(slow.isActive()).isFalse();
        assertThat(held.messages).hasSize(1);
        held.fail(0);
        slow.runPendingTasks();
        assertThat(held.messages).hasSize(1);
        assertThat(healthy.isActive()).isTrue();
    }

    private void send(String key, String content, boolean terminal) {
        JSONObject message = new JSONObject();
        message.put("type", "NEW_MESSAGE");
        message.put("messageContent", content);
        service.broadcastScopedProjection(9L, key, message, terminal);
        healthy.runPendingTasks();
    }

    private static class HeldWrites extends ChannelOutboundHandlerAdapter {
        private final List<Object> messages = new ArrayList<>();
        private final List<ChannelPromise> promises = new ArrayList<>();
        @Override
        public void write(ChannelHandlerContext ctx, Object message, ChannelPromise promise) {
            messages.add(message);
            promises.add(promise);
        }
        void complete(int index) {
            ReferenceCountUtil.release(messages.get(index));
            messages.set(index, null);
            promises.get(index).setSuccess();
        }
        void fail(int index) {
            ReferenceCountUtil.release(messages.get(index));
            messages.set(index, null);
            promises.get(index).setFailure(new IllegalStateException("closed transport"));
        }
        void releaseAll() {
            for (int index = 0; index < messages.size(); index++) {
                if (messages.get(index) != null) {
                    ReferenceCountUtil.release(messages.get(index));
                    messages.set(index, null);
                    promises.get(index).tryFailure(new IllegalStateException("test cleanup"));
                }
            }
        }
    }
}
