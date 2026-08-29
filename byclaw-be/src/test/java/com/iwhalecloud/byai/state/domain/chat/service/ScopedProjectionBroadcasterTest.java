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
        verify(broadcastService, timeout(1000).times(1)).broadcastRawToUser(
            Mockito.eq(900L), captor.capture(), Mockito.isNull());
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
        verify(broadcastService, timeout(1000).times(1)).broadcastRawToUser(
            Mockito.eq(900L), captor.capture(), Mockito.isNull());
        assertThat(captor.getValue().getString("streamId")).isEqualTo("2-0");
        assertThat(captor.getValue().getJSONObject("data").getString("messageContent")).isEqualTo("done");
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
