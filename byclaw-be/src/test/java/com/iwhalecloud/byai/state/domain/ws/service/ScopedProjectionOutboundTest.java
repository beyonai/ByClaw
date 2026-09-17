package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
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
    void capableClientReceivesOneBaselineThenSmallDeltasWhileLegacyClientKeepsFullMessages() {
        healthy.attr(Constant.ATT_HEADER).set(Map.of("scoped-delta-version", "1"));
        healthy.attr(Constant.ATT_SCOPED_SESSION_ID).set("200");
        JSONObject baseline = projection("100-0", "initial", "[\"" + "x".repeat(2000) + "\"]");
        service.broadcastScopedProjection(9L, "child", baseline, false);
        healthy.runPendingTasks();
        TextWebSocketFrame first = healthy.readOutbound();
        assertThat(JSONObject.parseObject(first.text()).getString("type")).isEqualTo("NEW_MESSAGE");
        first.release();

        JSONObject current = projection("101-0", "initial + delta", "[\"" + "x".repeat(2000) + "\",\"next\"]");
        service.broadcastScopedProjection(9L, "child", current, false);
        healthy.runPendingTasks();
        TextWebSocketFrame second = healthy.readOutbound();
        JSONObject delta = JSONObject.parseObject(second.text());
        assertThat(delta.getString("type")).isEqualTo("SCOPED_MESSAGE_DELTA");
        assertThat(delta.getJSONObject("data").getString("baseStreamId")).isEqualTo("100-0");
        assertThat(second.text().length()).isLessThan(current.toJSONString().length() / 2);
        second.release();

        assertThat(((TextWebSocketFrame) held.messages.getFirst()).text()).contains("NEW_MESSAGE");
    }

    @Test
    void slowCapableClientCoalescesPendingSnapshotsIntoOneDeltaFromItsDeliveredBase() {
        slow.attr(Constant.ATT_HEADER).set(Map.of("scoped-delta-version", "1"));
        slow.attr(Constant.ATT_SCOPED_SESSION_ID).set("200");
        String base = "x".repeat(2000);
        service.broadcastScopedProjection(9L, "child", projection("100-0", "start", "[\"" + base + "\"]"), false);
        for (int revision = 1; revision <= 100; revision++) {
            service.broadcastScopedProjection(9L, "child",
                projection((100 + revision) + "-0", "start-" + revision,
                    "[\"" + base + "\",\"" + revision + "\"]"),
                revision == 100);
        }

        assertThat(held.messages).hasSize(1);
        held.complete(0);
        slow.runPendingTasks();
        assertThat(held.messages).hasSize(2);
        JSONObject delta = JSONObject.parseObject(((TextWebSocketFrame) held.messages.get(1)).text());
        assertThat(delta.getString("type")).isEqualTo("SCOPED_MESSAGE_DELTA");
        assertThat(delta.getString("streamId")).isEqualTo("200-0");
        assertThat(delta.getJSONObject("data").getString("baseStreamId")).isEqualTo("100-0");
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

    @Test
    void capableClientReceivesOnlyDeduplicatedStatusUntilAChildIsSelected() {
        healthy.attr(Constant.ATT_HEADER).set(Map.of("scoped-delta-version", "1"));
        JSONObject first = childProjection("100-0", "first", true, "running");
        service.broadcastScopedProjection(9L, "child", first, false);
        service.broadcastScopedProjection(9L, "child", childProjection("101-0", "second", true, "running"), false);
        healthy.runPendingTasks();

        TextWebSocketFrame statusFrame = healthy.readOutbound();
        JSONObject status = JSONObject.parseObject(statusFrame.text());
        assertThat(status.getString("type")).isEqualTo("SCOPED_SESSION_STATUS");
        assertThat(status.getJSONObject("data")).doesNotContainKeys("messageContent", "inferLog");
        assertThat(statusFrame.text()).doesNotContain("first").doesNotContain("second")
            .doesNotContain("performance analysis");
        JSONObject statusMetadata = JSONObject.parseObject(status.getJSONObject("data").getString("metadata"));
        assertThat(statusMetadata).doesNotContainKey("child_task");
        statusFrame.release();
        assertThat((TextWebSocketFrame) healthy.readOutbound()).isNull();

        service.broadcastScopedProjection(9L, "child", childProjection("102-0", "complete", false, "completed"), true);
        healthy.runPendingTasks();
        TextWebSocketFrame terminalFrame = healthy.readOutbound();
        JSONObject terminal = JSONObject.parseObject(terminalFrame.text());
        assertThat(terminal.getJSONObject("data").getBooleanValue("terminal")).isTrue();
        terminalFrame.release();
    }

    @Test
    void capableClientReceivesContentOnlyForItsSelectedChild() {
        healthy.attr(Constant.ATT_HEADER).set(Map.of("scoped-delta-version", "1"));
        healthy.attr(Constant.ATT_SCOPED_SESSION_ID).set("200");

        service.broadcastScopedProjection(9L, "selected", childProjection("100-0", "selected-content", true, "running"), false);
        JSONObject other = childProjection("101-0", "other-content", true, "running");
        other.put("sessionId", "201");
        other.getJSONObject("data").put("sessionId", 201L);
        service.broadcastScopedProjection(9L, "other", other, false);
        healthy.runPendingTasks();

        TextWebSocketFrame selected = healthy.readOutbound();
        assertThat(JSONObject.parseObject(selected.text()).getString("type")).isEqualTo("NEW_MESSAGE");
        assertThat(selected.text()).contains("selected-content");
        selected.release();
        TextWebSocketFrame otherStatus = healthy.readOutbound();
        assertThat(JSONObject.parseObject(otherStatus.text()).getString("type")).isEqualTo("SCOPED_SESSION_STATUS");
        assertThat(otherStatus.text()).doesNotContain("other-content");
        otherStatus.release();
    }

    private void send(String key, String content, boolean terminal) {
        JSONObject message = new JSONObject();
        message.put("type", "NEW_MESSAGE");
        message.put("messageContent", content);
        service.broadcastScopedProjection(9L, key, message, terminal);
        healthy.runPendingTasks();
    }

    private JSONObject projection(String streamId, String content, String inferLog) {
        JSONObject data = new JSONObject();
        data.put("sessionId", 200L);
        data.put("messageId", "answer-1");
        data.put("messageContent", content);
        data.put("inferLog", inferLog);
        JSONObject message = new JSONObject();
        message.put("type", "NEW_MESSAGE");
        message.put("sessionId", "200");
        message.put("streamId", streamId);
        message.put("data", data);
        return message;
    }

    private JSONObject childProjection(String streamId, String content, boolean running, String status) {
        JSONObject message = projection(streamId, content, "[\"private-infer-log\"]");
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "child");
        metadata.put("external_session_id", "member-1");
        metadata.put("external_parent_session_id", "100");
        metadata.put("child_name", "架构舵手");
        metadata.put("child_task", "performance analysis");
        metadata.put("session_status", status);
        metadata.put("private_detail", "must-not-leak");
        message.getJSONObject("data").put("metadata", metadata.toJSONString());
        message.getJSONObject("data").put("running", running);
        return message;
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
