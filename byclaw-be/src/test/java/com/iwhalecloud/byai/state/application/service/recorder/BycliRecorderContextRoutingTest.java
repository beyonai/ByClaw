package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class BycliRecorderContextRoutingTest {

    private BycliRecorderBrowserPortTest.FakeDaemon daemon;

    @AfterEach
    void tearDown() {
        if (daemon != null) {
            daemon.close();
        }
    }

    @Test
    void navigateOmitsUnsetContextIdForDaemonProfileAutoSelection() throws Exception {
        daemon = BycliRecorderBrowserPortTest.FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "page", "page-1",
            "data", Map.of("title", "Example")
        ));
        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setDaemonHost("127.0.0.1");
        properties.setDaemonPort(daemon.port());
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.contextId(null);

        new BycliRecorderBrowserPort(properties).navigate(session, "https://example.com");

        assertThat(daemon.lastBody()).doesNotContainKey("contextId");
    }
}
