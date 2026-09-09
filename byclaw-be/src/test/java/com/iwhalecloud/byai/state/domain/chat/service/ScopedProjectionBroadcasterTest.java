package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class ScopedProjectionBroadcasterTest {

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    @Test
    void coalescesAccumulatedProjectionsAndBroadcastsOnlyTheNewestRevision() {
        MultiDeviceBroadcastService broadcastService = Mockito.mock(MultiDeviceBroadcastService.class);
        ScopedProjectionBroadcaster broadcaster = new ScopedProjectionBroadcaster(broadcastService, 40L, scheduler);

        broadcaster.enqueue("session:20", 900L, message("1-0", "a"), false);
        broadcaster.enqueue("session:20", 900L, message("2-0", "ab"), false);
        broadcaster.enqueue("session:20", 900L, message("3-0", "abc"), false);

        ArgumentCaptor<JSONObject> captor = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcastService, timeout(1000).times(1)).broadcastScopedProjection(
            Mockito.eq(900L), Mockito.eq("session:20"), captor.capture(), Mockito.eq(false));
        assertThat(captor.getValue().getString("streamId")).isEqualTo("3-0");
        assertThat(captor.getValue().getJSONObject("data").getString("messageContent")).isEqualTo("abc");
    }

    @Test
    void terminalProjectionSupersedesPendingRevisionAndBroadcastsImmediately() {
        MultiDeviceBroadcastService broadcastService = Mockito.mock(MultiDeviceBroadcastService.class);
        ScopedProjectionBroadcaster broadcaster = new ScopedProjectionBroadcaster(broadcastService, 60_000L,
            scheduler);

        broadcaster.enqueue("session:20", 900L, message("1-0", "running"), false);
        broadcaster.enqueue("session:20", 900L, message("2-0", "done"), true);

        ArgumentCaptor<JSONObject> captor = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcastService, timeout(1000).times(1)).broadcastScopedProjection(
            Mockito.eq(900L), Mockito.eq("session:20"), captor.capture(), Mockito.eq(true));
        assertThat(captor.getValue().getString("streamId")).isEqualTo("2-0");
        assertThat(captor.getValue().getJSONObject("data").getString("messageContent")).isEqualTo("done");
    }

    @Test
    void terminalAndNewTurnUseDistinctCoalescingSlots() throws Exception {
        MultiDeviceBroadcastService broadcastService = Mockito.mock(MultiDeviceBroadcastService.class);
        ScopedProjectionBroadcaster broadcaster = new ScopedProjectionBroadcaster(broadcastService, 40L, scheduler);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        scheduler.submit(() -> {
            try { release.await(); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        });
        JSONObject terminal = message("1-0", "done");
        terminal.getJSONObject("data").put("messageId", "old-turn");
        JSONObject nextTurn = message("2-0", "new response");
        nextTurn.getJSONObject("data").put("messageId", "new-turn");
        try {
            broadcaster.enqueue("session:20", 900L, terminal, true);
            broadcaster.enqueue("session:20", 900L, nextTurn, false);
        }
        finally {
            release.countDown();
        }
        verify(broadcastService, timeout(1000)).broadcastScopedProjection(900L, "session:20", terminal, true);
        verify(broadcastService, timeout(1000)).broadcastScopedProjection(900L, "session:20", nextTurn, false);
    }

    private JSONObject message(String streamId, String content) {
        JSONObject data = new JSONObject();
        data.put("messageContent", content);
        JSONObject message = new JSONObject();
        message.put("type", "NEW_MESSAGE");
        message.put("sessionId", "20");
        message.put("streamId", streamId);
        message.put("data", data);
        return message;
    }
}
